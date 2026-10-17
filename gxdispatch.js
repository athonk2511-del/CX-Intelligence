// GlobalXtreme BI — IDS dispatch planner, shown as the "Dispatch planner" mode of the Customer map page.
// Jobs are the latest open WWR work order per customer from the map data. Each job gets a priority
// score (ticket priority + job urgency + aging), is placed in a fixed 3 km cell of the same grid as the
// work-area painter, and is assigned to a team by drive time and working hours. Dispatchers reorder or
// move jobs by drag and drop. Plans, confirmations and aging are kept in this browser (localStorage).

const SANS = "500 12px 'IBM Plex Sans',system-ui,sans-serif";
const MONO = "500 11px 'IBM Plex Mono',ui-monospace,monospace";
const C = {
  ink: '#1F1F1D', text: '#3A3A37', muted: '#5F5F5B', line: '#DCDCD8', soft: '#EBEBE7', bg: '#F4F4F2', paper: '#FAFAF8', white: '#FFFFFF',
  acc: '#E8B400', accDeep: '#7A5E00', good: '#2E6B34', goodBg: '#EEF5EE', bad: '#B42318', badBg: '#FBF1EF', badLine: '#E2B8B1',
  warn: '#7A4A10', warnBg: '#FBF5E6', warnLine: '#E3CF96', vip: '#6D28D9', vipBg: '#F3EEFC',
};

export const TIERS = { VIP: { s: 10000, r: 5 }, Highest: { s: 800, r: 4 }, High: { s: 600, r: 3 }, Normal: { s: 400, r: 2 }, Low: { s: 200, r: 1 } };
export const CATS = {
  'Wiredown': { s: 500, lvl: 'Critical', d: 120, src: 'recorded' },
  'Perbaikan Power': { s: 400, lvl: 'High', d: 180, src: 'recorded' },
  'Pindah Jalur Kabel': { s: 300, lvl: 'Medium', d: 120, src: 'assumed' },
  'Perapian Kabel': { s: 100, lvl: 'Low', d: 60, src: 'assumed' },
  'Reposisi ONU': { s: 100, lvl: 'Low', d: 60, src: 'assumed' },
  'FO Project': { s: 50, lvl: 'Low', d: 360, src: 'recorded' },
};
export const AGING = 200;
const LS = 'gx.dispatch.v1';
const CONF = { none: 'Not contacted', ok: 'Confirmed', noresp: 'No answer', resched: 'Asks to reschedule' };
const STAT = { none: 'Not started', start: 'On the way', checkin: 'Checked in', checkout: 'Checked out' };
const BASES = [
  [/bali|denpasar|badung|kerobokan/i, { name: 'GX Kerobokan', lat: -8.6705, lng: 115.1655 }],
  [/malang/i, { name: 'GX Malang', lat: -7.9797, lng: 112.6304 }],
];
const DEF = {
  teams: 10, gridKm: 3, target: 4, speed: 22, road: 1.3, maxHop: 30, ring: 1, ring2: 2, hop2: 45,
  start: 540, cut: 960, end: 1020, ot: false, maxAge: 30, blocked: false, prog: true,
  dur: Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, v.d])), bases: {}, branch: '',
};

const pad = n => String(n).padStart(2, '0');
const hm = m => { m = Math.round(m); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fmtN = v => Math.round(v).toLocaleString('en-US');
const nf1 = v => (Math.round(v * 10) / 10).toFixed(1);
// Ticket priority (column G of the work order ticket) → scoring tier. Unreadable values count as Normal and are flagged.
const tierOf = raw => { const v = String(raw || '').toLowerCase(); return /vip/.test(v) ? 'VIP' : /highest/.test(v) ? 'Highest' : /high/.test(v) ? 'High' : /low/.test(v) ? 'Low' : /normal|medium|standard/.test(v) ? 'Normal' : null; };
// Job type from the ticket's category and problem text; anything unrecognised stays Wiredown.
const catOf = (a, b) => { const v = (String(a || '') + ' ' + String(b || '')).toLowerCase();
  return /power|listrik|adaptor|adapter|psu/.test(v) ? 'Perbaikan Power' : /pindah jalur|reroute|re-route|jalur kabel/.test(v) ? 'Pindah Jalur Kabel'
    : /perapian|rapikan|rapi kabel/.test(v) ? 'Perapian Kabel' : /reposisi|pindah onu|pindah modem|relokasi onu/.test(v) ? 'Reposisi ONU' : /project/.test(v) ? 'FO Project' : 'Wiredown'; };
function hav(a, b) {
  const t = Math.PI / 180, dl = (b.lat - a.lat) * t, dn = (b.lng - a.lng) * t;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dn / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

export function createDispatch(o) { return new Dispatch(o); }

class Dispatch {
  constructor(o) {
    this.R = o.React; this.M = o.map; this.pal = o.palette; this.onChange = o.onChange;
    this.st = this.load();
    this.ui = { settings: false, drag: null, drop: null, armed: false, msg: null, draft: null, nextAll: false };
    this.ver = 1;
  }

  /* ---------- persistence ---------- */
  load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    const cfg = { ...DEF, ...(s.cfg || {}) };
    cfg.dur = { ...DEF.dur, ...((s.cfg || {}).dur || {}) };
    cfg.bases = { ...((s.cfg || {}).bases || {}) };
    return { cfg, plans: s.plans || {}, meta: s.meta || {}, log: Array.isArray(s.log) ? s.log.slice(0, 200) : [] };
  }
  save() { try { localStorage.setItem(LS, JSON.stringify(this.st)); } catch (e) {} }
  changed(msg) {
    if (msg) this.note(msg);
    this.ver++; this.save(); this.onChange();
  }
  note(msg) {
    const d = new Date();
    this.st.log.unshift({ t: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()), msg });
    this.st.log = this.st.log.slice(0, 200);
  }
  meta(key) { return this.st.meta[key] || (this.st.meta[key] = { conf: 'none', stat: 'none', aging: [] }); }

  /* ---------- jobs from the map data ---------- */
  branchIdx(m, hostBi) {
    if (hostBi >= 0) return hostBi;
    const want = this.st.cfg.branch;
    let bi = want ? m.branches.indexOf(want) : -1;
    if (bi < 0) bi = m.branches.findIndex(b => /bali/i.test(b));
    if (bi < 0) {
      const cnt = m.branches.map(() => 0);
      for (let i = 0; i < m.count; i++) if (m.wd[i] === 0) cnt[m.branch[i]]++;
      bi = cnt.indexOf(Math.max(...cnt));
    }
    return bi;
  }
  jobs(m, bi) {
    const cfg = this.st.cfg;
    const sig = [bi, cfg.maxAge, cfg.blocked, cfg.prog].join('|');
    if (this._jobs && this._jobs.m === m && this._jobs.sig === sig) return this._jobs.v;
    const now = Date.now(), maxMs = (+cfg.maxAge || 0) * 86400e3;
    const list = [], skipped = { old: 0, status: 0, noPrio: 0 };
    const push = (i, type, w, state) => {
      if (state > 1 || state < 0 || (state === 1 && !cfg.prog)) return;
      if (m.status[i] === 2 || (m.status[i] === 1 && !cfg.blocked)) { skipped.status++; return; }
      if (maxMs && w.t > 0 && now - w.t > maxMs) { skipped.old++; return; }
      const key = String(w.wo || (type + '-' + m.cid[i]));
      const tier = tierOf(w.prio);
      if (!tier) skipped.noPrio++;
      list.push({ key, i, type, wo: w.wo || '—', cid: String(m.cid[i]), uid: m.uid[i] || '', name: m.name[i] || '', area: m.area ? m.area[i] || '' : '',
        lat: m.lat[i], lng: m.lng[i], t: w.t || 0, raw: w.raw || '', prog: state === 1,
        cat: catOf(w.cat, w.prob), prob: w.prob || w.cat || '', prio: w.prio || '', noPrio: !tier, tier: tier || 'Normal' });
    };
    // WWR only for now; WCM maintenance orders are left out of the planner.
    for (let i = 0; i < m.count; i++) {
      if (m.branch[i] !== bi) continue;
      if (m.wd[i] >= 0 && m.wdInfo[i]) push(i, 'WWR', m.wdInfo[i], m.wd[i]);
    }
    const by = new Map(list.map(j => [j.key, j]));
    const v = { list, by, skipped };
    this._jobs = { m, sig, v };
    return v;
  }
  base(m, bi, J) {
    const name = m.branches[bi] || '';
    const saved = this.st.cfg.bases[name];
    if (saved && isFinite(saved.lat) && isFinite(saved.lng)) return { ...saved, name: saved.name || name + ' base', guess: false };
    const hit = BASES.find(([re]) => re.test(name));
    if (hit) return { ...hit[1], guess: true };
    const n = J.list.length || 1;
    return { name: name + ' centre of jobs', lat: J.list.reduce((a, j) => a + j.lat, 0) / n || -8.67, lng: J.list.reduce((a, j) => a + j.lng, 0) / n || 115.17, guess: true };
  }

  /* ---------- scoring ---------- */
  aging(j) { const a = this.st.meta[j.key]; return a ? a.aging.length : 0; }
  score(j) { return TIERS[j.tier].s + CATS[j.cat].s + AGING * this.aging(j); }
  urgent(j) { return CATS[j.cat].s >= 400; }
  vipLate(j) { return j.tier === 'VIP' && !this.urgent(j); }
  locked(j) { const s = (this.st.meta[j.key] || {}).stat; return j.prog || s === 'start' || s === 'checkin' || s === 'checkout'; }
  // Score, then urgency, then customer tier, then oldest work order first.
  cmp = (a, b) => this.score(b) - this.score(a) || CATS[b.cat].s - CATS[a.cat].s || TIERS[b.tier].r - TIERS[a.tier].r || a.t - b.t;
  dur(j) { return +this.st.cfg.dur[j.cat] || CATS[j.cat].d; }
  km(a, b) { return hav(a, b) * this.st.cfg.road; }
  travel(a, b) { const d = this.km(a, b); return d < 0.05 ? 0 : Math.max(3, Math.round(d / Math.max(5, this.st.cfg.speed) * 60)); }
  cell(j) {
    const c = this.M.cellOf(j.lat, j.lng, this.st.cfg.gridKm * 1000);
    return { c: c[0], r: c[1], key: c[0] + ',' + c[1] };
  }
  ring(a, b) { const x = this.cell(a), y = this.cell(b); return Math.max(Math.abs(x.c - y.c), Math.abs(x.r - y.r)); }
  cellName(j) { return this.M.cellLabel(this.cell(j).key); }

  /* ---------- planning ---------- */
  today() { return ymd(new Date()); }
  // Keeps one plan per branch per day. A new day ages yesterday's internal deferrals and unfinished jobs.
  plan(m, bi, J, B) {
    const name = m.branches[bi] || 'Branch', day = this.today();
    let P = this.st.plans[name];
    if (P && P.date !== day) { this.rollover(P, J); P = null; }
    if (!P) {
      P = this.st.plans[name] = { date: day, teams: [], next: [], why: {}, manual: {} };
      this.autoPlan(P, J, B, false);
      this.note('Plan for ' + name + ' created automatically: ' + P.teams.reduce((a, t) => a + t.length, 0) + ' jobs scheduled, ' + P.next.length + ' deferred.');
      this.save();
      return P;
    }
    const known = new Set([...P.teams.flat(), ...P.next]);
    let drop = false;
    P.teams = P.teams.map(t => t.filter(k => J.by.has(k) || !(drop = true)));
    P.next = P.next.filter(k => J.by.has(k) || !(drop = true));
    const fresh = J.list.filter(j => !known.has(j.key));
    if (fresh.length) {
      fresh.sort(this.cmp).forEach(j => { if (!this.place(P, j, B, true)) { P.next.push(j.key); P.why[j.key] = 'internal'; } });
      this.note(fresh.length + ' new work order' + (fresh.length > 1 ? 's' : '') + ' added to the ' + name + ' plan.');
    }
    if (fresh.length || drop) this.save();
    return P;
  }
  rollover(P, J) {
    let n = 0;
    const age = k => { if (!J.by.has(k)) return; const mt = this.meta(k); if (!mt.aging.includes(P.date)) { mt.aging.push(P.date); n++; } };
    P.next.forEach(k => { if (P.why[k] !== 'customer') age(k); });
    P.teams.flat().forEach(k => { const j = J.by.get(k); if (j && !j.prog && (this.st.meta[k] || {}).stat !== 'checkout') age(k); });
    Object.keys(this.st.meta).forEach(k => {
      const mt = this.st.meta[k];
      if (!J.by.has(k) && Object.values(this.st.plans).every(p => p === P || ![...p.teams.flat(), ...p.next].includes(k))) { delete this.st.meta[k]; return; }
      mt.conf = 'none'; mt.stat = 'none';
    });
    if (n) this.note(n + ' job' + (n > 1 ? 's' : '') + ' from ' + P.date + ' carried over with aging +' + AGING + ' (internal reason).');
  }
  autoPlan(P, J, B, keepLocked) {
    const cfg = this.st.cfg, nT = Math.max(1, Math.round(cfg.teams));
    const old = P.teams || [], oldWhy = P.why || {};
    P.teams = Array.from({ length: nT }, () => []);
    P.why = {}; P.manual = {};
    const placed = new Set();
    if (keepLocked) old.forEach((t, i) => t.forEach(k => { const j = J.by.get(k); if (j && this.locked(j)) { P.teams[Math.min(i, nT - 1)].push(k); placed.add(k); } }));
    const hold = (keepLocked ? P.next || [] : []).filter(k => oldWhy[k] === 'customer' && J.by.has(k) && !placed.has(k));
    hold.forEach(k => placed.add(k));
    const pool = J.list.filter(j => !placed.has(j.key)).sort(this.cmp);
    const rest = pool.filter(j => !this.place(P, j, B, false));
    const rest2 = rest.filter(j => !this.place(P, j, B, true));
    rest2.forEach(j => { P.why[j.key] = 'internal'; });
    hold.forEach(k => { P.why[k] = 'customer'; });
    P.teams = P.teams.map(ids => this.vipLast(ids, J));
    P.next = rest2.map(j => j.key).concat(hold);
  }
  vipLast(ids, J) {
    const lk = ids.filter(k => this.locked(J.by.get(k))), free = ids.filter(k => !this.locked(J.by.get(k)));
    return lk.concat(free.filter(k => !this.vipLate(J.by.get(k))), free.filter(k => this.vipLate(J.by.get(k))));
  }
  walk(ids, B) {
    let t = this.st.cfg.start, pos = B;
    ids.forEach(k => { const j = this._J.by.get(k); if (!j) return; t += this.travel(pos, j) + this.dur(j); pos = j; });
    return { t, pos };
  }
  // Stage 1: same or neighbouring cell, normal hop limit, may open a new team.
  // Stage 2 (expand): only teams still under the target may reach further with a longer hop.
  place(P, j, B, expand) {
    const cfg = this.st.cfg, J = this._J;
    const maxRing = expand ? cfg.ring2 : cfg.ring, maxHop = expand ? cfg.hop2 : cfg.maxHop;
    let best = null;
    P.teams.forEach(ids => {
      if (!ids.length) return;
      if (expand && ids.length >= cfg.target) return;
      if (!ids.some(k => J.by.has(k) && this.ring(J.by.get(k), j) <= maxRing)) return;
      const s = this.walk(ids, B), hop = this.travel(s.pos, j);
      if (hop > maxHop) return;
      const arr = s.t + hop, end = arr + this.dur(j);
      if (arr > cfg.cut || (!cfg.ot && end > cfg.end)) return;
      if (!best || hop < best.hop || (hop === best.hop && ids.length < best.ids.length)) best = { ids, hop };
    });
    if (best) { best.ids.push(j.key); return true; }
    if (!expand) {
      const free = P.teams.find(ids => !ids.length);
      if (free) {
        const arr = cfg.start + this.travel(B, j), end = arr + this.dur(j);
        if (arr <= cfg.cut && (cfg.ot || end <= cfg.end)) { free.push(j.key); return true; }
      }
    }
    return false;
  }
  tidy(ids, B) {
    const J = this._J, lk = ids.filter(k => this.locked(J.by.get(k))), free = ids.filter(k => !this.locked(J.by.get(k)));
    const top = free.filter(k => { const j = J.by.get(k); return j.tier === 'VIP' && this.urgent(j); }).sort((a, b) => this.cmp(J.by.get(a), J.by.get(b)));
    const late = free.filter(k => this.vipLate(J.by.get(k))).sort((a, b) => this.cmp(J.by.get(a), J.by.get(b)));
    const mid = free.filter(k => !top.includes(k) && !late.includes(k));
    const out = lk.concat(top);
    let pos = out.length ? J.by.get(out[out.length - 1]) : B;
    while (mid.length) { mid.sort((a, b) => this.travel(pos, J.by.get(a)) - this.travel(pos, J.by.get(b))); const n = mid.shift(); out.push(n); pos = J.by.get(n); }
    return out.concat(late);
  }

  /* ---------- timeline ---------- */
  calc(P, B) {
    const cfg = this.st.cfg, J = this._J;
    return P.teams.map(ids => {
      let t = cfg.start, pos = B, work = 0, trav = 0, dist = 0;
      const rows = ids.map((k, n) => {
        const j = J.by.get(k), hop = this.travel(pos, j), d = this.km(pos, j), arr = t + hop, end = arr + this.dur(j), f = [];
        if (arr > cfg.cut) f.push(['bad', 'Starts ' + hm(arr) + ', after the ' + hm(cfg.cut) + ' cut-off']);
        if (end > cfg.end) f.push([cfg.ot ? 'warn' : 'bad', 'Ends ' + hm(end) + ', after ' + hm(cfg.end)]);
        if (n > 0 && hop > cfg.maxHop) f.push(['warn', hop + ' min hop, limit ' + cfg.maxHop]);
        if (this.vipLate(j) && ids.slice(n + 1).some(x => !this.vipLate(J.by.get(x)) && !this.locked(J.by.get(x)))) f.push(['warn', 'Non-urgent VIP: move after the other jobs']);
        if ((this.st.meta[k] || {}).conf === 'noresp') f.push(['warn', 'No answer yet: consider the end of the route']);
        work += this.dur(j); trav += hop; dist += d; t = end; pos = j;
        return { k, j, hop, d, arr, end, f };
      });
      return { ids, rows, work, trav, dist, finish: t };
    });
  }

  /* ---------- actions ---------- */
  move(P, key, dest, idx, label) {
    const J = this._J, j = J.by.get(key);
    if (!j || this.locked(j)) return;
    const from = P.next.includes(key) ? 'H+1' : 'Team ' + (P.teams.findIndex(t => t.includes(key)) + 1);
    P.teams = P.teams.map(t => t.filter(k => k !== key));
    P.next = P.next.filter(k => k !== key);
    const list = dest === 'next' ? P.next : P.teams[dest];
    list.splice(Math.max(0, Math.min(idx == null ? list.length : idx, list.length)), 0, key);
    if (dest === 'next') { if (!P.why[key]) P.why[key] = (this.meta(key).conf === 'resched') ? 'customer' : 'internal'; }
    else delete P.why[key];
    P.manual[key] = true;
    const to = dest === 'next' ? 'H+1' : 'Team ' + (dest + 1);
    this.changed(label || (j.wo + ' (' + (j.uid || j.cid) + ') ' + (from === to ? 'moved to position ' + (list.indexOf(key) + 1) + ' in ' + to : 'moved from ' + from + ' to ' + to) + (dest === 'next' ? ', reason ' + P.why[key] : '') + '.'));
  }

  /* ---------- view ---------- */
  // ctx: { host, mapBox, full, hideF, modeRow, hostBi, go(i) }
  view(m, ctx) {
    const R = this.R, e = R.createElement, host = ctx.host, cfg = this.st.cfg;
    const bi = this.branchIdx(m, ctx.hostBi);
    const J = this._J = this.jobs(m, bi);
    const B = this.base(m, bi, J);
    const P = this.plan(m, bi, J, B);
    this._ctx = { m, bi, P, B, name: m.branches[bi] };
    const T = this.calc(P, B);
    const pal = this.pal;
    const col = n => pal[n % pal.length];

    const chip = (key, on, label, color, count, onClick, title) => e('button', { key, type: 'button', onClick, title,
      style: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', border: '1px solid ' + (on ? C.ink : C.line), borderRadius: 3, background: on ? C.white : C.bg, color: on ? C.ink : '#8A8A85', font: SANS, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' } },
      color ? e('span', { style: { width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none', opacity: on ? 1 : 0.35 } }) : null,
      label, count != null ? e('span', { style: { font: MONO, color: C.muted } }, fmtN(count)) : null);
    const btn = (key, label, onClick, dark, extra) => e('button', { key, type: 'button', onClick,
      style: { padding: '5px 11px', border: '1px solid ' + (dark ? C.ink : C.line), borderRadius: 3, background: dark ? C.ink : C.white, color: dark ? C.white : C.ink, font: SANS, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none', ...(extra || {}) } }, label);
    const row = (label, kids, k) => e('div', { key: k || label, style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 } },
      e('span', { style: { font: "600 10.5px 'IBM Plex Mono',ui-monospace,monospace", letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, minWidth: 78 } }, label), ...kids);
    const pill = (txt, tone, k) => {
      const t = { bad: [C.badBg, C.bad, C.badLine], warn: [C.warnBg, C.warn, C.warnLine], vip: [C.vipBg, C.vip, '#D9CCF5'], good: [C.goodBg, C.good, '#C9DEC9'], acc: ['#FBF3D6', C.accDeep, '#EBD58A'] }[tone] || [C.bg, C.muted, C.line];
      return e('span', { key: k, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 3, border: '1px solid ' + t[2], background: t[0], color: t[1], font: "600 10.5px 'IBM Plex Mono',ui-monospace,monospace", whiteSpace: 'nowrap' } }, txt);
    };

    /* KPIs */
    const used = T.filter(t => t.ids.length), sched = used.reduce((a, t) => a + t.ids.length, 0);
    const nInt = P.next.filter(k => P.why[k] !== 'customer').length, nCus = P.next.length - nInt;
    const avail = cfg.end - cfg.start, work = used.reduce((a, t) => a + t.work, 0), trav = used.reduce((a, t) => a + t.trav, 0);
    const breaches = T.reduce((a, t) => a + t.rows.reduce((b, r) => b + r.f.filter(f => f[0] === 'bad').length, 0), 0);
    const kpis = [
      { label: 'Open jobs in scope', value: fmtN(J.list.length), sub: (m.branches[bi] || '') + ' · WWR, last ' + cfg.maxAge + ' days' },
      { label: 'Scheduled today', value: fmtN(sched), sub: used.length + ' of ' + cfg.teams + ' teams used' },
      { label: 'Deferred to H+1', value: fmtN(P.next.length), sub: nInt + ' internal (aging) · ' + nCus + ' customer' },
      { label: 'Jobs per team', value: used.length ? nf1(sched / used.length) : '0.0', sub: 'target ' + cfg.target },
      { label: 'Time utilisation', value: used.length ? Math.round(work / (used.length * avail) * 100) + '%' : '0%', sub: 'on-site work ÷ ' + hm(cfg.start) + '–' + hm(cfg.end) },
      { label: 'Working-hour breaches', value: fmtN(breaches), sub: work ? 'travel = ' + Math.round(trav / work * 100) + '% of work time' : 'no jobs scheduled' },
    ];

    /* controls above the map */
    const brs = m.branches.map((b, i) => i).filter(i => i === bi || this.hasJobs(m, i));
    const armed = this.ui.armed;
    const controls = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 } },
      ctx.modeRow(row),
      row('Branch', ctx.hostBi >= 0 ? [e('span', { key: 'bn', style: { font: SANS, color: C.ink } }, m.branches[bi]), e('span', { key: 'bh', style: { font: SANS, color: C.muted } }, 'set by the branch filter above')]
        : brs.map(i => chip('br' + i, i === bi, m.branches[i], null, null, () => { cfg.branch = m.branches[i]; this.changed(); }))),
      row('Plan', [
        e('span', { key: 'pd', style: { font: MONO, color: C.ink } }, new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })),
        e('span', { key: 'pb', style: { font: SANS, color: C.muted } }, 'from ' + B.name + (B.guess ? ' (approx.)' : '')),
        btn('rp', armed ? 'Click again to replace manual changes' : 'Re-plan automatically', () => this.replan(), true, armed ? { background: C.bad, borderColor: C.bad } : null),
        btn('td', 'Tidy all routes', () => { P.teams = P.teams.map(ids => ids.length ? this.tidy(ids, B) : ids); this.changed('All routes tidied by nearest next stop; VIP rules kept.'); }),
        btn('st', this.ui.settings ? 'Hide settings ▴' : 'Settings ▾', () => { this.ui.settings = !this.ui.settings; if (this.ui.settings) this.ui.draft = JSON.parse(JSON.stringify(cfg)); this.onChange(); }, false, this.ui.settings ? { borderColor: C.ink, background: C.bg } : null),
        this.ui.msg ? e('span', { key: 'msg', style: { font: SANS, color: C.muted } }, this.ui.msg) : null,
      ]),
      this.ui.settings ? this.settings(e, row, chip, btn) : null,
      row('Legend', [
        ...T.map((t, n) => t.ids.length ? e('span', { key: 'lg' + n, style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text } }, e('span', { style: { width: 10, height: 10, borderRadius: 2, background: col(n) } }), 'Team ' + (n + 1)) : null),
        e('span', { key: 'lgn', style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text } }, e('span', { style: { width: 10, height: 10, borderRadius: '50%', border: '2px solid #D9480F', boxSizing: 'border-box' } }), 'Deferred H+1'),
        e('span', { key: 'lgc', style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text } }, e('span', { style: { width: 12, height: 10, background: 'rgba(232,180,0,0.18)', border: '1px solid #B08A1E' } }), cfg.gridKm + ' km cell with jobs'),
      ], 'lgd'));

    const cards = [
      host.card('Dispatch map', {
        span: 12, meta: fmtN(J.list.length) + ' open jobs · ' + cfg.gridKm + ' km cells',
        body: host.mapFrame(controls, ctx.mapBox, ctx.full, ctx.hideF, SANS),
        note: 'Jobs are the latest WWR work order per customer whose status is not Closed or Canceled, dated within the last ' + cfg.maxAge + ' days, on ' + (cfg.blocked ? 'Active and Blocked' : 'Active') + ' accounts' + (J.skipped.old ? ' (' + fmtN(J.skipped.old) + ' older open orders left out)' : '') + '. Score = ticket priority (VIP 10,000 · Highest 800 · High 600 · Normal 400 · Low 200) + job urgency + aging (' + AGING + ' per working day carried over for an internal reason). Ties go to urgency, then tier, then the oldest order. Each job sits in a fixed ' + cfg.gridKm + ' km cell of the same grid as the work-area painter. A team takes jobs from its own or a neighbouring cell while the hop stays within ' + cfg.maxHop + ' min and the job can start by ' + hm(cfg.cut) + ' and end by ' + hm(cfg.end) + '; a full cell opens the next team. Teams below ' + cfg.target + ' jobs may then reach ' + cfg.ring2 + ' cells out within ' + cfg.hop2 + ' min. Drive time = straight line × ' + cfg.road + ' at ' + cfg.speed + ' km/h. Job type is read from the ticket category and problem; anything not recognised counts as Wiredown.' + (J.skipped.noPrio ? ' ' + fmtN(J.skipped.noPrio) + ' job' + (J.skipped.noPrio > 1 ? 's have' : ' has') + ' no readable priority on the ticket and count as Normal.' : ''),
      }),
      host.card('Dispatch board', {
        span: 12, meta: sched + ' scheduled · ' + P.next.length + ' deferred · ' + Object.keys(P.manual).length + ' manual changes',
        body: this.board(e, P, T, B, pill, col),
        note: 'Drag a card to reorder a route, move it to another team or defer it to H+1. On touch screens use the arrows and the Move to list. Jobs that are on the way, checked in, checked out or In Progress in the sheet are locked. Plans, confirmations and aging are saved in this browser only.',
      }),
      host.card('Load by ' + cfg.gridKm + ' km cell', { span: 7, meta: 'recommended teams = (job hours + ½ hop per job) ÷ ' + (avail / 60) + ' h', body: this.cellTable(e, P, host, col) }),
      host.card('Dispatcher change log', { span: 5, meta: 'latest first', body: this.logView(e) }),
    ];
    return { kpis, cards };
  }

  hasJobs(m, i) {
    this._has = this._has && this._has.m === m ? this._has : { m, v: {} };
    if (i in this._has.v) return this._has.v[i];
    let y = false;
    for (let k = 0; k < m.count && !y; k++) if (m.branch[k] === i && (m.wd[k] === 0 || m.wd[k] === 1)) y = true;
    return (this._has.v[i] = y);
  }

  replan() {
    if (!this.ui.armed) { this.ui.armed = true; clearTimeout(this._arm); this._arm = setTimeout(() => { this.ui.armed = false; this.onChange(); }, 4000); this.onChange(); return; }
    clearTimeout(this._arm); this.ui.armed = false;
    const { P, B } = this._ctx;
    this.autoPlan(P, this._J, B, true);
    this.changed('Plan re-run automatically. Locked jobs and customer reschedules were kept.');
  }

  board(e, P, T, B, pill, col) {
    const J = this._J, cols = [];
    T.forEach((t, n) => {
      const span = this.st.cfg.end - this.st.cfg.start;
      const cells = [...new Set(t.ids.map(k => this.cellName(J.by.get(k))))];
      cols.push(this.column(e, n, 'Team ' + (n + 1), col(n), t.ids.length ? [
        e('div', { key: 'bar', style: { display: 'flex', height: 6, borderRadius: 2, overflow: 'hidden', background: C.soft }, title: 'Dark = on-site work, yellow = travel' },
          e('div', { style: { width: Math.min(100, t.work / span * 100) + '%', background: C.ink } }),
          e('div', { style: { width: Math.max(0, Math.min(100 - t.work / span * 100, t.trav / span * 100)) + '%', background: C.acc } })),
        e('div', { key: 'mt', style: { display: 'flex', flexWrap: 'wrap', gap: '2px 10px', font: MONO, color: C.muted } },
          e('span', null, nf1(t.work / 60) + ' h work'), e('span', null, t.trav + ' min · ' + nf1(t.dist) + ' km'), e('span', { style: { color: t.finish > this.st.cfg.end ? C.bad : C.muted } }, 'done ' + hm(t.finish))),
        e('div', { key: 'cl', style: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' } }, ...cells.map(c => pill(c, null, c)),
          e('button', { key: 'tidy', type: 'button', onClick: () => { P.teams[n] = this.tidy(P.teams[n], B); this.changed('Team ' + (n + 1) + ' route tidied.'); }, style: { marginLeft: 'auto', padding: 0, border: 'none', background: 'none', color: C.ink, textDecoration: 'underline', textUnderlineOffset: 2, font: SANS, cursor: 'pointer' } }, 'Tidy route')),
      ] : [e('span', { key: 'idle', style: { font: SANS, color: C.muted } }, 'Standby')],
      t.ids.length >= this.st.cfg.target ? pill(t.ids.length + ' jobs', 'good') : pill(t.ids.length ? t.ids.length + ' jobs' : 'Idle', null),
      t.rows.map((r, i) => this.cardEl(e, P, r.j, r, n, i, pill)), P));
    });
    const shown = this.ui.nextAll ? P.next : P.next.slice(0, 60);
    cols.push(this.column(e, 'next', 'Defer to H+1', '#D9480F', [e('span', { key: 'nx', style: { font: SANS, color: C.warn } }, 'Internal reasons add aging +' + AGING + ' tomorrow. Customer requests do not.')],
      pill(P.next.length + ' jobs', 'warn'),
      shown.map((k, i) => this.cardEl(e, P, J.by.get(k), null, 'next', i, pill)).concat(P.next.length > shown.length ? [e('button', { key: 'more', type: 'button', onClick: () => { this.ui.nextAll = true; this.onChange(); }, style: { padding: '6px', border: '1px dashed ' + C.warnLine, borderRadius: 3, background: 'transparent', font: SANS, color: C.warn, cursor: 'pointer' } }, 'Show all ' + P.next.length)] : []), P, true));
    return e('div', { style: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, alignItems: 'flex-start' } }, ...cols);
  }

  column(e, id, title, color, head, badge, cards, P, warn) {
    const drop = this.ui.drop, active = drop && drop.col === id;
    const onDragOver = ev => { if (!this.ui.drag) return; ev.preventDefault(); if (!cards.length || ev.target === ev.currentTarget) this.setDrop(id, cards.length); };
    const onDrop = ev => { ev.preventDefault(); const k = this.ui.drag, d = this.ui.drop; this.ui.drag = null; this.ui.drop = null; if (k && d) this.move(P, k, d.col, d.idx); else this.onChange(); };
    return e('div', { key: 'col' + id, style: { flex: '0 0 288px', display: 'flex', flexDirection: 'column', background: warn ? C.warnBg : C.paper, border: '1px solid ' + (active ? C.ink : warn ? C.warnLine : C.line), borderRadius: 3 } },
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 10px', borderBottom: '1px solid ' + (warn ? C.warnLine : C.line) } },
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          e('span', { style: { display: 'flex', alignItems: 'center', gap: 7, font: "600 11.5px 'IBM Plex Mono',ui-monospace,monospace", letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink } },
            e('span', { style: { width: 10, height: 10, borderRadius: warn ? '50%' : 2, background: warn ? 'transparent' : color, border: warn ? '2px solid ' + color : 'none', boxSizing: 'border-box' } }), title), badge),
        ...head),
      e('div', { onDragOver, onDrop, style: { display: 'flex', flexDirection: 'column', gap: 0, padding: 8, minHeight: 80 } },
        ...(cards.length ? cards : [e('div', { key: 'empty', style: { padding: '16px 8px', border: '1px dashed ' + C.line, borderRadius: 3, font: SANS, color: C.muted, textAlign: 'center' } }, warn ? 'Nothing deferred' : 'Drop a job here to assign this team')]),
        active && drop.idx >= cards.length && cards.length ? e('div', { key: 'endline', style: { height: 3, background: C.acc, borderRadius: 2, marginTop: 4 } }) : null));
  }
  setDrop(col, idx) {
    const d = this.ui.drop;
    if (d && d.col === col && d.idx === idx) return;
    this.ui.drop = { col, idx }; this.onChange();
  }

  cardEl(e, P, j, r, colId, idx, pill) {
    if (!j) return null;
    const mt = this.st.meta[j.key] || { conf: 'none', stat: 'none', aging: [] };
    const lk = this.locked(j), sc = this.score(j), ag = mt.aging ? mt.aging.length : 0;
    const drop = this.ui.drop, line = drop && drop.col === colId && drop.idx === idx && this.ui.drag !== j.key;
    const sel = (key, val, opts, onChange, label) => e('select', { key, value: val, onChange, 'aria-label': label, onMouseDown: ev => ev.stopPropagation(),
      style: { padding: '3px 5px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: SANS, fontSize: 11.5, maxWidth: '100%', cursor: 'pointer' } },
      ...Object.entries(opts).map(([k, v]) => e('option', { key: k, value: k }, v)));
    const mini = (key, label, onClick, title) => e('button', { key, type: 'button', onClick, title, style: { padding: '2px 7px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO, cursor: 'pointer' } }, label);
    const nT = P.teams.length;
    const moveOpts = { '': 'Move to…' }; for (let n = 0; n < nT; n++) moveOpts[n] = 'Team ' + (n + 1); moveOpts.next = 'Defer H+1';
    const chips = [pill(j.tier, j.tier === 'VIP' ? 'vip' : j.tier === 'Highest' || j.tier === 'High' ? 'acc' : null, 't'),
      pill(j.cat + ' · ' + nf1(this.dur(j) / 60).replace('.0', '') + 'h', CATS[j.cat].lvl === 'Critical' ? 'bad' : CATS[j.cat].lvl === 'High' ? 'warn' : null, 'c'),
      pill(this.cellName(j), null, 'g')];
    if (ag) chips.push(pill('Aging +' + AGING * ag, 'warn', 'a'));
    if (j.tier === 'VIP') chips.push(pill(this.urgent(j) ? 'Force top' : 'After other jobs', 'vip', 'v'));
    if (j.noPrio) chips.push(pill('Priority missing', 'warn', 'np'));
    if (j.prog) chips.push(pill('In progress (sheet)', 'good', 'p'));
    if (P.manual[j.key]) chips.push(pill('Manual', null, 'm'));
    const fd = t => t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'no date';
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }); };
    return e('div', { key: j.key, style: { display: 'flex', flexDirection: 'column' } },
      line ? e('div', { style: { height: 3, background: C.acc, borderRadius: 2, margin: '2px 0 4px' } }) : null,
      e('div', {
        draggable: !lk,
        onDragStart: ev => { this.ui.drag = j.key; try { ev.dataTransfer.setData('text/plain', j.key); ev.dataTransfer.effectAllowed = 'move'; } catch (x) {} },
        onDragEnd: () => { if (this.ui.drag || this.ui.drop) { this.ui.drag = null; this.ui.drop = null; this.onChange(); } },
        onDragOver: ev => { if (!this.ui.drag) return; ev.preventDefault(); ev.stopPropagation(); const b = ev.currentTarget.getBoundingClientRect(); this.setDrop(colId, ev.clientY < b.top + b.height / 2 ? idx : idx + 1); },
        onDrop: ev => { ev.preventDefault(); ev.stopPropagation(); const k = this.ui.drag, d = this.ui.drop; this.ui.drag = null; this.ui.drop = null; if (k && d) this.move(P, k, d.col, d.idx); else this.onChange(); },
        style: { display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 9px', marginBottom: 6, background: C.white, border: '1px solid ' + C.line, borderRadius: 3, cursor: lk ? 'default' : 'grab', opacity: this.ui.drag === j.key ? 0.4 : 1, boxShadow: lk ? 'inset 3px 0 0 ' + C.muted : 'none' },
      },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } },
          e('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 8px', minWidth: 0 } },
            e('span', { style: { font: "600 14px 'IBM Plex Sans',system-ui,sans-serif", color: C.ink, wordBreak: 'break-all' } }, j.uid || j.name || '—'),
            e('span', { style: { font: "600 12px 'IBM Plex Mono',ui-monospace,monospace", color: C.ink } }, 'CID ' + j.cid)),
          e('span', { style: { font: "600 13px 'IBM Plex Mono',ui-monospace,monospace", color: C.ink, whiteSpace: 'nowrap' }, title: 'Priority score' }, fmtN(sc))),
        e('div', { style: { font: "400 10.5px 'IBM Plex Mono',ui-monospace,monospace", color: C.muted } }, j.wo + ' · ' + fd(j.t) + (j.area ? ' · ' + j.area : '') + (j.prob ? ' · ' + j.prob : '')),
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, ...chips),
        r ? e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 } },
          e('div', null,
            e('span', { style: { font: "600 16px 'IBM Plex Mono',ui-monospace,monospace", color: C.ink } }, hm(r.arr)),
            e('span', { style: { font: MONO, color: C.muted } }, ' → ' + hm(r.end)),
            e('div', { style: { font: "400 10.5px 'IBM Plex Mono',ui-monospace,monospace", color: C.muted } }, day(0) + ' · ETA')),
          e('div', { style: { font: MONO, color: C.muted, textAlign: 'right' } }, '+' + r.hop + ' min', e('br'), nf1(r.d) + ' km'))
          : e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
            sel('why', P.why[j.key] || 'internal', { internal: 'Internal · aging +' + AGING, customer: 'Customer request · no aging' }, ev => { P.why[j.key] = ev.target.value; this.changed(j.wo + ': deferral reason set to ' + ev.target.value + '.'); }, 'Deferral reason'),
            e('span', { style: { font: "400 10.5px 'IBM Plex Mono',ui-monospace,monospace", color: C.muted } }, day(1))),
        r && r.f.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, ...r.f.map((f, n) => e('span', { key: n, style: { font: "600 11px 'IBM Plex Sans',system-ui,sans-serif", color: f[0] === 'bad' ? C.bad : C.warn } }, f[1]))) : null,
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' } },
          sel('conf', mt.conf || 'none', CONF, ev => this.setConf(P, j, ev.target.value), 'Customer confirmation'),
          sel('stat', mt.stat || 'none', STAT, ev => { this.meta(j.key).stat = ev.target.value; this.changed(j.wo + ': technician status ' + STAT[ev.target.value] + (ev.target.value !== 'none' ? ' (locked)' : '') + '.'); }, 'Technician status'),
          lk ? null : mini('up', '↑', () => this.nudge(P, j.key, colId, -1), 'Move up'),
          lk ? null : mini('dn', '↓', () => this.nudge(P, j.key, colId, 1), 'Move down'),
          lk ? null : sel('mv', '', moveOpts, ev => { const v = ev.target.value; if (v === '') return; this.move(P, j.key, v === 'next' ? 'next' : +v, null); }, 'Move to'),
          mini('loc', 'Locate', () => this.locate(j), 'Show on the map'))));
  }
  nudge(P, key, colId, d) {
    const list = colId === 'next' ? P.next : P.teams[colId], i = list.indexOf(key), n = i + d;
    if (i < 0 || n < 0 || n >= list.length) return;
    this.move(P, key, colId, n);
  }
  setConf(P, j, v) {
    this.meta(j.key).conf = v;
    if (v === 'resched' && !this.locked(j)) { P.why[j.key] = 'customer'; this.move(P, j.key, 'next', null, j.wo + ': customer asks to reschedule, deferred to H+1 without aging.'); return; }
    this.changed(j.wo + ': confirmation ' + CONF[v] + '.');
  }
  locate(j) { if (this.onLocate) this.onLocate(j.i); }

  cellTable(e, P, host, col) {
    const J = this._J, cfg = this.st.cfg, avail = cfg.end - cfg.start, g = new Map();
    J.list.forEach(j => {
      const c = this.cellName(j);
      if (!g.has(c)) g.set(c, { c, jobs: [], areas: new Set() });
      const x = g.get(c); x.jobs.push(j); if (j.area) x.areas.add(j.area);
    });
    const teamOf = k => P.teams.findIndex(t => t.includes(k));
    const rows = [...g.values()].map(x => {
      const hrs = x.jobs.reduce((a, j) => a + this.dur(j), 0) + x.jobs.length * cfg.maxHop / 2;
      const tms = [...new Set(x.jobs.map(j => teamOf(j.key)).filter(n => n >= 0))].sort((a, b) => a - b);
      return { ...x, hrs, rec: Math.max(1, Math.ceil(hrs / avail)), tms, nx: x.jobs.filter(j => teamOf(j.key) < 0).length };
    }).sort((a, b) => b.hrs - a.hrs);
    if (!rows.length) return e('div', { style: { font: SANS, color: C.muted, padding: '8px 0' } }, 'No open jobs in scope.');
    const mono = v => e('span', { style: { font: "500 12.5px 'IBM Plex Mono',ui-monospace,monospace" } }, v);
    return host.table(['Cell', 'Area', 'Jobs', 'Load', 'Rec. teams', 'Served by', 'H+1'], rows.slice(0, 120).map(x => [
      mono(x.c), [...x.areas].slice(0, 2).join(', ') || '—', fmtN(x.jobs.length), nf1(x.hrs / 60) + ' h', String(x.rec),
      x.tms.length ? e('span', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } }, ...x.tms.map(n => e('span', { key: n, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, e('span', { style: { width: 8, height: 8, borderRadius: 2, background: col(n) } }), 'T' + (n + 1)))) : '—',
      x.nx ? e('span', { style: { color: C.warn, fontWeight: 600 } }, String(x.nx)) : '0',
    ]), { minWidth: 560, maxHeight: 420 });
  }
  logView(e) {
    const L = this.st.log;
    if (!L.length) return e('div', { style: { font: SANS, color: C.muted } }, 'No changes yet.');
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' } },
      ...L.slice(0, 80).map((l, n) => e('div', { key: n, style: { display: 'grid', gridTemplateColumns: '92px minmax(0,1fr)', gap: 8, font: "400 12.5px/1.5 'IBM Plex Sans',system-ui,sans-serif", color: C.text, paddingBottom: 6, borderBottom: '1px solid ' + C.soft } },
        e('span', { style: { font: "400 11px 'IBM Plex Mono',ui-monospace,monospace", color: C.muted } }, l.t), e('span', null, l.msg))));
  }

  settings(e, row, chip, btn) {
    const d = this.ui.draft, { m, bi } = this._ctx;
    const set = (k, v) => { d[k] = v; this.onChange(); };
    const num = (k, w, step, obj, key) => e('input', { key: 'n' + (key || k), type: 'number', step: step || 1, value: (obj || d)[k], onChange: ev => { (obj || d)[k] = ev.target.value === '' ? '' : +ev.target.value; this.onChange(); },
      style: { width: w || 64, padding: '5px 8px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO, outline: 'none' } });
    const time = k => e('input', { key: 't' + k, type: 'time', value: hm(d[k]), onChange: ev => { const [a, b] = String(ev.target.value).split(':').map(Number); if (isFinite(a) && isFinite(b)) set(k, a * 60 + b); },
      style: { padding: '4px 6px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO } });
    const lab = (t, k) => e('span', { key: k || t, style: { font: SANS, color: C.muted } }, t);
    const name = m.branches[bi];
    const bs = d.bases[name] || this.base(m, bi, this._J);
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid ' + C.line, borderRadius: 3, background: C.paper } },
      row('Scope', [lab('Open orders from the last', 'l1'), num('maxAge', 60), lab('days', 'l2'),
        chip('sb', d.blocked, 'Include Blocked accounts', null, null, () => set('blocked', !d.blocked)),
        chip('sp', d.prog, 'Show In Progress orders', null, null, () => set('prog', !d.prog))]),
      row('Teams', [lab('Available', 'l3'), num('teams', 56), lab('Target jobs per team', 'l4'), num('target', 52), lab('Cell size', 'l5'),
        ...[2, 3, 5].map(v => chip('gk' + v, d.gridKm === v, v + ' km', null, null, () => set('gridKm', v)))]),
      row('Travel', [lab('Speed', 'l6'), num('speed', 56), lab('km/h × road factor', 'l7'), num('road', 60, 0.05), lab('Hop limit', 'l8'), num('maxHop', 56), lab('min within', 'l9'), num('ring', 48), lab('cells', 'l10')]),
      row('Expand', [lab('Teams under target may reach', 'l11'), num('ring2', 48), lab('cells within', 'l12'), num('hop2', 56), lab('min', 'l13')]),
      row('Hours', [lab('Start', 'l14'), time('start'), lab('Last start', 'l15'), time('cut'), lab('End', 'l16'), time('end'),
        chip('ot', d.ot, 'Allow overtime', null, null, () => set('ot', !d.ot))]),
      row('Duration', Object.keys(CATS).map(k => e('span', { key: 'd' + k, style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.muted } }, k, num(k, 60, 5, d.dur, 'dur' + k), 'min',
        e('span', { style: { font: "600 9.5px 'IBM Plex Mono',ui-monospace,monospace", letterSpacing: '0.08em', textTransform: 'uppercase', color: CATS[k].src === 'assumed' ? C.warn : C.good } }, CATS[k].src)))),
      row('Base', [lab(name + ' start point (lat, lng)', 'l21'), e('input', { key: 'bs', type: 'text', defaultValue: bs.lat.toFixed(5) + ', ' + bs.lng.toFixed(5),
        onBlur: ev => { const p = String(ev.target.value).split(/[,;\s]+/).map(Number); if (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) { d.bases = { ...d.bases, [name]: { name: name + ' base', lat: p[0], lng: p[1] } }; this.onChange(); } },
        style: { width: 200, padding: '5px 8px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO } })]),
      row('', [btn('ap', 'Apply and re-plan', () => this.apply(), true), btn('cx', 'Cancel', () => { this.ui.settings = false; this.ui.draft = null; this.onChange(); }),
        btn('rs', 'Reset defaults', () => { const keep = { bases: d.bases, branch: d.branch }; this.ui.draft = { ...JSON.parse(JSON.stringify(DEF)), ...keep }; this.onChange(); })], 'act'));
  }
  apply() {
    const d = this.ui.draft; if (!d) return;
    const clean = (v, lo, hi, def) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    const c = this.st.cfg;
    Object.assign(c, {
      teams: Math.round(clean(d.teams, 1, 60, DEF.teams)), target: Math.round(clean(d.target, 1, 12, DEF.target)), gridKm: d.gridKm,
      speed: clean(d.speed, 5, 80, DEF.speed), road: clean(d.road, 1, 2.5, DEF.road), maxHop: clean(d.maxHop, 5, 180, DEF.maxHop),
      ring: Math.round(clean(d.ring, 0, 5, DEF.ring)), ring2: Math.round(clean(d.ring2, 0, 8, DEF.ring2)), hop2: clean(d.hop2, 5, 240, DEF.hop2),
      start: d.start, cut: Math.max(d.start, d.cut), end: Math.max(d.start + 60, d.end), ot: !!d.ot, maxAge: Math.round(clean(d.maxAge, 0, 3650, DEF.maxAge)),
      blocked: !!d.blocked, prog: !!d.prog, bases: { ...d.bases },
      dur: Object.fromEntries(Object.keys(CATS).map(k => [k, clean(d.dur[k], 10, 720, CATS[k].d)])),
    });
    this.ui.settings = false; this.ui.draft = null; this._jobs = null;
    const { m, bi } = this._ctx;
    const J = this._J = this.jobs(m, bi), B = this.base(m, bi, J), P = this.st.plans[m.branches[bi]];
    if (P) this.autoPlan(P, J, B, true);
    this.changed('Settings changed and the plan was re-run.');
  }

  /* ---------- map layer ---------- */
  layer() {
    const x = this._ctx; if (!x || !this._J) return null;
    const k = this.ver + '|' + x.name + '|' + this._J.list.length;
    if (this._layer && this._layer.key === k) return this._layer;
    const J = this._J, cells = new Map();
    J.list.forEach(j => { const c = this.cell(j).key; cells.set(c, (cells.get(c) || 0) + 1); });
    const tip = j => j.wo + ' · ' + (j.uid || j.cid) + ' · ' + j.cat;
    const fit = !this._layer || this._layer.name !== x.name;
    this._layer = {
      key: k, name: x.name, fit, size: this.st.cfg.gridKm * 1000, cells: [...cells.entries()],
      base: { lat: x.B.lat, lng: x.B.lng, title: x.B.name },
      teams: x.P.teams.map((ids, n) => ({ color: this.pal[n % this.pal.length], label: 'Team ' + (n + 1), pts: ids.map(k2 => J.by.get(k2)).filter(Boolean).map(j => ({ lat: j.lat, lng: j.lng, title: 'Team ' + (n + 1) + ' · ' + tip(j) })) })).filter(t => t.pts.length),
      next: x.P.next.map(k2 => J.by.get(k2)).filter(Boolean).map(j => ({ lat: j.lat, lng: j.lng, title: 'H+1 · ' + tip(j) })),
    };
    return this._layer;
  }
}
