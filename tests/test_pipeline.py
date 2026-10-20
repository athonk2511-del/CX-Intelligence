"""Unit tests on small synthetic fixtures. Run: pytest ml/tests -q"""
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ml import churn_pipeline as cp

CFG = cp.load_config(Path(__file__).resolve().parents[1] / "config.yaml")


def cust(rows):
    base = {k: "" for k in cp.CUST_COLS}
    df = pd.DataFrame([{**base, **r} for r in rows])
    return cp.prepare_customers(df, CFG, {})


# ---------------------------------------------------------------- parsers
def test_parsers():
    assert cp.parse_money(pd.Series(["Rp 300.000", "Rp 1.250.000,00", "-", ""])).tolist()[:2] == [300000, 1250000]
    assert cp.parse_money(pd.Series(["-"])).isna().all()
    d = cp.parse_date(pd.Series(["05/01/2026", "5/1/2026 13:04:05", "-", "2026-01-05"]))
    assert d[0] == pd.Timestamp("2026-01-05") and d[1] == pd.Timestamp("2026-01-05 13:04:05") and pd.isna(d[2]) and d[3] == pd.Timestamp("2026-01-05")
    assert cp.norm_cid(pd.Series(["260 078 906", "-"])).tolist() == ["260078906", ""]
    assert cp.detect_delimiter("a;b;c") == ";" and cp.detect_delimiter("a\tb\tc") == "\t" and cp.detect_delimiter("a,b") == ","
    df = cp.read_csv_text("\ufeffA;B\n1;-\n")
    assert list(df.columns) == ["A", "B"] and df.iloc[0, 1] == "-"


# ---------------------------------------------------------------- renewal math
def test_renewal_quarterly_and_monthly():
    start = pd.Series(pd.to_datetime(["2026-01-15", "2026-01-15", "2026-01-31"]))
    r = cp.renewal_position(start, pd.Series([3, 3, 1]), pd.Timestamp("2026-03-01"), 60)
    assert r["days_to_next_renewal"].iloc[0] == (pd.Timestamp("2026-04-15") - pd.Timestamp("2026-03-01")).days
    r2 = cp.renewal_position(start, pd.Series([3, 3, 1]), pd.Timestamp("2026-04-20"), 60)
    assert r2["renewals_completed"].iloc[0] == 1
    assert r2["days_to_next_renewal"].iloc[0] == (pd.Timestamp("2026-07-15") - pd.Timestamp("2026-04-20")).days
    r3 = cp.renewal_position(start, pd.Series([3, 3, 1]), pd.Timestamp("2026-02-10"), 60)
    assert r3["days_to_next_renewal"].iloc[2] == (pd.Timestamp("2026-02-28") - pd.Timestamp("2026-02-10")).days  # Jan 31 + 1 month clamps
    assert cp.term_len_of(pd.Series(["Lite 50 Mbps QURTER", "Annual", "Monthly", "x QUATER"])).tolist() == [3, 12, 1, 3]


# ---------------------------------------------------------------- termination classes
def test_termination_classes():
    rows = [
        # swap: same coordinate + phone
        dict(cid="1", uid="a1A", holder_name="Ana", phone="081200000001", status="Termination", coordinates="-8.1, 115.1", start_date="01/01/2025", expiration="01/03/2026", grace="05/03/2026"),
        dict(cid="2", uid="a1B", holder_name="Ana", phone="081200000001", status="Active", coordinates="-8.1, 115.1", start_date="06/03/2026"),
        # relocation: different coordinate, 30 days after
        dict(cid="3", uid="b1", holder_name="Budi", phone="081200000002", status="Termination", coordinates="-8.2, 115.2", start_date="01/01/2025", expiration="01/03/2026"),
        dict(cid="4", uid="b2", holder_name="Budi", phone="081200000002", status="Active", coordinates="-8.3, 115.3", start_date="31/03/2026"),
        # relocation window edge: exactly 60 days after counts, 61 does not (falls to replacement_other? no — outside window → true churn)
        dict(cid="5", uid="c1", holder_name="Citra", phone="081200000003", status="Termination", coordinates="-8.4, 115.4", start_date="01/01/2025", expiration="01/03/2026"),
        dict(cid="6", uid="c2", holder_name="Citra", phone="081200000003", status="Active", coordinates="-8.5, 115.5", start_date="30/04/2026"),
        dict(cid="7", uid="d1", holder_name="Dewi", phone="081200000004", status="Termination", coordinates="-8.6, 115.6", start_date="01/01/2025", expiration="01/03/2026"),
        dict(cid="8", uid="d2", holder_name="Dewi", phone="081200000004", status="Active", coordinates="-8.7, 115.7", start_date="01/05/2026"),
        # replacement_other: other account without coordinates in window
        dict(cid="9", uid="e1", holder_name="Eka", phone="081200000005", status="Termination", coordinates="-8.8, 115.8", start_date="01/01/2025", expiration="01/03/2026"),
        dict(cid="10", uid="e2", holder_name="Eka", phone="081200000005", status="Termination", coordinates="", start_date="15/03/2026", expiration="15/04/2026"),
        # backlog: grace long before the window
        dict(cid="11", uid="f1", holder_name="Fajar", status="Termination", coordinates="-8.9, 115.9", start_date="01/01/2023", expiration="01/01/2024", grace="05/01/2024"),
        # change ownership
        dict(cid="12", uid="g1", holder_name="Gita", status="Change Ownership", start_date="01/01/2024"),
        # true churn
        dict(cid="13", uid="h1", holder_name="Hadi", status="Termination", coordinates="-8.95, 115.95", start_date="01/01/2025", expiration="01/03/2026"),
    ]
    c = cust(rows)
    lab = cp.classify_terminations(c, CFG, 90, 60, pd.Timestamp("2026-06-01")).set_index("cid")
    assert lab.loc["1", "class"] == "swap"
    assert lab.loc["3", "class"] == "relocation"
    assert lab.loc["5", "class"] == "relocation"          # +60 days, inside
    assert lab.loc["7", "class"] == "true_churn"          # +61 days, outside
    assert lab.loc["9", "class"] == "replacement_other"
    assert lab.loc["11", "class"] == "backlog"
    assert lab.loc["12", "class"] == "change_ownership"
    assert lab.loc["13", "class"] == "true_churn"
    # termination date = later of grace and expiration
    assert c.set_index("cid").loc["1", "term_date"] == pd.Timestamp("2026-03-05")
    lab14 = cp.classify_terminations(c, CFG, 14, 14, pd.Timestamp("2026-06-01")).set_index("cid")
    assert lab14.loc["3", "class"] != "relocation"       # 30 days is outside ±14


# ---------------------------------------------------------------- point-in-time + leakage
def tickets(rows):
    base = {k: "" for k in cp.TICKET_COLS}
    df = pd.DataFrame([{**base, **r} for r in rows])
    t, term, _ = cp.prepare_tickets(df, CFG)
    return t, term


def test_point_in_time_and_leakage():
    t, term = tickets([
        dict(cid="1", date="10/02/2026", created="10/02/2026 10:00:00", type="Complaint", category="Internet Problem", problem="Slow"),
        dict(cid="1", date="02/03/2026", created="02/03/2026 10:00:00", type="Complaint", category="Internet Problem", problem="Slow"),  # future
        dict(cid="1", date="11/02/2026", created="11/02/2026 10:00:00", type="Info", category="Termination", problem="Moving"),
        dict(cid="1", date="12/02/2026", created="12/02/2026 10:00:00", type="Info", category="Other", problem="Dismantle"),
    ])
    assert len(term) == 1 and len(t) == 2
    cp.assert_no_leakage(t, CFG)
    f = cp.ticket_features(t, pd.Timestamp("2026-03-01"))
    assert f.loc["1", "complaint_90"] == 1      # the 2 March ticket is ignored
    assert f.loc["1", "inet_slow_90"] == 1
    assert f.loc["1", "days_since_last_complaint"] == (pd.Timestamp("2026-03-01") - pd.Timestamp("2026-02-10")).days
    assert not any("termination" in c for c in f.columns)
    with pytest.raises(AssertionError):
        cp.assert_no_leakage(pd.concat([t, term]), CFG)


def test_forbidden_customer_columns_never_in_features():
    assert {"status", "grace", "expiration", "sum_of_price"} <= cp.FORBIDDEN_FEATURES


# ---------------------------------------------------------------- determinism + control group
def test_control_group_share_and_stability():
    cids = [str(100000 + i) for i in range(20000)]
    a = np.array([cp.stable_hash(c + "202610") % 100 < 15 for c in cids])
    b = np.array([cp.stable_hash(c + "202610") % 100 < 15 for c in cids])
    assert abs(a.mean() - 0.15) < 0.02 and (a == b).all()


def test_determinism_small_model():
    rng = np.random.default_rng(0)
    X = pd.DataFrame({"a": rng.normal(size=600), "b": rng.normal(size=600)})
    y = (X["a"] + rng.normal(scale=0.5, size=600) > 1.2).astype(int)
    p = [cp.xgb_model(CFG, ["a", "b"], 3.0, max_depth=3, learning_rate=0.06, min_child_weight=5, reg_lambda=1, n_estimators=50).fit(X, y).predict_proba(X)[:, 1] for _ in range(2)]
    assert np.array_equal(p[0], p[1])


# ---------------------------------------------------------------- privacy: no data files tracked under ml/
def test_no_data_files_staged():
    root = Path(__file__).resolve().parents[2]
    try:
        files = subprocess.run(["git", "ls-files", "--cached", "ml"], cwd=root, capture_output=True, text=True, check=True).stdout.split()
    except Exception:
        pytest.skip("not a git checkout")
    bad = [f for f in files if f.lower().endswith((".csv", ".parquet", ".pkl", ".pickle")) or "/output/" in f]
    assert not bad, f"data files tracked under ml/: {bad}"
