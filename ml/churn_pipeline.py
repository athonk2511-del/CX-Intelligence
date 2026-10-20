"""CX Intelligence — 60-day true-churn risk model (XGBoost).

Run:  python -m ml.churn_pipeline train|score|all [--config ml/config.yaml]

Reads the CSV exports in the owner's Google Drive folder, labels every termination
(swap / relocation / replacement / backlog / true churn), builds point-in-time monthly
snapshots, trains and evaluates XGBoost against two baselines, and writes the files the
dashboard reads from Drive "Churn Model/". Logs counts only, never personal data.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import math
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

log = logging.getLogger("churn")
DAY = pd.Timedelta(days=1)

# ---------------------------------------------------------------- column layouts
CUST_COLS = ["holder_name", "priority", "branch", "total_user", "uid", "cid", "status", "area", "coordinates",
             "start_date", "grace", "expiration", "product", "product_variant", "monthly_fee", "discount",
             "include_tax", "tax", "final_price", "sum_of_price", "sales", "email", "phone", "company_name",
             "industrial", "tag"]
TICKET_COLS = ["no", "ticket_number", "branch", "date", "uid", "cid", "priority", "product", "product_variant",
               "phone", "email", "mygx", "cso", "ctso", "type", "category", "problem", "via", "created",
               "sent_ctso", "created_sent", "first_ctso_report", "sent_first", "solved", "sent_solved",
               "solved_by_cso", "solved_by_billing", "wo_created", "wo_number", "status", "total_reports"]
WO_POS = {1: "wo_number", 2: "branch", 5: "wo_status", 7: "wo_created", 11: "cid", 19: "priority", 24: "date_of_work"}

# Leakage: current values that reveal the outcome. Asserted against every feature matrix.
FORBIDDEN_FEATURES = {"status", "status_now", "grace", "expiration", "expiration_now", "sum_of_price", "term_date"}
CAT_FEATURES = ["product", "branch", "priority", "industry", "segment", "sub_segment", "segment_confidence"]
REPLACEMENT_CLASSES = {"swap", "relocation", "replacement_other", "backlog"}


# ---------------------------------------------------------------- config / helpers
def load_config(path: str | Path) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def detect_delimiter(head: str) -> str:
    counts = {",": head.count(","), ";": head.count(";"), "\t": head.count("\t")}
    best = max(counts, key=lambda k: (counts[k], k == ","))
    return best if counts[best] else ","


def read_csv_text(text: str) -> pd.DataFrame:
    if text.startswith("\ufeff"):
        text = text[1:]
    first = text.split("\n", 1)[0]
    return pd.read_csv(io.StringIO(text), sep=detect_delimiter(first), dtype=str, keep_default_na=False,
                       header=0, engine="python" if detect_delimiter(first) == "\t" else "c")


def stack_folder(folder: Path, names: list[str] | dict[int, str]) -> pd.DataFrame:
    """Every CSV in the folder, stacked in name order; columns are taken by position."""
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() == ".csv")
    frames = []
    log.info("reading %s: %d CSV files", folder.name, len(files))
    for i, p in enumerate(files, 1):
        t1 = time.time()
        df = read_csv_text(p.read_bytes().decode("utf-8", errors="replace"))
        log.info("  %s %d/%d %s · %d rows · %.1fs", folder.name, i, len(files), p.name, len(df), time.time() - t1)
        if isinstance(names, dict):
            df = pd.DataFrame({n: (df.iloc[:, i] if i < df.shape[1] else "") for i, n in names.items()})
        else:
            df = df.iloc[:, :len(names)].copy()
            df.columns = names[:df.shape[1]]
            for n in names[df.shape[1]:]:
                df[n] = ""
        frames.append(df)
    log.info("loaded %s: %d files, %d rows", folder.name, len(files), sum(len(f) for f in frames))
    if not frames:
        return pd.DataFrame(columns=list(names.values()) if isinstance(names, dict) else names)
    return pd.concat(frames, ignore_index=True)


def clean(s: pd.Series) -> pd.Series:
    s = s.fillna("").astype(str).str.strip()
    return s.mask(s.isin(["-", "—", "nan", "NaN", "None"]), "")


def norm_cid(s: pd.Series) -> pd.Series:
    return clean(s).str.replace(r"\D", "", regex=True)


def norm_phone(s: pd.Series) -> pd.Series:
    d = clean(s).str.replace(r"\D", "", regex=True)
    return d.where(d.str.len() >= 8, "").str[-9:]


def norm_name(s: pd.Series) -> pd.Series:
    return clean(s).str.lower().str.replace(r"\s+", " ", regex=True).str.strip()


def parse_date(s: pd.Series) -> pd.Series:
    s = clean(s)
    out = pd.Series(pd.NaT, index=s.index, dtype="datetime64[ns]")
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        miss = out.isna() & (s != "")
        if not miss.any():
            break
        out[miss] = pd.to_datetime(s[miss], format=fmt, errors="coerce")
    return out


def parse_money(s: pd.Series) -> pd.Series:
    s = clean(s).str.replace(r",\d{1,2}$", "", regex=True).str.replace(r"[^\d-]", "", regex=True)
    return pd.to_numeric(s.where(s != "", None), errors="coerce")


def unparsed_share(raw: pd.Series, parsed: pd.Series) -> float:
    present = clean(raw) != ""
    return float((present & parsed.isna()).sum() / max(1, present.sum()))


def add_months(d: pd.Series, k) -> pd.Series:
    k = np.asarray(k, dtype=float)
    ok = d.notna().to_numpy() & ~np.isnan(k)
    y = np.where(ok, d.dt.year.fillna(2000).to_numpy(), 2000).astype(int)
    m = np.where(ok, d.dt.month.fillna(1).to_numpy(), 1).astype(int)
    day = np.where(ok, d.dt.day.fillna(1).to_numpy(), 1).astype(int)
    tot = y * 12 + (m - 1) + np.where(ok, k, 0).astype(int)
    ny, nm = tot // 12, tot % 12 + 1
    first = pd.to_datetime(pd.DataFrame({"year": ny, "month": nm, "day": 1}))
    nd = np.minimum(day, first.dt.days_in_month.to_numpy())
    out = pd.to_datetime(pd.DataFrame({"year": ny, "month": nm, "day": nd}))
    out[~ok] = pd.NaT
    return pd.Series(out.to_numpy(), index=d.index)


def months_between(start: pd.Series, s: pd.Timestamp) -> np.ndarray:
    m = (s.year - start.dt.year) * 12 + (s.month - start.dt.month) - (s.day < start.dt.day).astype(float)
    return m.to_numpy(dtype=float)


def renewal_position(start: pd.Series, term_len: pd.Series, s: pd.Timestamp, horizon: int) -> pd.DataFrame:
    """Renewals follow Start Date + k × term length (never Expiration)."""
    L = term_len.fillna(1).clip(lower=1).to_numpy(dtype=float)
    m = months_between(start, s)
    done = np.floor(np.maximum(m, 0) / L)
    nxt = add_months(start, (done + 1) * L)
    dtn = (nxt - s).dt.days
    return pd.DataFrame({"renewals_completed": done, "days_to_next_renewal": dtn,
                         "renewal_within_horizon": (dtn <= horizon).astype(int),
                         "first_cycle": (done == 0).astype(int)}, index=start.index)


def term_len_of(variant: pd.Series) -> pd.Series:
    v = clean(variant).str.lower()
    out = pd.Series(np.nan, index=v.index)
    for pat, n in ((r"annual|yearly|tahun|12 ?bulan|12 ?month", 12), (r"semest|6 ?bulan|6 ?month", 6),
                   (r"quart|qurt|quat|qtr|3 ?bulan|3 ?month", 3), (r"month|bulan", 1)):
        out = out.mask(out.isna() & v.str.contains(pat, regex=True), n)
    return out.fillna(1)


def speed_of(variant: pd.Series) -> pd.Series:
    m = clean(variant).str.lower().str.extract(r"(\d+(?:[.,]\d+)?)\s*(gb|gbps|g\b|mb|mbps|m\b)")
    val = pd.to_numeric(m[0].str.replace(",", "."), errors="coerce")
    return val * np.where(m[1].fillna("").str.startswith("g"), 1000, 1)


def stable_hash(text: str) -> int:
    return int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)


# ---------------------------------------------------------------- loading + validation
@dataclass
class Data:
    customers: pd.DataFrame
    tickets: pd.DataFrame
    term_tickets: pd.DataFrame
    wo: pd.DataFrame
    csat: pd.DataFrame | None
    score_date: pd.Timestamp
    dq: dict = field(default_factory=dict)


class DataQualityError(RuntimeError):
    pass


def find_subfolders(root: Path, cfg: dict) -> dict[str, Path]:
    out = {}
    for p in sorted(root.iterdir()):
        if not p.is_dir():
            continue
        n = p.name.lower()
        if re.search(r"churn ?model", n):
            continue
        for kind, pat in cfg["subfolders"].items():
            if kind == "wo" and re.search(pat, n):
                out.setdefault("wo_all", []).append(p)
                out.setdefault("wo", p)
                break
            if kind not in out and re.search(pat, n):
                out[kind] = p
                break
    return out


def prepare_customers(raw: pd.DataFrame, cfg: dict, dq: dict) -> pd.DataFrame:
    c = raw.copy()
    for col in CUST_COLS:
        c[col] = clean(c[col])
    c["cid"] = norm_cid(raw["cid"])
    c = c[c["cid"] != ""].copy()
    dup = int(c["cid"].duplicated(keep=False).sum())
    c["_co"] = c["status"].str.lower().str.contains("change ownership").astype(int)
    c = c.sort_values("_co", kind="stable").drop_duplicates("cid", keep="first").sort_index().drop(columns="_co")
    dq["customers_rows"] = int(len(raw))
    dq["customers_duplicate_cid_rows"] = dup
    c["start_date"] = parse_date(c["start_date"])
    c["grace_d"] = parse_date(c["grace"])
    c["expiration_d"] = parse_date(c["expiration"])
    dq["unparsed_dates"] = max(unparsed_share(raw.loc[c.index, "grace"], c["grace_d"]),
                               unparsed_share(raw.loc[c.index, "expiration"], c["expiration_d"]),
                               unparsed_share(raw.loc[c.index, "start_date"], c["start_date"]))
    for col in ("monthly_fee", "discount", "sum_of_price"):
        c[col + "_n"] = parse_money(c[col])
    dq["unparsed_money"] = max(unparsed_share(c[col], c[col + "_n"]) for col in ("monthly_fee", "discount"))
    c["monthly_fee"] = c["monthly_fee_n"].fillna(0)
    c["discount"] = c["discount_n"].fillna(0)
    c["net_fee"] = (c["monthly_fee"] - c["discount"]).clip(lower=0)
    c["disc_pct"] = np.where(c["monthly_fee"] > 0, c["discount"] / c["monthly_fee"], 0.0)
    ll = c["coordinates"].str.extract(r"(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)")
    c["lat"] = pd.to_numeric(ll[0], errors="coerce")
    c["lng"] = pd.to_numeric(ll[1], errors="coerce")
    zero = (c["lat"].abs() < 1e-6) & (c["lng"].abs() < 1e-6)
    c.loc[zero, ["lat", "lng"]] = np.nan
    c["coord_key"] = np.where(c["lat"].notna(), c["coordinates"].str.replace(r"\s+", "", regex=True), "")
    c["name_n"] = norm_name(c["holder_name"])
    c["company_n"] = norm_name(c["company_name"])
    c["phone9"] = norm_phone(c["phone"])
    c["email_n"] = c["email"].str.lower()
    c["base_uid"] = c["uid"].str.replace(r"(?<=\d)[A-Z]+$", "", regex=True).str.lower()
    c["is_term"] = c["status"].str.fullmatch("Termination", case=False)
    c["term_date"] = c[["grace_d", "expiration_d"]].max(axis=1).where(c["is_term"])
    plan = (c["product"] + " " + c["product_variant"]).str.lower()
    c["is_retail"] = ~plan.str.contains(cfg["population"]["non_retail_pattern"], regex=True)
    c["term_len"] = term_len_of(c["product_variant"])
    c["speed_mbps"] = speed_of(c["product_variant"])
    v = c["product_variant"].str.lower()
    c["flag_residential"] = v.str.contains(r"residen|complex|perumahan|cluster").astype(int)
    c["flag_employee"] = v.str.contains(r"employee|karyawan|staff").astype(int)
    c["flag_promo"] = v.str.contains(r"promo").astype(int)
    c["industry"] = c["industrial"].str.split().str[0].fillna("").replace("", "Unknown")
    c["sales_recorded"] = (c["sales"] != "").astype(int)
    c["priority"] = c["priority"].replace("", "Unknown")
    c["product"] = c["product"].replace("", "Unknown")
    c["branch_label"] = c["branch"].str.replace(r"^GlobalXtreme\s*", "", regex=True)
    return c.reset_index(drop=True)


def prepare_tickets(raw: pd.DataFrame, cfg: dict) -> tuple[pd.DataFrame, pd.DataFrame, float]:
    t = pd.DataFrame({k: clean(raw[k]) for k in ("type", "category", "problem", "via", "status", "mygx", "sent_ctso", "wo_number")})
    t["cid"] = norm_cid(raw["cid"])
    t["date"] = parse_date(raw["date"])
    t["created"] = parse_date(raw["created"]).fillna(t["date"])
    t["date"] = t["date"].fillna(t["created"]).dt.normalize()
    t["solved"] = parse_date(raw["solved"])
    t["total_reports"] = pd.to_numeric(clean(raw["total_reports"]), errors="coerce").fillna(0)
    bad = unparsed_share(raw["date"], t["date"])
    t = t[(t["cid"] != "") & t["date"].notna()].copy()
    fb = cfg["features"]["forbidden"]
    forb = t["category"].str.contains(fb["category"], case=False, regex=True) | t["problem"].str.contains(fb["problem"], case=False, regex=True)
    term = t[t["category"].str.contains(fb["category"], case=False, regex=True)].copy()
    t = t[~forb].copy()
    for name, rule in cfg["features"]["ticket_flags"].items():
        m = pd.Series(True, index=t.index)
        for col, pat in rule.items():
            m &= t[col].str.contains(pat, case=False, regex=True)
        t["f_" + name] = m.astype(np.int8)
    t["f_ctso"] = (t["sent_ctso"] != "").astype(np.int8)
    t["f_mygx"] = t["mygx"].str.lower().isin(["yes", "y", "true", "1", "ya"]).astype(np.int8)
    t["f_inet_cmp"] = (t["f_inet"] & t["f_complaint"]).astype(np.int8)
    return t.reset_index(drop=True), term.reset_index(drop=True), bad


def assert_no_leakage(t: pd.DataFrame, cfg: dict) -> None:
    fb = cfg["features"]["forbidden"]
    assert not t["category"].str.contains(fb["category"], case=False, regex=True).any(), "termination tickets reached features"
    assert not t["problem"].str.contains(fb["problem"], case=False, regex=True).any(), "forbidden problems reached features"


def prepare_wo(raw: pd.DataFrame) -> pd.DataFrame:
    w = pd.DataFrame({"cid": norm_cid(raw["cid"]), "wo_number": clean(raw["wo_number"]).str.upper(),
                      "wo_status": clean(raw["wo_status"]).str.lower()})
    w["kind"] = w["wo_number"].str[:3]
    w["created"] = parse_date(raw["wo_created"])
    w["dow"] = parse_date(raw["date_of_work"])
    w = w[(w["cid"] != "") & w["created"].notna() & ~w["wo_status"].str.contains("cancel")]
    return w.reset_index(drop=True)


def load_data(cfg: dict) -> Data:
    root = Path(cfg["paths"]["drive_root"])
    if not root.exists():
        raise DataQualityError(f"Drive folder not found: {root}")
    sub = find_subfolders(root, cfg)
    missing = [k for k in ("tickets", "customers") if k not in sub]
    if missing:
        raise DataQualityError("missing subfolders: " + ", ".join(missing))
    dq: dict = {"folders": {k: (", ".join(x.name for x in v) if isinstance(v, list) else v.name) for k, v in sub.items()}}
    craw = stack_folder(sub["customers"], CUST_COLS)
    traw = stack_folder(sub["tickets"], TICKET_COLS)
    for need, df, cols in (("customers", craw, ["cid", "status", "start_date", "grace", "expiration", "uid"]),
                           ("tickets", traw, ["cid", "date", "category", "problem", "type"])):
        if df.empty or (df[cols] == "").all().any():
            raise DataQualityError(f"[hard] {need}: required columns empty or missing: {cols}")
    c = prepare_customers(craw, cfg, dq)
    t, term, bad_t = prepare_tickets(traw, cfg)
    dq["unparsed_ticket_dates"] = bad_t
    if dq["unparsed_dates"] > 0.02 or dq["unparsed_money"] > 0.02 or bad_t > 0.02:
        log.warning("unparseable share above 2%%: dates %.3f money %.3f tickets %.3f", dq["unparsed_dates"], dq["unparsed_money"], bad_t)
    dq["date_or_money_over_2pct"] = bool(max(dq["unparsed_dates"], dq["unparsed_money"], bad_t) > 0.02)
    known = set(c["cid"])
    tc = pd.Series(pd.concat([t["cid"], term["cid"]]).unique())
    dq["ticket_cids"] = int(len(tc))
    dq["ticket_customer_match_rate"] = float(tc.isin(known).mean()) if len(tc) else 0.0
    dq["coverage_ok"] = dq["ticket_customer_match_rate"] >= 0.90
    if not dq["coverage_ok"]:
        log.warning("[hard warning] ticket→customer CID match rate %.1f%% (< 90%%): the Customers export is probably not the full base",
                    dq["ticket_customer_match_rate"] * 100)
    dq["ticket_date_min"] = str(t["date"].min().date())
    dq["ticket_date_max"] = str(t["date"].max().date())
    wo = prepare_wo(pd.concat([stack_folder(f, WO_POS) for f in sub["wo_all"]], ignore_index=True)) if "wo" in sub else pd.DataFrame(columns=["cid", "kind", "created", "dow"])
    dq["wo_rows"] = int(len(wo))
    newest = max(p.stat().st_mtime for p in sub["customers"].iterdir() if p.suffix.lower() == ".csv")
    cust_date = pd.Timestamp(newest, unit="s").normalize()
    score_date = min(cust_date, t["date"].max() + DAY).normalize()
    dq["customers_snapshot_date"] = str(cust_date.date())
    dq["score_date"] = str(score_date.date())
    csat = None
    cc = cfg["features"]["csat"]
    if "csat" in sub and cc.get("cid_col") and cc.get("score_col") and cc.get("date_col"):
        letters = {k: ord(cc[k].upper()) - 65 for k in ("cid_col", "score_col", "date_col")}
        raw = stack_folder(sub["csat"], {letters["cid_col"]: "cid", letters["score_col"]: "score", letters["date_col"]: "date"})
        csat = pd.DataFrame({"cid": norm_cid(raw["cid"]), "score": pd.to_numeric(clean(raw["score"]), errors="coerce"), "date": parse_date(raw["date"])})
        rate = float(csat["cid"].isin(known).mean()) if len(csat) else 0.0
        dq["csat_link_rate"] = rate
        if rate < cc["min_link_rate"]:
            dq["csat_note"] = f"CSAT omitted: only {rate:.0%} of responses link to a CID (needs {cc['min_link_rate']:.0%})."
            csat = None
        else:
            csat = csat[csat["cid"].isin(known) & csat["date"].notna() & csat["score"].notna()]
    else:
        dq["csat_note"] = "CSAT omitted: column mapping not configured (features.csat in config.yaml) or no CSAT folder."
    log.info("customers %d · tickets %d (+%d termination) · WO %d · score date %s · match rate %.1f%%",
             len(c), len(t), len(term), len(wo), score_date.date(), dq["ticket_customer_match_rate"] * 100)
    return Data(c, t, term, wo, csat, score_date, dq)


# ---------------------------------------------------------------- identity
def build_holders(c: pd.DataFrame, cfg: dict) -> np.ndarray:
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    mx = cfg["holder"]["max_key_accounts"]
    staff = cfg["holder"]["staff_email_domain"]
    n = len(c)
    keys = []
    keys.append(("u:" + c["base_uid"]).where(c["base_uid"] != ""))
    pc = c["phone9"].map(c["phone9"].value_counts())
    keys.append(("p:" + c["phone9"]).where((c["phone9"] != "") & (pc <= mx)))
    ec = c["email_n"].map(c["email_n"].value_counts())
    keys.append(("e:" + c["email_n"]).where((c["email_n"].str.contains("@")) & (ec <= mx) & ~c["email_n"].str.endswith("@" + staff)))
    long = pd.concat([pd.DataFrame({"i": np.arange(n), "k": k}) for k in keys]).dropna()
    codes, uniq = pd.factorize(long["k"])
    rows = long["i"].to_numpy()
    cols = n + codes
    g = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n + len(uniq), n + len(uniq)))
    _, lab = connected_components(g, directed=False)
    return lab[:n]


def identity_long(df: pd.DataFrame) -> pd.DataFrame:
    parts = []
    for col, tag in (("name_n", "name"), ("phone9", "phone"), ("email_n", "email")):
        v = df[col]
        ok = v != ""
        if col == "email_n":
            ok &= v.str.contains("@")
        parts.append(pd.DataFrame({"row": df.index[ok], "key": tag + ":" + v[ok], "rule": tag}))
    return pd.concat(parts, ignore_index=True)


# ---------------------------------------------------------------- termination labels
def classify_terminations(c: pd.DataFrame, cfg: dict, before: int, after: int, ref_date: pd.Timestamp) -> pd.DataFrame:
    """One class per Termination / Change Ownership row. Order: change_ownership, swap, relocation,
    replacement_other, backlog, true_churn. Swap and relocation follow runSwapAnalysis()."""
    live_st = [s.lower() for s in cfg["label"]["live_statuses_for_matching"]]
    co = c[c["status"].str.lower().str.contains("change ownership")]
    T = c[c["is_term"]]
    live = c[c["status"].str.lower().isin(live_st)]
    tk = identity_long(T).rename(columns={"row": "t"})
    lk = identity_long(live).rename(columns={"row": "l"}).drop(columns="rule")
    ak = identity_long(c).rename(columns={"row": "l"}).drop(columns="rule")
    out = pd.DataFrame(index=T.index)
    out["class"] = ""
    out["matched"] = -1
    out["rule"] = ""
    out["days_gap"] = np.nan

    def assign(pairs: pd.DataFrame, cls: str):
        pairs = pairs[out.loc[pairs["t"], "class"].to_numpy() == ""]
        if pairs.empty:
            return
        first = pairs.sort_values(["t", "absgap"]).drop_duplicates("t")
        out.loc[first["t"], "class"] = cls
        out.loc[first["t"], "matched"] = first["l"].to_numpy()
        out.loc[first["t"], "rule"] = first["rule"].to_numpy()
        out.loc[first["t"], "days_gap"] = first["gap"].to_numpy()

    def pairs_from(keys: pd.DataFrame) -> pd.DataFrame:
        p = tk.merge(keys, on="key")
        p = p[p["t"] != p["l"]].copy()
        p["gap"] = (c.loc[p["l"], "start_date"].to_numpy() - c.loc[p["t"], "term_date"].to_numpy()) / np.timedelta64(1, "D")
        p["absgap"] = np.abs(p["gap"].fillna(1e9))
        p["tc"] = c.loc[p["t"], "coord_key"].to_numpy()
        p["lc"] = c.loc[p["l"], "coord_key"].to_numpy()
        return p

    pl = pairs_from(lk)
    assign(pl[(pl["tc"] != "") & (pl["tc"] == pl["lc"])].assign(gap=lambda d: d["gap"]), "swap")
    win = pl["gap"].between(-before, after)
    assign(pl[win & (pl["lc"] != "") & (pl["lc"] != pl["tc"])], "relocation")
    pa = pairs_from(ak)
    assign(pa[pa["gap"].between(-before, after)], "replacement_other")
    cut = ref_date - pd.DateOffset(months=cfg["label"]["backlog_months"])
    rest = out["class"] == ""
    blog = rest & (c.loc[out.index, "grace_d"] < cut).to_numpy()
    out.loc[blog, "class"] = "backlog"
    out.loc[blog, "rule"] = "grace_before_window"
    out.loc[out["class"] == "", "class"] = "true_churn"
    out.loc[(out["class"] == "true_churn") & c.loc[out.index, "term_date"].isna().to_numpy(), "rule"] = "no_term_date"
    lab = pd.DataFrame({"row": out.index, "cid": c.loc[out.index, "cid"].to_numpy(), "uid": c.loc[out.index, "uid"].to_numpy(),
                        "branch": c.loc[out.index, "branch_label"].to_numpy(), "term_date": c.loc[out.index, "term_date"].to_numpy(),
                        "class": out["class"].to_numpy(), "rule": out["rule"].to_numpy(), "days_gap": out["days_gap"].to_numpy(),
                        "matched_cid": np.where(out["matched"] >= 0, c["cid"].reindex(out["matched"]).fillna("").to_numpy(), "")})
    co_lab = pd.DataFrame({"row": co.index, "cid": co["cid"], "uid": co["uid"], "branch": co["branch_label"],
                           "term_date": co[["grace_d", "expiration_d"]].max(axis=1), "class": "change_ownership",
                           "rule": "status", "days_gap": np.nan, "matched_cid": ""})
    return pd.concat([lab, co_lab], ignore_index=True)


def termination_reasons(term: pd.DataFrame) -> pd.Series:
    if term.empty:
        return pd.Series(dtype=str)
    last = term.sort_values("created").drop_duplicates("cid", keep="last")
    return last.set_index("cid")["problem"].replace("", "Unspecified")


# ---------------------------------------------------------------- segments (Appendix C)
def _rx(words: list[str]) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(words) + r")\b", re.I)


def classify_segments(c: pd.DataFrame, holder: np.ndarray, live_count: pd.Series, cfg: dict) -> pd.DataFrame:
    S = cfg["segments"]
    subs = [(g["segment"], sub, _rx(kws)) for g in S["groups"] for sub, kws in g["subs"].items()]
    name_only = set(S["org_name_only"])
    excl = re.compile("|".join(S["name_exclusions"]), re.I)
    free = set(S["free_mail"]) | {cfg["holder"]["staff_email_domain"]}
    isp_dom = set(S["isp_domains"])
    comp_rx = re.compile(S["company_markers"], re.I)
    local_words = S["email_local_words"]
    n = len(c)
    seg = np.array([""] * n, dtype=object)
    sub_ = np.array([""] * n, dtype=object)
    conf = np.array([""] * n, dtype=object)
    plan = (c["product"] + " " + c["product_variant"]).str.lower().to_numpy()
    names = (c["name_n"] + " " + c["company_n"]).map(lambda s: excl.sub(" ", s)).to_numpy()
    emails = c["email_n"].to_numpy()
    ind = c["industrial"].str.lower().to_numpy()

    def match(text: str, allow_org=True):
        for sg, sb, rx in subs:
            if not allow_org and sb in name_only:
                continue
            if rx.search(text):
                return sg, sb
        return None

    for i in range(n):  # one pass over accounts (tens of thousands), regex only — no ticket loop
        if re.search(S["isp_products"], plan[i]):
            seg[i], sub_[i], conf[i] = "ISP / network partner", "Partner ISP", "High"
            continue
        if re.search(S["corporate_products"], plan[i]):
            seg[i], sub_[i], conf[i] = "Other business", "Corporate (Intracity / DIA)", "Medium"
            continue
        m = match(names[i])
        if m:
            seg[i], sub_[i], conf[i] = m[0], m[1], "High"
            continue
        em = emails[i]
        if "@" in em:
            local, dom = em.split("@", 1)
            if dom in isp_dom:
                seg[i], sub_[i], conf[i] = "ISP / network partner", "Partner ISP", "High"
                continue
            if dom not in free:
                m = match(re.sub(r"[.\-_]", " ", dom.rsplit(".", 1)[0]), allow_org=False) or next(
                    (r for r in (match(w, allow_org=False) for w in local_words if w in dom) if r), None)
                if m:
                    seg[i], sub_[i], conf[i] = m[0], m[1], "High"
                    continue
                seg[i], sub_[i], conf[i] = "Other business", "Company, type unknown", "Low"
                continue
            w = next((w for w in local_words if w in local), None)
            if w:
                m = match(w, allow_org=False)
                if m:
                    seg[i], sub_[i], conf[i] = m[0], m[1], "Medium"
                    continue
    df = pd.DataFrame({"segment": seg, "sub_segment": sub_, "segment_confidence": conf, "holder": holder})
    # 5. propagation from another account of the same holder (one level lower)
    lower = {"High": "Medium", "Medium": "Low", "Low": "Low"}
    known = df[(df["segment"] != "") & df["segment_confidence"].isin(["High", "Medium"])].drop_duplicates("holder")
    prop = df["holder"].map(known.set_index("holder")["segment"])
    blank = (df["segment"] == "") & prop.notna()
    df.loc[blank, "sub_segment"] = df.loc[blank, "holder"].map(known.set_index("holder")["sub_segment"])
    df.loc[blank, "segment_confidence"] = df.loc[blank, "holder"].map(known.set_index("holder")["segment_confidence"]).map(lower)
    df.loc[blank, "segment"] = prop[blank]
    # 6. Industrial field, then company markers
    for i in np.where(df["segment"] == "")[0]:
        m = match(ind[i]) if ind[i] else None
        if m:
            df.iat[i, 0], df.iat[i, 1], df.iat[i, 2] = m[0], m[1], "Low"
        elif comp_rx.search(names[i]):
            df.iat[i, 0], df.iat[i, 1], df.iat[i, 2] = "Other business", "Company, type unknown", "Low"
    # 7–8
    blank = df["segment"] == ""
    many = live_count.to_numpy() >= S["needs_verification_min_live"]
    df.loc[blank & many, ["segment", "sub_segment", "segment_confidence"]] = ["Needs verification", "Multi-account holder", "Low"]
    df.loc[blank & ~many, ["segment", "sub_segment", "segment_confidence"]] = ["Household / personal", "Household", "Medium"]
    return df.drop(columns="holder")


# ---------------------------------------------------------------- snapshots + features
def live_mask(c: pd.DataFrame, s: pd.Timestamp, cfg: dict) -> pd.Series:
    excl = [x.lower() for x in cfg["population"]["exclude_statuses"]]
    gone = c["is_term"] & ~(c["term_date"] >= s)   # terminated before s, or termination date unknown
    return (c["start_date"] < s) & ~c["status"].str.lower().isin(excl) & ~gone


def snapshot_dates(d: Data, cfg: dict) -> list[pd.Timestamp]:
    H = cfg["label"]["horizon_days"]
    first = (pd.Timestamp(d.dq["ticket_date_min"]) + pd.Timedelta(days=cfg["population"]["min_history_days"]))
    first = (first + pd.offsets.MonthBegin(0)).normalize()
    out = []
    s = first
    while s + pd.Timedelta(days=H) <= d.score_date:
        out.append(s)
        s = s + pd.offsets.MonthBegin(1)
    return out


def _count(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    return df.groupby("cid")[cols].sum() if len(df) else pd.DataFrame(columns=cols)


def ticket_features(t: pd.DataFrame, s: pd.Timestamp) -> pd.DataFrame:
    before = t[t["date"] < s]
    w90 = before[before["date"] >= s - 90 * DAY]
    w30 = w90[w90["date"] >= s - 30 * DAY]
    flags = [c for c in t.columns if c.startswith("f_")]
    f = _count(w90, flags)
    f.columns = [c[2:] + "_90" for c in f.columns]
    f["tickets_90"] = w90.groupby("cid").size()
    f["reports_90"] = w90.groupby("cid")["total_reports"].sum()
    f["tickets_30"] = w30.groupby("cid").size()
    f["complaint_30"] = w30.groupby("cid")["f_complaint"].sum()
    f["inet_cmp_30"] = w30.groupby("cid")["f_inet_cmp"].sum()
    cmp = w90[w90["f_complaint"] == 1].sort_values(["cid", "created"])
    if len(cmp):
        res = (cmp["solved"] - cmp["created"]) / pd.Timedelta(hours=1)
        res = res.where(res >= 0)
        g = res.groupby(cmp["cid"])
        f["cmp_res_h_mean_90"] = g.mean()
        f["cmp_res_h_max_90"] = g.max()
        gap = cmp.groupby("cid")["created"].diff() / DAY
        f["repeat_cmp_90"] = (gap <= 7).groupby(cmp["cid"]).sum()
    last_cmp = before[before["f_complaint"] == 1].groupby("cid")["date"].max()
    last_any = before.groupby("cid")["date"].max()
    f = f.reindex(f.index.union(last_any.index))
    f["days_since_last_complaint"] = ((s - last_cmp) / DAY).reindex(f.index)
    f["days_since_last_any_contact"] = ((s - last_any) / DAY).reindex(f.index)
    return f


def wo_features(w: pd.DataFrame, s: pd.Timestamp) -> pd.DataFrame:
    if w.empty:
        return pd.DataFrame()
    x = w[(w["created"] < s) & (w["created"] >= s - 90 * DAY)].sort_values(["cid", "created"])
    f = pd.DataFrame(index=pd.Index(x["cid"].unique(), name="cid"))
    for k in ("WWR", "WCM", "WGM"):
        f["wo_" + k.lower() + "_90"] = (x["kind"] == k).groupby(x["cid"]).sum()
    gap = x.groupby("cid")["created"].diff() / DAY
    f["wo_repeat_30"] = (gap <= 30).groupby(x["cid"]).sum()
    done = x[x["dow"].notna() & (x["dow"] < s)]
    delay = (done["dow"] - done["created"]) / DAY
    f["wo_delay_mean"] = delay.groupby(done["cid"]).mean()
    f["wo_delay_max"] = delay.groupby(done["cid"]).max()
    return f


def geo_features(c: pd.DataFrame, live: pd.Series, pop_idx: pd.Index, t: pd.DataFrame, s: pd.Timestamp, cfg: dict) -> pd.DataFrame:
    from sklearn.neighbors import BallTree
    R = cfg["features"]["geo_radius_m"] / 6371000.0
    w = t[(t["date"] < s) & (t["date"] >= s - 90 * DAY)]
    pos = c.set_index("cid")[["lat", "lng", "area"]]
    pts = {}
    for name, m in (("inet", w["f_inet_cmp"] == 1), ("mass", w["f_mass"] == 1)):
        p = pos.reindex(w.loc[m, "cid"])
        pts[name] = p
    L = c[live & c["lat"].notna()]
    out = pd.DataFrame(index=pop_idx)
    P = c.loc[pop_idx]
    has = P["lat"].notna()
    out["geo_inet_rate_90"] = np.nan
    out["geo_mass_90"] = np.nan
    if len(L) and has.any():
        q = np.radians(P.loc[has, ["lat", "lng"]].to_numpy())
        n_live = BallTree(np.radians(L[["lat", "lng"]].to_numpy()), metric="haversine").query_radius(q, r=R, count_only=True)
        for name, col in (("inet", "geo_inet_rate_90"), ("mass", "geo_mass_90")):
            pp = pts[name].dropna(subset=["lat"])
            cnt = BallTree(np.radians(pp[["lat", "lng"]].to_numpy()), metric="haversine").query_radius(q, r=R, count_only=True) if len(pp) else np.zeros(len(q))
            out.loc[has[has].index, col] = cnt / np.maximum(1, n_live)
    # fallback: Area
    la = c.loc[live, "area"].value_counts()
    for name, col in (("inet", "geo_inet_rate_90"), ("mass", "geo_mass_90")):
        ac = pts[name]["area"].value_counts()
        rate = (ac / la.reindex(ac.index).clip(lower=1)).fillna(0)
        miss = out[col].isna()
        out.loc[miss, col] = P.loc[miss[miss].index, "area"].map(rate).fillna(0).to_numpy()
    return out


@dataclass
class Ctx:
    holder: np.ndarray
    seg: pd.DataFrame
    labels: pd.DataFrame
    cfg: dict


def build_features(d: Data, ctx: Ctx, s: pd.Timestamp, pop: pd.Index) -> pd.DataFrame:
    c, cfg = d.customers, ctx.cfg
    H = cfg["label"]["horizon_days"]
    live = live_mask(c, s, cfg)
    P = c.loc[pop]
    F = pd.DataFrame(index=pop)
    for col in ("product", "branch_label", "priority", "industry", "term_len", "speed_mbps", "flag_residential", "flag_employee",
                "flag_promo", "monthly_fee", "discount", "disc_pct", "net_fee", "sales_recorded"):
        F[col] = P[col]
    F = F.rename(columns={"branch_label": "branch"})
    F["tenure_days"] = ((s - P["start_date"]) / DAY).to_numpy()
    F = F.join(renewal_position(P["start_date"], P["term_len"], s, H))
    hid = pd.Series(ctx.holder, index=c.index)
    hl = hid[live].value_counts()
    F["holder_live_accounts"] = hid[pop].map(hl).fillna(0).clip(upper=cfg["holder"]["mega_holder_live"]).to_numpy()
    F["mega_holder"] = (hid[pop].map(hl).fillna(0) >= cfg["holder"]["mega_holder_live"]).astype(int).to_numpy()
    for col in ("segment", "sub_segment", "segment_confidence"):
        F[col] = ctx.seg.loc[pop, col].to_numpy()
    tf = ticket_features(d.tickets, s)
    cid = P["cid"]
    T = tf.reindex(cid.to_numpy())
    T.index = pop
    F = F.join(T)
    cntc = [x for x in F.columns if (x.endswith("_90") or x.endswith("_30")) and not x.startswith("cmp_res")]
    F[cntc] = F[cntc].fillna(0)
    F["days_since_last_complaint"] = F["days_since_last_complaint"].fillna(999)
    F["days_since_last_any_contact"] = F["days_since_last_any_contact"].fillna(999)
    allc = tf["complaint_90"].reindex(c["cid"].to_numpy()).fillna(0).to_numpy()
    hc = pd.Series(allc, index=c.index).groupby(hid).sum()
    F["holder_complaints_90"] = hid[pop].map(hc).fillna(0).to_numpy()
    lab = ctx.labels
    prior = lab[(lab["class"] == "true_churn") & (lab["term_date"] < s)]
    ph = set(hid.loc[prior["row"]].to_numpy())
    F["holder_prior_true_churn"] = hid[pop].isin(ph).astype(int).to_numpy()
    wf = wo_features(d.wo, s)
    for k in ("wo_wwr_90", "wo_wcm_90", "wo_wgm_90", "wo_repeat_30", "wo_delay_mean", "wo_delay_max"):
        F[k] = wf[k].reindex(cid.to_numpy()).to_numpy() if k in wf else np.nan
    F[["wo_wwr_90", "wo_wcm_90", "wo_wgm_90", "wo_repeat_30"]] = F[["wo_wwr_90", "wo_wcm_90", "wo_wgm_90", "wo_repeat_30"]].fillna(0)
    F = F.join(geo_features(c, live, pop, d.tickets, s, cfg))
    if d.csat is not None:
        cs = d.csat[(d.csat["date"] < s)].sort_values("date")
        F["csat_last"] = cs.groupby("cid")["score"].last().reindex(cid.to_numpy()).to_numpy()
        r90 = cs[cs["date"] >= s - 90 * DAY]
        F["csat_low_90"] = (r90["score"] <= 3).groupby(r90["cid"]).sum().reindex(cid.to_numpy()).fillna(0).to_numpy()
    bad = FORBIDDEN_FEATURES & set(F.columns)
    assert not bad, f"leakage: forbidden columns in features: {bad}"
    return F


def drop_current_value_fields(d: Data, labels: pd.DataFrame, cfg: dict) -> tuple[list[str], dict]:
    """Compare current-value fields between true-churn terminated and live accounts (total variation distance)."""
    c = d.customers
    churned = c.loc[labels.loc[labels["class"] == "true_churn", "row"]]
    live = c[c["status"].str.lower().isin(["active", "blocked", "graced"])]
    mapping = {"priority": ["priority"], "product_variant": ["speed_mbps", "flag_residential", "flag_employee", "flag_promo"],
               "monthly_fee": ["monthly_fee", "net_fee", "disc_pct"], "discount": ["discount", "disc_pct", "net_fee"], "industry": ["industry"]}
    report, drop = {}, []
    for fld in cfg["current_value_check"]["fields"]:
        a, b = churned[fld], live[fld]
        if a.dtype.kind in "fi":
            edges = np.unique(np.nanquantile(pd.concat([a, b]).dropna(), np.linspace(0, 1, 11))) if len(a) and len(b) else []
            a, b = pd.cut(a, edges, include_lowest=True).astype(str), pd.cut(b, edges, include_lowest=True).astype(str)
        pa, pb = a.value_counts(normalize=True), b.value_counts(normalize=True)
        tvd = float(0.5 * (pa.reindex(pa.index.union(pb.index), fill_value=0) - pb.reindex(pa.index.union(pb.index), fill_value=0)).abs().sum()) if len(a) and len(b) else 0.0
        report[fld] = {"tvd": round(tvd, 4), "top_churned": str(pa.index[0]) if len(pa) else None, "top_live": str(pb.index[0]) if len(pb) else None}
        if tvd > cfg["current_value_check"]["max_tvd"]:
            drop += mapping.get(fld, [])
            report[fld]["dropped"] = True
    return sorted(set(drop)), report


def build_snapshots(d: Data, ctx: Ctx, snaps: list[pd.Timestamp]) -> pd.DataFrame:
    c, cfg = d.customers, ctx.cfg
    H = pd.Timedelta(days=cfg["label"]["horizon_days"])
    lab = ctx.labels.set_index("row")
    cls = pd.Series("", index=c.index).where(~c.index.isin(lab.index), lab["class"].reindex(c.index))
    frames = []
    for s in snaps:
        pop = c.index[live_mask(c, s, cfg) & c["is_retail"]]
        td = c.loc[pop, "term_date"]
        inwin = (td >= s) & (td < s + H)
        y = (inwin & (cls[pop] == "true_churn")).astype(int)
        drop = inwin & cls[pop].isin(REPLACEMENT_CLASSES)
        keep = pop[~drop.to_numpy()]
        F = build_features(d, ctx, s, keep)
        F["y"] = y[keep].to_numpy()
        F["snapshot"] = s
        F["cid"] = c.loc[keep, "cid"].to_numpy()
        frames.append(F)
        log.info("snapshot %s: population %d · dropped replacements %d · positives %d", s.date(), len(pop), int(drop.sum()), int(F["y"].sum()))
    return pd.concat(frames)


# ---------------------------------------------------------------- modelling
def feature_columns(df: pd.DataFrame, drop: list[str]) -> list[str]:
    skip = {"y", "snapshot", "cid"} | set(drop)
    return [c for c in df.columns if c not in skip]


def to_matrix(df: pd.DataFrame, cols: list[str], cats: dict[str, list]) -> pd.DataFrame:
    X = df[cols].copy()
    for c in cols:
        if c in CAT_FEATURES:
            X[c] = pd.Categorical(X[c].astype(str), categories=cats[c])
        else:
            X[c] = pd.to_numeric(X[c], errors="coerce").astype(float)
    return X


def topk(y: np.ndarray, p: np.ndarray, ks=(1, 5, 10, 20)) -> dict:
    y = np.asarray(y)
    order = np.argsort(-p, kind="stable")
    base = y.mean() if len(y) else 0
    out = {}
    for k in ks:
        n = max(1, int(math.ceil(len(y) * k / 100)))
        top = y[order[:n]]
        prec = float(top.mean())
        out[str(k)] = {"n": n, "precision": prec, "recall": float(top.sum() / max(1, y.sum())), "lift": float(prec / base) if base else None}
    return out


def evaluate(y: np.ndarray, p: np.ndarray) -> dict:
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    y = np.asarray(y)
    both = len(np.unique(y)) == 2
    r = {"n": int(len(y)), "positives": int(y.sum()), "base_rate": float(y.mean()) if len(y) else None,
         "roc_auc": float(roc_auc_score(y, p)) if both else None, "pr_auc": float(average_precision_score(y, p)) if both else None,
         "brier": float(brier_score_loss(y, np.clip(p, 0, 1))) if len(y) else None, "top": topk(y, p)}
    dec = pd.qcut(pd.Series(p).rank(method="first"), 10, labels=False) if len(y) >= 10 else pd.Series(np.zeros(len(y)))
    cal = pd.DataFrame({"d": dec.to_numpy(), "p": p, "y": y}).groupby("d").agg(pred=("p", "mean"), actual=("y", "mean"), n=("y", "size"))
    r["calibration"] = [{"decile": int(i) + 1, "pred": float(row.pred), "actual": float(row.actual), "n": int(row.n)} for i, row in cal.iterrows()]
    return r


def rule_score(df: pd.DataFrame) -> np.ndarray:
    return (df["renewal_within_horizon"].fillna(0) * 2 + (df["priority"].astype(str).str.lower() == "low")
            + (df["tenure_days"] > 90) + (df["days_since_last_complaint"] > 90)).to_numpy(dtype=float) + df["days_to_next_renewal"].fillna(999).rank(ascending=False).to_numpy() * 1e-9


def make_lr(cols: list[str]):
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler
    cat = [c for c in cols if c in CAT_FEATURES]
    num = [c for c in cols if c not in CAT_FEATURES]
    pre = ColumnTransformer([("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), num),
                             ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="missing")),
                                               ("oh", OneHotEncoder(handle_unknown="ignore", min_frequency=20))]), cat)])
    return Pipeline([("pre", pre), ("lr", LogisticRegression(C=1.0, penalty="l2", max_iter=3000))])


def lr_frame(X: pd.DataFrame) -> pd.DataFrame:
    Z = X.copy()
    for c in Z.columns:
        if c in CAT_FEATURES:
            Z[c] = Z[c].astype(object).where(Z[c].notna(), "missing").astype(str)
    return Z


def xgb_model(cfg: dict, cols: list[str], spw: float, **kw):
    import xgboost as xgb
    m = cfg["model"]
    mono = {k: v for k, v in (m.get("monotone") or {}).items() if k in cols}
    return xgb.XGBClassifier(objective="binary:logistic", eval_metric="aucpr", tree_method="hist", enable_categorical=True,
                             max_cat_to_onehot=1, subsample=m["subsample"], colsample_bytree=m["colsample_bytree"],
                             random_state=m["seed"], n_jobs=-1, scale_pos_weight=spw, monotone_constraints=mono or None, **kw)


def psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    e = np.asarray(expected, dtype=float)
    a = np.asarray(actual, dtype=float)
    e, a = e[~np.isnan(e)], a[~np.isnan(a)]
    if len(e) < 10 or len(a) < 10:
        return float("nan")
    edges = np.unique(np.quantile(e, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return 0.0
    edges[0], edges[-1] = -np.inf, np.inf
    pe = np.histogram(e, edges)[0] / len(e) + 1e-6
    pa = np.histogram(a, edges)[0] / len(a) + 1e-6
    return float(np.sum((pa - pe) * np.log(pa / pe)))


def iso_fit(p: np.ndarray, y: np.ndarray) -> dict:
    from sklearn.isotonic import IsotonicRegression
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(p, y)
    return {"x": iso.X_thresholds_.tolist(), "y": iso.y_thresholds_.tolist()}


def iso_apply(cal: dict, p: np.ndarray) -> np.ndarray:
    return np.interp(p, np.asarray(cal["x"]), np.asarray(cal["y"]))


# ---------------------------------------------------------------- reason codes (Appendix A) + plays (Appendix B)
REASONS = {
    "days_to_next_renewal": ("RENEWAL_SOON", "Renewal due in {v} days"),
    "renewal_within_horizon": ("RENEWAL_SOON", "Renewal falls inside the next 60 days"),
    "renewals_completed": ("FIRST_RENEWAL", "{v} renewals completed so far"),
    "first_cycle": ("FIRST_RENEWAL", "Approaching first renewal"),
    "days_since_last_any_contact": ("SILENT", "No contact with CS for {v} days"),
    "days_since_last_complaint": ("SILENT", "No complaint for {v} days"),
    "outbound_90": ("OUTBOUND", "{v} outbound follow-up calls in 90 days"),
    "holder_live_accounts": ("SINGLE_ACCOUNT", "Holder has only {v} live account(s)"),
    "priority": ("LOW_PRIORITY", "Priority: {v}"),
    "term_len": ("SHORT_TERM", "{v} payment plan"),
    "geo_inet_rate_90": ("AREA_OUTAGES", "{v} outage tickets per account within 500 m (90 days)"),
    "geo_mass_90": ("AREA_OUTAGES", "{v} mass-outage tickets per account within 500 m (90 days)"),
    "repeat_cmp_90": ("REPEAT_FAULT", "Repeat faults: {v} in 90 days"),
    "wo_repeat_30": ("REPEAT_FAULT", "Repeat work orders within 30 days: {v}"),
    "cmp_res_h_max_90": ("SLOW_FIX", "Longest fix took {v} hours"),
    "cmp_res_h_mean_90": ("SLOW_FIX", "Fixes took {v} hours on average"),
    "wo_delay_max": ("SLOW_FIX", "Longest work-order wait {v} days"),
    "wo_delay_mean": ("SLOW_FIX", "Work orders waited {v} days on average"),
    "tech_late_90": ("TECH_LATE", "Technician arrived late {v}×"),
    "tech_issue_90": ("TECH_LATE", "{v} technician or field-team complaints"),
    "work_result_90": ("TECH_LATE", "{v} complaints about work results"),
    "inet_billing_issue_90": ("BILLING_BLOCK", "Blocked for billing {v}× in 90 days"),
    "reactivation_90": ("BILLING_BLOCK", "Reactivated after a block {v}× in 90 days"),
    "pay_failed_90": ("PAY_FAIL", "{v} failed payment transactions"),
    "billing_problem_90": ("PAY_FAIL", "{v} billing/payment problems"),
    "post_payment_90": ("PAY_FAIL", "{v} payment confirmations needed"),
    "grace_ext_90": ("PAY_FAIL", "Asked for a grace-period extension {v}×"),
    "change_cycle_90": ("PAY_FAIL", "Asked to change billing cycle"),
    "downgrade_90": ("DOWNGRADE", "Asked to downgrade"),
    "upgrade_90": ("ENGAGEMENT", "Asked to upgrade {v}×"),
    "temp_inactive_90": ("TEMP_INACTIVE", "Requested temporary inactivation"),
    "hw_relocation_90": ("MOVING_SIGNAL", "Device relocation requested"),
    "change_address_90": ("MOVING_SIGNAL", "Address change requested"),
    "discount": ("NO_DISCOUNT", "No discount on current plan"),
    "disc_pct": ("NO_DISCOUNT", "Discount {v} of the monthly fee"),
    "mygx_90": ("NO_APP", "Not using MyGX"),
    "tenure_days": ("TENURE", "Customer for {v} days"),
    "inet_90": ("FAULTS", "{v} internet tickets in 90 days"),
    "inet_cmp_90": ("FAULTS", "{v} internet complaints in 90 days"),
    "inet_cmp_30": ("FAULTS", "{v} internet complaints in 30 days"),
    "inet_cant_access_90": ("FAULTS", "Could not access the internet {v}×"),
    "inet_slow_90": ("FAULTS", "Slow connection reported {v}×"),
    "inet_wiredown_90": ("FAULTS", "Wire down {v}×"),
    "inet_onoff_90": ("FAULTS", "Connection on/off {v}×"),
    "mass_90": ("AREA_OUTAGES", "Hit by {v} mass outages"),
    "complaint_90": ("FAULTS", "{v} complaints in 90 days"),
    "complaint_30": ("FAULTS", "{v} complaints in 30 days"),
    "tickets_90": ("CONTACT_LOAD", "{v} tickets in 90 days"),
    "tickets_30": ("CONTACT_LOAD", "{v} tickets in 30 days"),
    "reports_90": ("CONTACT_LOAD", "{v} repeated reports on tickets"),
    "ctso_90": ("FAULTS", "{v} escalations to CTSO"),
    "canceled_90": ("CONTACT_LOAD", "{v} canceled tickets"),
    "walk_in_90": ("CONTACT_LOAD", "{v} walk-in visits"),
    "wo_wwr_90": ("REPEAT_FAULT", "{v} wiredown work orders in 90 days"),
    "wo_wcm_90": ("REPEAT_FAULT", "{v} maintenance work orders in 90 days"),
    "wo_wgm_90": ("AREA_OUTAGES", "{v} mass-outage work orders in 90 days"),
    "holder_complaints_90": ("FAULTS", "Holder filed {v} complaints in 90 days"),
    "holder_prior_true_churn": ("HOLDER_HISTORY", "Holder lost another account before"),
    "mega_holder": ("HOLDER_HISTORY", "Large multi-account holder"),
    "monthly_fee": ("PRICE", "Monthly fee {v}"),
    "net_fee": ("PRICE", "Net monthly fee {v}"),
    "speed_mbps": ("PLAN", "{v} Mbps plan"),
    "product": ("PLAN", "Package {v}"),
    "branch": ("BRANCH", "Branch {v}"),
    "industry": ("SEGMENT", "Industry {v}"),
    "segment": ("SEGMENT", "Segment: {v}"),
    "sub_segment": ("SEGMENT", "Segment: {v}"),
    "segment_confidence": ("SEGMENT", "Segment confidence {v}"),
    "sales_recorded": ("PLAN", "Sales owner recorded: {v}"),
    "flag_residential": ("PLAN", "Residential-complex package"),
    "flag_employee": ("PLAN", "Employee package"),
    "flag_promo": ("PLAN", "Promo package"),
    "csat_last": ("CSAT", "Last CSAT score {v}"),
    "csat_low_90": ("CSAT", "{v} low CSAT scores in 90 days"),
}
PLAY_ORDER = [("BILLING_HELP", {"BILLING_BLOCK", "PAY_FAIL"}), ("FIX_FIRST", {"REPEAT_FAULT", "AREA_OUTAGES", "SLOW_FIX", "TECH_LATE", "FAULTS"}),
              ("RELOCATE", {"MOVING_SIGNAL"}), ("RENEWAL_CHECKIN", {"RENEWAL_SOON", "FIRST_RENEWAL", "SHORT_TERM"}),
              ("RIGHT_SIZE", {"DOWNGRADE", "NO_DISCOUNT", "PRICE", "TEMP_INACTIVE"})]
_warned: set = set()


def fmt_value(feat: str, v) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "n/a"
    if feat == "term_len":
        return {1: "Monthly", 3: "Quarterly", 6: "Semester", 12: "Annual"}.get(int(v), f"{int(v)}-month")
    if feat == "disc_pct":
        return f"{float(v):.0%}"
    if feat in ("monthly_fee", "net_fee"):
        return "Rp {:,.0f}".format(float(v)).replace(",", ".")
    if feat.startswith("geo_"):
        return f"{float(v):.2f}"
    if isinstance(v, (int, np.integer)) or (isinstance(v, float) and float(v).is_integer()):
        return str(int(v))
    if isinstance(v, float):
        return f"{v:.1f}"
    return str(v)


def phrase(feat: str, v) -> tuple[str, str]:
    if feat not in REASONS:
        if feat not in _warned:
            log.warning("reason dictionary has no entry for %s", feat)
            _warned.add(feat)
        return "OTHER", f"{feat} = {fmt_value(feat, v)}"
    code, tpl = REASONS[feat]
    if feat == "priority" and str(v).lower() != "low":
        code = "PRIORITY"
    if feat == "discount" and v not in (0, 0.0):
        return "PRICE", f"Discount Rp {float(v):,.0f}".replace(",", ".")
    if feat == "mygx_90" and v not in (0, 0.0):
        return "ENGAGEMENT", f"Used MyGX {fmt_value(feat, v)}× in 90 days"
    if feat == "holder_live_accounts" and float(v or 0) > 1:
        return "MULTI_ACCOUNT", f"Holder has {fmt_value(feat, v)} live accounts"
    if feat == "first_cycle" and not v:
        return "FIRST_RENEWAL", "Past the first prepaid term"
    if feat in ("days_since_last_any_contact", "days_since_last_complaint") and float(v) >= 999:
        return code, "No contact with CS on record" if feat.endswith("contact") else "No complaint on record"
    return code, tpl.format(v=fmt_value(feat, v))


def play_for(codes: list[str]) -> str:
    for play, keys in PLAY_ORDER:
        if any(c in keys for c in codes):
            return play
    return "ENGAGE"


# ---------------------------------------------------------------- output folder
def out_dir(cfg: dict) -> Path:
    root = Path(cfg["paths"]["drive_root"])
    p = root / cfg["paths"]["output_folder"] if root.exists() else Path(cfg["paths"]["local_output"])
    (p / "models").mkdir(parents=True, exist_ok=True)
    return p


def registry(out: Path) -> dict:
    f = out / "models" / "registry.json"
    return json.loads(f.read_text()) if f.exists() else {"accepted": [], "runs": []}


def jdump(obj, path: Path):
    def default(o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return None if np.isnan(o) else float(o)
        if isinstance(o, (pd.Timestamp,)):
            return str(o.date())
        if isinstance(o, np.ndarray):
            return o.tolist()
        return str(o)
    path.write_text(re.sub(r"\bNaN\b|-?\bInfinity\b", "null", json.dumps(obj, default=default, indent=1)), encoding="utf-8")


# ---------------------------------------------------------------- shared prep
def prepare(cfg: dict):
    t0 = time.time()
    d = load_data(cfg)
    assert_no_leakage(d.tickets, cfg)
    c = d.customers
    holder = build_holders(c, cfg)
    live_now = live_mask(c, d.score_date, cfg)
    hl = pd.Series(holder)[live_now.to_numpy()].value_counts()
    seg = classify_segments(c, holder, pd.Series(holder).map(hl).fillna(0), cfg)
    lw = cfg["label"]["relocation_window"]
    dw = cfg["label"]["dashboard_window"]
    labels = classify_terminations(c, cfg, lw["before"], lw["after"], d.score_date)
    labels14 = classify_terminations(c, cfg, dw["before"], dw["after"], d.score_date)
    labels["class_w14"] = labels14.set_index("row")["class"].reindex(labels["row"]).to_numpy()
    reasons = termination_reasons(d.term_tickets)
    labels["term_reason"] = labels["cid"].map(reasons).fillna("")
    labels["start_date"] = c.loc[labels["row"], "start_date"].to_numpy()
    labels["tenure_months"] = np.floor((labels["term_date"] - labels["start_date"]) / DAY / 30.44)
    counts = {"canonical_window": f"-{lw['before']}/+{lw['after']} days",
              "w90_60": labels["class"].value_counts().to_dict(), "w14": labels["class_w14"].value_counts().to_dict()}
    term_only = labels[labels["class"] != "change_ownership"]
    counts["replacement_share"] = float(term_only["class"].isin(["swap", "relocation", "replacement_other"]).mean()) if len(term_only) else None
    log.info("terminations %d · replacement share %.1f%% (reference ≈69%%)", len(term_only), (counts["replacement_share"] or 0) * 100)
    log.info("prep done in %.0fs", time.time() - t0)
    return d, Ctx(holder, seg, labels, cfg), counts


def config_hash(cfg: dict, d: Data) -> str:
    blob = json.dumps(cfg, sort_keys=True, default=str) + d.dq["ticket_date_min"] + d.dq["ticket_date_max"] + str(len(d.tickets))
    return hashlib.sha1(blob.encode()).hexdigest()[:6]


# ---------------------------------------------------------------- train
def train(cfg: dict) -> dict:
    t0 = time.time()
    d, ctx, counts = prepare(cfg)
    out = out_dir(cfg)
    snaps = snapshot_dates(d, cfg)
    if len(snaps) < 4:
        raise DataQualityError(f"only {len(snaps)} labelled snapshots; need at least 4 (train/val/test + 1)")
    S = build_snapshots(d, ctx, snaps)
    drop, cv_report = drop_current_value_fields(d, ctx.labels, cfg)
    cols = feature_columns(S, drop)
    assert not (FORBIDDEN_FEATURES & set(cols))
    cats = {c: sorted(S[c].astype(str).unique().tolist()) for c in cols if c in CAT_FEATURES}
    tr, va, te = S[S["snapshot"] < snaps[-2]], S[S["snapshot"] == snaps[-2]], S[S["snapshot"] == snaps[-1]]
    Xtr, Xva, Xte = (to_matrix(x, cols, cats) for x in (tr, va, te))
    ytr, yva, yte = tr["y"].to_numpy(), va["y"].to_numpy(), te["y"].to_numpy()
    pos, neg = max(1, ytr.sum()), max(1, len(ytr) - ytr.sum())
    m = cfg["model"]
    from sklearn.metrics import average_precision_score
    base = dict(max_depth=4, learning_rate=0.06, min_child_weight=5, reg_lambda=1, n_estimators=m["n_estimators"], early_stopping_rounds=m["early_stopping_rounds"])
    spw_opts = {"sqrt": math.sqrt(neg / pos), "ratio": neg / pos}
    spw_res = {}
    for k, v in spw_opts.items():
        mdl = xgb_model(cfg, cols, v, **base).fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
        spw_res[k] = float(average_precision_score(yva, mdl.predict_proba(Xva)[:, 1]))
    spw_key = max(spw_res, key=spw_res.get)
    spw = spw_opts[spw_key]
    log.info("scale_pos_weight: %s (val PR-AUC sqrt %.4f · ratio %.4f)", spw_key, spw_res["sqrt"], spw_res["ratio"])
    best = None
    G = m["grid"]
    n_grid = len(G["max_depth"]) * len(G["learning_rate"]) * len(G["min_child_weight"]) * len(G["reg_lambda"])
    i_grid = 0
    log.info("grid search: %d combinations on %d training rows", n_grid, len(Xtr))
    for md in G["max_depth"]:
        for lr in G["learning_rate"]:
            for mcw in G["min_child_weight"]:
                for lam in G["reg_lambda"]:
                    kw = dict(max_depth=md, learning_rate=lr, min_child_weight=mcw, reg_lambda=lam, n_estimators=m["n_estimators"], early_stopping_rounds=m["early_stopping_rounds"])
                    mdl = xgb_model(cfg, cols, spw, **kw).fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
                    ap = float(average_precision_score(yva, mdl.predict_proba(Xva)[:, 1]))
                    i_grid += 1
                    log.info("grid %d/%d · depth %d lr %.2f mcw %d lambda %d · val PR-AUC %.4f · %.0fs", i_grid, n_grid, md, lr, mcw, lam, ap, time.time() - t0)
                    if best is None or ap > best["val_pr_auc"]:
                        best = {"params": kw, "val_pr_auc": ap, "best_iteration": int(mdl.best_iteration), "model": mdl}
    log.info("grid best: %s · val PR-AUC %.4f · %d rounds", {k: v for k, v in best["params"].items() if k not in ("n_estimators", "early_stopping_rounds")}, best["val_pr_auc"], best["best_iteration"] + 1)
    M = best["model"]
    pva, pte = M.predict_proba(Xva)[:, 1], M.predict_proba(Xte)[:, 1]
    cal = iso_fit(pva, yva)
    pte_c = iso_apply(cal, pte)
    res = {"xgboost": evaluate(yte, pte_c)}
    lr_m = make_lr(cols).fit(lr_frame(Xtr), ytr)
    res["logistic_regression"] = evaluate(yte, lr_m.predict_proba(lr_frame(Xte))[:, 1])
    res["rule"] = evaluate(yte, rule_score(te))
    # tiers on the test fold → empirical rates
    tc = cfg["tiers"]
    pct = pd.Series(pte_c).rank(pct=True, method="first").to_numpy() * 100
    tier_te = np.where(pct > 100 - tc["high_pct"], "High", np.where(pct > 100 - tc["medium_pct"], "Medium", "Low"))
    tier_rates = {t: {"n": int((tier_te == t).sum()), "rate": float(yte[tier_te == t].mean()) if (tier_te == t).any() else None} for t in ("High", "Medium", "Low")}
    # per-segment
    thr = np.quantile(pte_c, 0.9)
    seg_rows = []
    grp = {"branch": te["branch"].astype(str), "product": te["product"].astype(str), "segment": te["segment"].astype(str),
           "tenure": np.where(te["tenure_days"] < 182, "New (< 6 months)", "Established")}
    from sklearn.metrics import roc_auc_score
    for g, vals in grp.items():
        for v in pd.unique(vals):
            mk = np.asarray(vals) == v
            yy, pp = yte[mk], pte_c[mk]
            seg_rows.append({"group": g, "value": str(v), "n": int(mk.sum()), "positives": int(yy.sum()), "base_rate": float(yy.mean()),
                             "roc_auc": float(roc_auc_score(yy, pp)) if len(np.unique(yy)) == 2 else None,
                             "recall_top10_global": float(((pp >= thr) & (yy == 1)).sum() / max(1, yy.sum())) if yy.sum() else None})
    # rolling backtest
    folds = []
    for i in range(2, len(snaps)):
        s_test = snaps[i]
        trs = [s for s in snaps[:i] if s + pd.Timedelta(days=cfg["label"]["horizon_days"]) <= s_test]
        if len(trs) < 1:
            continue
        a, b = S[S["snapshot"].isin(trs)], S[S["snapshot"] == s_test]
        if a["y"].sum() < 5 or b["y"].sum() < 1:
            continue
        kw = {k: v for k, v in best["params"].items() if k != "early_stopping_rounds"}
        kw["n_estimators"] = best["best_iteration"] + 1
        mm = xgb_model(cfg, cols, spw, **kw).fit(to_matrix(a, cols, cats), a["y"].to_numpy(), verbose=False)
        r = evaluate(b["y"].to_numpy(), mm.predict_proba(to_matrix(b, cols, cats))[:, 1])
        folds.append({"test_snapshot": str(s_test.date()), "train_snapshots": len(trs), "n": r["n"], "positives": r["positives"],
                      "roc_auc": r["roc_auc"], "pr_auc": r["pr_auc"], "recall_top10": r["top"]["10"]["recall"], "precision_top1": r["top"]["1"]["precision"]})
    # final model on all labelled snapshots
    kw = {k: v for k, v in best["params"].items() if k != "early_stopping_rounds"}
    kw["n_estimators"] = best["best_iteration"] + 1
    Xall = to_matrix(S, cols, cats)
    final = xgb_model(cfg, cols, spw, **kw).fit(Xall, S["y"].to_numpy(), verbose=False)
    version = f"xgb-{d.score_date:%Y%m%d}-{config_hash(cfg, d)}"
    # explainability on the test fold, from the final model
    import xgboost as xgb
    contrib = final.get_booster().predict(xgb.DMatrix(Xte, enable_categorical=True), pred_contribs=True)
    sh = contrib[:, :-1]
    glob = []
    for j, c in enumerate(cols):
        v = pd.to_numeric(Xte[c], errors="coerce") if c not in CAT_FEATURES else None
        corr = float(np.corrcoef(v.fillna(v.median()), sh[:, j])[0, 1]) if v is not None and v.nunique() > 1 and np.std(sh[:, j]) > 0 else None
        direction = "mixed" if corr is None or abs(corr) < 0.1 else ("raises" if corr > 0 else "lowers")
        glob.append({"feature": c, "mean_abs_shap": float(np.abs(sh[:, j]).mean()), "direction": direction, "corr": corr, "label": REASONS.get(c, ("OTHER", c))[1]})
    glob.sort(key=lambda r: -r["mean_abs_shap"])
    dep = {}
    for r in glob[:8]:
        c = r["feature"]
        j = cols.index(c)
        if c in CAT_FEATURES:
            g = pd.DataFrame({"v": Xte[c].astype(str), "s": sh[:, j]}).groupby("v")["s"].agg(["mean", "size"]).sort_values("size", ascending=False).head(10)
            dep[c] = [{"bin": k, "mean_shap": float(row["mean"]), "n": int(row["size"])} for k, row in g.iterrows()]
        else:
            v = pd.to_numeric(Xte[c], errors="coerce")
            q = pd.qcut(v.rank(method="first"), 10, labels=False, duplicates="drop") if v.notna().sum() >= 10 else pd.Series(0, index=v.index)
            g = pd.DataFrame({"q": q.to_numpy(), "v": v.to_numpy(), "s": sh[:, j]}).groupby("q").agg(v=("v", "mean"), s=("s", "mean"), n=("s", "size"))
            dep[c] = [{"bin": float(row.v) if not np.isnan(row.v) else None, "mean_shap": float(row.s), "n": int(row.n)} for _, row in g.iterrows()]
    x, l = res["xgboost"], res["logistic_regression"]
    reasons = []
    if cfg["gate"]["require_beats_lr_prauc"] and not ((x["pr_auc"] or 0) > (l["pr_auc"] or 0)):
        reasons.append(f"XGBoost PR-AUC {x['pr_auc']:.3f} does not beat logistic regression {l['pr_auc']:.3f}")
    if x["top"]["10"]["recall"] < cfg["gate"]["min_recall_top10"]:
        reasons.append(f"recall at top 10% {x['top']['10']['recall']:.2f} is below {cfg['gate']['min_recall_top10']:.2f}")
    status = "accepted" if not reasons else "rejected"
    num_cols = [c for c in cols if c not in CAT_FEATURES]
    top10 = [r["feature"] for r in glob if r["feature"] in num_cols][:10]
    meta = {
        "model_version": version, "status": status, "gate_reasons": reasons, "trained_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "train_date": str(d.score_date.date()), "horizon_days": cfg["label"]["horizon_days"],
        "snapshots": [str(s.date()) for s in snaps], "split": {"train": [str(s.date()) for s in snaps[:-2]], "validation": str(snaps[-2].date()), "test": str(snaps[-1].date())},
        "population": S.groupby("snapshot").agg(n=("y", "size"), positives=("y", "sum")).reset_index().assign(snapshot=lambda z: z["snapshot"].astype(str)).to_dict("records"),
        "data_quality": d.dq, "label_counts": counts, "current_value_check": cv_report, "dropped_features": drop,
        "features": cols, "categorical_features": [c for c in cols if c in CAT_FEATURES], "categories": cats,
        "categorical_handling": "native XGBoost categorical splits (enable_categorical=True, max_cat_to_onehot=1): keeps branch/product/segment as single columns and avoids sparse one-hot trees; the logistic baseline uses one-hot.",
        "monotone_constraints": cfg["model"].get("monotone"), "scale_pos_weight": {"chosen": spw_key, "value": spw, "val_pr_auc": spw_res},
        "params": {k: v for k, v in best["params"].items() if k != "early_stopping_rounds"}, "best_iteration": best["best_iteration"],
        "validation_pr_auc": best["val_pr_auc"], "test": res, "tier_rates": tier_rates, "tier_cutoffs": tc,
        "per_segment": seg_rows, "backtest": folds, "calibration_map": cal, "global_shap": glob, "dependence": dep,
        "train_reference": {"score": pte_c.tolist(), "features": {c: pd.to_numeric(Xte[c], errors="coerce").dropna().tolist() for c in top10}},
        "base_logit": float(contrib[:, -1].mean()),
        "csat_note": d.dq.get("csat_note"), "limitations": LIMITS,
        "benchmark": {"xgboost": {"roc_auc": 0.88, "pr_auc": 0.17, "recall_top10": 0.61, "precision_top1": 0.23}, "logistic_regression": {"roc_auc": 0.83, "pr_auc": 0.05, "recall_top10": 0.46}, "rule": {"recall_top10": 0.33}, "base_rate": 0.012},
    }
    final.save_model(str(out / "models" / f"churn_model_{version}.json"))
    jdump(meta, out / "models" / f"churn_meta_{version}.json")
    reg = registry(out)
    reg["runs"].append({"version": version, "status": status, "reasons": reasons, "date": meta["trained_at"]})
    if status == "accepted":
        reg["accepted"].append(version)
    jdump(reg, out / "models" / "registry.json")
    log.info("TRAIN SUMMARY · %d snapshots · test n=%d pos=%d · XGB ROC %.3f PR %.3f R@10 %.2f P@1 %.2f · LR PR %.3f R@10 %.2f · rule R@10 %.2f · gate %s %s · %.0fs",
             len(snaps), x["n"], x["positives"], x["roc_auc"] or 0, x["pr_auc"] or 0, x["top"]["10"]["recall"], x["top"]["1"]["precision"],
             l["pr_auc"] or 0, l["top"]["10"]["recall"], res["rule"]["top"]["10"]["recall"], status, "; ".join(reasons), time.time() - t0)
    return meta


LIMITS = [
    "Priority, Product Variant, Monthly Fee, Discount and Industrial are current values, not history; fields that differ sharply between churned and live accounts are dropped (see current_value_check).",
    "Renewal dates are derived from Start Date + k × term length, not from billing records.",
    "Mega-holders (≥ 30 live accounts) are property managers, agents or B2B; holder features are capped at 30 and they are reported separately.",
    "Branches outside Bali have small samples; per-branch metrics there are indicative only.",
    "Intracity, DIA and Partner ISP plans are excluded from the retail model.",
    "Termination date = later of Grace and Expiration. The dashboard's Retail page uses Expiration only.",
]


# ---------------------------------------------------------------- score
def score(cfg: dict) -> dict:
    import xgboost as xgb
    t0 = time.time()
    out = out_dir(cfg)
    reg = registry(out)
    if not reg["accepted"]:
        log.warning("no accepted model yet: nothing scored")
        if reg["runs"]:
            last = reg["runs"][-1]
            mf = out / "models" / f"churn_meta_{last['version']}.json"
            if mf.exists():
                meta = json.loads(mf.read_text())
                meta["last_run"] = last
                meta["scored"] = False
                jdump(meta, out / "churn_model_meta.json")
        return {}
    version = reg["accepted"][-1]
    meta = json.loads((out / "models" / f"churn_meta_{version}.json").read_text())
    booster = xgb.Booster()
    booster.load_model(str(out / "models" / f"churn_model_{version}.json"))
    d, ctx, counts = prepare(cfg)
    c, s = d.customers, d.score_date
    sc_st = [x.lower() for x in cfg["population"]["score_statuses"]]
    pop = c.index[c["status"].str.lower().isin(sc_st) & (c["start_date"] < s) & c["is_retail"]]
    F = build_features(d, ctx, s, pop)
    cols = meta["features"]
    X = to_matrix(F, cols, meta["categories"])
    contrib = booster.predict(xgb.DMatrix(X, enable_categorical=True), pred_contribs=True)
    logit = contrib.sum(axis=1)
    raw = 1 / (1 + np.exp(-logit))
    prob = iso_apply(meta["calibration_map"], raw)
    sh = contrib[:, :-1]
    tc = cfg["tiers"]
    pct = pd.Series(prob).rank(pct=True, method="first").to_numpy() * 100
    tier = np.where(pct > 100 - tc["high_pct"], "High", np.where(pct > 100 - tc["medium_pct"], "Medium", "Low"))
    P = c.loc[pop]
    month = f"{s:%Y%m}"
    ctrl = np.array([(stable_hash(cid + month) % 100) < cfg["control_share"] for cid in P["cid"]]) & (tier == "High")
    term90 = d.term_tickets[(d.term_tickets["date"] < s) & (d.term_tickets["date"] >= s - 90 * DAY)].sort_values("created").drop_duplicates("cid", keep="last").set_index("cid")["problem"]
    vals = X.astype(object).to_numpy()
    r_code, r_val, r_shap, drv, plays = [], [], [], [], []
    for i in range(len(X)):
        order = np.argsort(-sh[i])
        pos = [j for j in order if sh[i, j] > 0][:3]
        row_c, row_v, row_s = [], [], []
        for j in pos:
            code, text = phrase(cols[j], vals[i, j])
            row_c.append(code); row_v.append(text); row_s.append(round(float(sh[i, j]), 4))
        while len(row_c) < 3:
            row_c.append(""); row_v.append(""); row_s.append(np.nan)
        r_code.append(row_c); r_val.append(row_v); r_shap.append(row_s)
        plays.append(play_for([x for x in row_c if x]))
        top6 = np.argsort(-np.abs(sh[i]))[:6]
        drv.append([(phrase(cols[j], vals[i, j])[1], round(float(sh[i, j]), 4)) for j in top6])
    seg = ctx.seg.loc[pop]
    hid = pd.Series(ctx.holder, index=c.index)
    S = pd.DataFrame({
        "snapshot_date": str(s.date()), "model_version": version, "cid": P["cid"].to_numpy(), "uid": P["uid"].to_numpy(),
        "branch": P["branch_label"].to_numpy(), "area": P["area"].to_numpy(), "lat": P["lat"].round(6).to_numpy(), "lng": P["lng"].round(6).to_numpy(),
        "product": P["product"].to_numpy(), "product_variant": P["product_variant"].to_numpy(), "term_len": P["term_len"].to_numpy(),
        "net_monthly_fee": P["net_fee"].to_numpy(), "status_now": P["status"].to_numpy(),
        "expiration_now": P["expiration_d"].dt.strftime("%Y-%m-%d").fillna("").to_numpy(),
        "tenure_days": F["tenure_days"].round().to_numpy(), "days_to_next_renewal": F["days_to_next_renewal"].to_numpy(),
        "segment": seg["segment"].to_numpy(), "sub_segment": seg["sub_segment"].to_numpy(), "segment_confidence": seg["segment_confidence"].to_numpy(),
        "mega_holder": F["mega_holder"].to_numpy(), "holder_live_accounts": F["holder_live_accounts"].to_numpy(), "holder_id": hid[pop].to_numpy(),
        "prob": np.round(prob, 5), "score_pct": np.round(pct, 2), "tier": tier, "expected_mrr_at_risk": np.round(prob * P["net_fee"].to_numpy()),
        "logit": np.round(logit, 4),
    })
    for k in range(3):
        S[f"reason{k + 1}_code"] = [r[k] for r in r_code]
        S[f"reason{k + 1}_value"] = [r[k] for r in r_val]
        S[f"reason{k + 1}_shap"] = [r[k] for r in r_shap]
    for k in range(6):
        S[f"drv{k + 1}_text"] = [r[k][0] if k < len(r) else "" for r in drv]
        S[f"drv{k + 1}_shap"] = [r[k][1] if k < len(r) else np.nan for r in drv]
    S["action_code"] = plays
    S["term_request_90d"] = S["cid"].map(term90).fillna("")
    S["control_group"] = ctrl.astype(int)
    S = S.sort_values("prob", ascending=False)
    S.to_csv(out / "churn_scores_latest.csv", index=False)
    S.to_csv(out / f"churn_scores_{s:%Y%m%d}.csv", index=False)
    segs = S.groupby(["branch", "segment", "tier", "product"]).agg(accounts=("cid", "size"), expected_churn=("prob", "sum"), mrr_at_risk=("expected_mrr_at_risk", "sum"), control=("control_group", "sum")).reset_index()
    segs.to_csv(out / "churn_segments.csv", index=False)
    lab = ctx.labels.drop(columns="row").copy()
    lab["term_date"] = pd.to_datetime(lab["term_date"]).dt.strftime("%Y-%m-%d")
    lab["start_date"] = pd.to_datetime(lab["start_date"]).dt.strftime("%Y-%m-%d")
    lab[["cid", "uid", "branch", "term_date", "class", "matched_cid", "rule", "days_gap", "class_w14", "term_reason", "start_date", "tenure_months"]].to_csv(out / "churn_labels.csv", index=False)
    mon = monitoring(out, ctx.labels, cfg, s)
    tr = meta.pop("train_reference", {})
    drift = {"score_psi": psi(np.asarray(tr.get("score", [])), prob), "features": {}}
    for f_, ref in tr.get("features", {}).items():
        if f_ in X.columns:
            drift["features"][f_] = psi(np.asarray(ref), pd.to_numeric(X[f_], errors="coerce").to_numpy())
    worst = max([drift["score_psi"]] + list(drift["features"].values()), key=lambda v: -1 if v is None or np.isnan(v) else v)
    drift["status"] = "retrain" if worst > 0.25 else "watch" if worst > 0.10 else "stable"
    tr_rates = meta.get("tier_rates", {})
    exp_tier = float(sum((tier == t).sum() * (tr_rates.get(t, {}).get("rate") or 0) for t in ("High", "Medium", "Low")))
    last = reg["runs"][-1] if reg["runs"] else None
    meta.update({
        "scored": True, "snapshot_date": str(s.date()), "scored_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "accounts_scored": int(len(S)), "high_tier": int((tier == "High").sum()), "control_accounts": int(ctrl.sum()),
        "expected_true_churn": float(prob.sum()), "expected_true_churn_tier_method": exp_tier,
        "mrr_at_risk": float(S["expected_mrr_at_risk"].sum()), "term_request_live": int((S["term_request_90d"] != "").sum()),
        "drift": drift, "monitoring_rows": int(len(mon)), "label_counts": counts, "data_quality": d.dq,
        "last_run": last, "reason_codes": sorted({v[0] for v in REASONS.values()}),
    })
    jdump(meta, out / "churn_model_meta.json")
    log.info("SCORE SUMMARY · %s · %d accounts · High %d (control %d) · expected true churn %.1f (tier method %.1f) · drift %s · %.0fs",
             version, len(S), (tier == "High").sum(), ctrl.sum(), prob.sum(), exp_tier, drift["status"], time.time() - t0)
    return meta


def monitoring(out: Path, labels: pd.DataFrame, cfg: dict, now: pd.Timestamp) -> pd.DataFrame:
    H = pd.Timedelta(days=cfg["label"]["horizon_days"])
    tc = labels[labels["class"] == "true_churn"][["cid", "term_date"]]
    rows = []
    for f in sorted(out.glob("churn_scores_2*.csv")):
        run = pd.Timestamp(f.stem.split("_")[-1])
        if run + H > now:
            continue
        S = pd.read_csv(f, dtype={"cid": str})
        hit = tc[(tc["term_date"] >= run) & (tc["term_date"] < run + H)]["cid"]
        S["y"] = S["cid"].isin(set(hit)).astype(int)
        top = S["score_pct"] >= 90
        prec = float(S.loc[top, "y"].mean()) if top.any() else None
        rec = float(S.loc[top, "y"].sum() / max(1, S["y"].sum()))
        for (t, cg), g in S.groupby(["tier", "control_group"]):
            rows.append({"run_date": str(run.date()), "model_version": g["model_version"].iloc[0], "tier": t, "control_group": int(cg), "n": len(g),
                         "actual_true_churn": int(g["y"].sum()), "actual_rate": float(g["y"].mean()), "predicted_mean_prob": float(g["prob"].mean()),
                         "precision_top10": prec, "recall_top10": rec})
    M = pd.DataFrame(rows, columns=["run_date", "model_version", "tier", "control_group", "n", "actual_true_churn", "actual_rate", "predicted_mean_prob", "precision_top10", "recall_top10"])
    M.to_csv(out / "churn_monitoring.csv", index=False)
    return M


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="CX Intelligence churn risk pipeline")
    ap.add_argument("mode", choices=["train", "score", "all"])
    ap.add_argument("--config", default=str(Path(__file__).with_name("config.yaml")))
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    cfg = load_config(a.config)
    log.info("start · drive_root %s", cfg["paths"]["drive_root"])
    try:
        if a.mode in ("train", "all"):
            train(cfg)
        if a.mode in ("score", "all"):
            score(cfg)
    except DataQualityError as e:
        log.error("STOPPED: %s", e)
        sys.exit(2)


if __name__ == "__main__":
    main()
