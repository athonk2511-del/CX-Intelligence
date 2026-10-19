// GlobalXtreme BI — IDS (Intelligence Dispatch System). One instance per work-order type: WWR and WCM run as separate pages.
// Grid first: open jobs (latest WO per CID, still open) are grouped into fixed grid cells. Cells are joined into anchor blocks
// (cell + 8 neighbours) once a block holds enough hours of work; every block gets at least one anchor team, most urgent SLA
// first, then as many as it needs. Free teams become floaters for sparse cells. Jobs close to SLA breach always go first. Drive times come from an OSRM road router; straight-line estimates are only a
// fallback while road times load or where the router has no answer.

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
  'Low/Unknown': { s: 100, lvl: 'Low', d: 60, src: 'assumed' },
};
export const AGING = 200;
// Cell colour by density: number of open WO in the cell. VIP does not change the colour; VIP only goes first in the work order.
export const BANDS = [
  { min: 0, color: '#2E7D4F', label: '1–2 WO' },
  { min: 3, color: '#8DB33A', label: '3–4 WO' },
  { min: 5, color: '#E0A800', label: '5–7 WO' },
  { min: 8, color: '#D9480F', label: '8–11 WO' },
  { min: 12, color: '#7F1D1D', label: '12+ WO' },
];
export const bandOf = s => { let b = BANDS[0]; BANDS.forEach(x => { if (s >= x.min) b = x; }); return b; };
const TYPES = {
  WWR: { name: 'wiredown', st: 'wd', info: 'wdInfo' },
  WCM: { name: 'maintenance', st: 'cm', info: 'cmInfo' },
};
const CONF = { none: 'Not contacted', ok: 'Confirmed', noresp: 'No answer', resched: 'Asks to reschedule' };
const STAT = { none: 'Not started', start: 'On the way', checkin: 'Checked in', checkout: 'Checked out' };
const BASES = [
  [/bali|denpasar|badung|kerobokan/i, { name: 'GlobalXtreme HQ · Jl. Raya Kerobokan 388X', lat: -8.6705, lng: 115.1655 }],
  [/malang/i, { name: 'GX Malang', lat: -7.9797, lng: 112.6304 }],
];
const DEF = {
  teams: 10, gridKm: 3, speed: 22, road: 1.3, traffic: 1.2, roadOn: true, osrm: 'https://router.project-osrm.org',
  maxHop: 30, ring: 1, ring2: 1, hop2: 45, start: 540, cut: 960, end: 1020, ot: false, maxAge: 30, blocked: false, prog: true,
  dur: Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, v.d])), bases: {}, branch: '', crew: [], breakEst: 60, probEst: 30,
  anchorH: 4, sla: 12, slaVip: 6, nearH: 3, rebOn: true, rebAt: 720,
};

const pad = n => String(n).padStart(2, '0');
const hm = m => { m = Math.round(m); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
const dh = m => { m = Math.max(0, Math.round(m)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60) + ' m'; };
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fmtN = v => Math.round(v).toLocaleString('en-US');
const nf1 = v => (Math.round(v * 10) / 10).toFixed(1);
const dd = m => m < 2880 ? dh(m) : Math.floor(m / 1440) + ' d';
const tierOf = raw => { const v = String(raw || '').toLowerCase(); return /vip/.test(v) ? 'VIP' : /highest/.test(v) ? 'Highest' : /high/.test(v) ? 'High' : /low/.test(v) ? 'Low' : /normal|medium|standard/.test(v) ? 'Normal' : null; };
// Job type from the ticket's category and problem text. Anything not recognised is Low/Unknown until the problem is known.
const catOf = (a, b) => { const v = (String(a || '') + ' ' + String(b || '')).toLowerCase();
  return /power|listrik|adaptor|adapter|psu/.test(v) ? 'Perbaikan Power' : /pindah jalur|reroute|re-route|jalur kabel/.test(v) ? 'Pindah Jalur Kabel'
    : /perapian|rapikan|rapi kabel/.test(v) ? 'Perapian Kabel' : /reposisi|pindah onu|pindah modem|relokasi onu/.test(v) ? 'Reposisi ONU' : /project/.test(v) ? 'FO Project'
    : /wire ?-?down|putus|\blos\b|redaman|fiber cut|kabel (rusak|jatuh|turun)/.test(v) ? 'Wiredown' : 'Low/Unknown'; };
function hav(a, b) {
  const t = Math.PI / 180, dl = (b.lat - a.lat) * t, dn = (b.lng - a.lng) * t;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dn / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}
const pk = p => p.pk || (p.pk = p.lat.toFixed(5) + ',' + p.lng.toFixed(5));

// Plan storage. Kept behind one object so it can be swapped for a shared backend without touching the planner.
const store = {
  load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
  save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} },
};

/* ---------- road network (OSRM) ---------- */
class Road {
  constructor(onUpdate) { this.m = new Map(); this.geo = new Map(); this.q = []; this.run = false; this.done = 0; this.total = 0; this.err = null; this.ver = 0; this.onUpdate = onUpdate; }
  get(a, b) { return this.m.get(pk(a) + '>' + pk(b)) || null; }
  busy() { return this.run || this.q.length > 0; }
  push(fn) { this.q.push(fn); this.total++; this.pump(); }
  async pump() {
    if (this.run) return; this.run = true;
    while (this.q.length) {
      const fn = this.q.shift();
      try { await fn(); } catch (e) { this.err = e.message || String(e); }
      this.done++; this.ver++;
      if (this.q.length) { this.onUpdate(false); await new Promise(r => setTimeout(r, 1100)); }
    }
    this.run = false; this.onUpdate(true);
  }
  async table(url, pts) {
    const u = url.replace(/\/+$/, '') + '/table/v1/driving/' + pts.map(p => p.lng.toFixed(5) + ',' + p.lat.toFixed(5)).join(';') + '?annotations=duration,distance';
    const r = await fetch(u);
    if (!r.ok) throw new Error('Road router HTTP ' + r.status);
    const j = await r.json();
    if (j.code !== 'Ok') throw new Error('Road router: ' + (j.message || j.code));
    const K = pts.map(pk);
    for (let i = 0; i < K.length; i++) for (let k = 0; k < K.length; k++) {
      const d = j.durations && j.durations[i] ? j.durations[i][k] : null, s = j.distances && j.distances[i] ? j.distances[i][k] : null;
      if (d != null) this.m.set(K[i] + '>' + K[k], { min: d / 60, km: s != null ? s / 1000 : null });
    }
    this.err = null;
  }
  async route(url, key, pts) {
    const u = url.replace(/\/+$/, '') + '/route/v1/driving/' + pts.map(p => p.lng.toFixed(5) + ',' + p.lat.toFixed(5)).join(';') + '?overview=full&geometries=geojson';
    const r = await fetch(u);
    if (!r.ok) throw new Error('Road router HTTP ' + r.status);
    const j = await r.json();
    if (j.code === 'Ok' && j.routes && j.routes[0]) this.geo.set(key, j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
  }
}

export function createDispatch(o) { return new Dispatch(o); }

class Dispatch {
  constructor(o) {
    this.R = o.React; this.M = o.map; this.pal = o.palette; this.onChange = o.onChange;
    this.type = o.type === 'WCM' ? 'WCM' : 'WWR'; this.TY = TYPES[this.type];
    this.LS = 'gx.ids.' + this.type + '.v2';
    this.st = this.load();
    this.road = new Road(fin => this.roadTick(fin));
    this.ui = { settings: false, drag: null, drop: null, armed: false, msg: null, draft: null, nextAll: false, cellsAll: false };
    this.ver = 1; this._rq = new Set(); this._tq = new Set();
    // Hook for the technician mobile app: window.GXIDS.WWR.event({ app | team, type, time, note }).
    if (typeof window !== 'undefined') { window.GXIDS = window.GXIDS || {}; window.GXIDS[this.type] = { event: o => this.appEvent(o), types: ['break_start', 'break_end', 'problem_start', 'problem_end'] }; }
    this._tick = setInterval(() => { const P = this._ctx && this._ctx.P; if (P && Object.values(P.ev || {}).some(l => l.some(e => e.end == null))) { this.ver++; this.onChange(); } }, 60000);
  }

  /* ---------- persistence ---------- */
  load() {
    let s = store.load(this.LS);
    s = s && typeof s === 'object' ? s : {};
    const cfg = { ...DEF, ...(s.cfg || {}) };
    cfg.dur = { ...DEF.dur, ...((s.cfg || {}).dur || {}) };
    cfg.bases = { ...((s.cfg || {}).bases || {}) };
    return { cfg, plans: s.plans || {}, meta: s.meta || {}, log: Array.isArray(s.log) ? s.log.slice(0, 200) : [] };
  }
  save() { store.save(this.LS, this.st); }
  changed(msg) { if (msg) this.note(msg); this.ver++; this.save(); this.onChange(); }
  note(msg) {
    const d = new Date();
    this.st.log.unshift({ t: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()), msg });
    this.st.log = this.st.log.slice(0, 200);
  }
  tn(n) { const v = (this.st.cfg.names || [])[n]; return v && String(v).trim() ? String(v).trim() : 'Team ' + (n + 1); }
  setName(n, v) { const a = (this.st.cfg.names || []).slice(); a[n] = String(v || '').slice(0, 40); this.st.cfg.names = a; this.ver++; this.save(); this.onChange(); }
  meta(key) { return this.st.meta[key] || (this.st.meta[key] = { conf: 'none', stat: 'none', aging: [] }); }

  /* ---------- jobs from the map data ---------- */
  branchIdx(m, hostBi) {
    if (hostBi >= 0) return hostBi;
    const want = this.st.cfg.branch;
    let bi = want ? m.branches.indexOf(want) : -1;
    if (bi < 0) bi = m.branches.findIndex(b => /bali/i.test(b));
    if (bi < 0) bi = 0;
    return bi;
  }
  // Latest work order of this type per CID (by timestamp); kept only while that latest order is still open or in progress.
  jobs(m, bi) {
    const cfg = this.st.cfg, ST = m[this.TY.st], INFO = m[this.TY.info];
    const sig = [bi, cfg.maxAge, cfg.blocked, cfg.prog, cfg.gridKm].join('|');
    if (this._jobs && this._jobs.m === m && this._jobs.sig === sig) return this._jobs.v;
    const now = Date.now(), maxMs = (+cfg.maxAge || 0) * 86400e3;
    const list = [], skipped = { old: 0, status: 0, noPrio: 0, unknown: 0 };
    if (ST && INFO) for (let i = 0; i < m.count; i++) {
      if (m.branch[i] !== bi) continue;
      const state = ST[i], w = INFO[i];
      if (!w || state < 0 || state > 1 || (state === 1 && !cfg.prog)) continue;
      if (m.status[i] === 2 || (m.status[i] === 1 && !cfg.blocked)) { skipped.status++; continue; }
      if (maxMs && w.t > 0 && now - w.t > maxMs) { skipped.old++; continue; }
      const tier = tierOf(w.prio), cat = catOf(w.cat, w.prob);
      if (!tier) skipped.noPrio++;
      if (cat === 'Low/Unknown') skipped.unknown++;
      const j = { key: String(w.wo || (this.type + '-' + m.cid[i])), i, type: this.type, wo: w.wo || '—', cid: String(m.cid[i]), uid: m.uid[i] || '', name: m.name[i] || '', area: m.area ? m.area[i] || '' : '',
        lat: m.lat[i], lng: m.lng[i], t: w.t || 0, raw: w.raw || '', prog: state === 1, cat, prob: w.prob || w.cat || '', prio: w.prio || '', noPrio: !tier, tier: tier || 'Normal' };
      const c = this.M.cellOf(j.lat, j.lng, cfg.gridKm * 1000);
      j.cell = { c: c[0], r: c[1], key: c[0] + ',' + c[1] };
      list.push(j);
    }
    const v = { list, by: new Map(list.map(j => [j.key, j])), skipped };
    this._jobs = { m, sig, v }; this._need = null;
    return v;
  }
  // Start points of a branch. Several bases are allowed; each team leaves from the base nearest to its first cell.
  bases(m, bi, J) {
    const name = m.branches[bi] || '', saved = this.st.cfg.bases[name];
    const list = (Array.isArray(saved) ? saved : saved ? [saved] : []).filter(b => b && isFinite(b.lat) && isFinite(b.lng));
    if (list.length) return list.map((b, n) => ({ ...b, name: b.name || name + ' base ' + (n + 1), guess: false }));
    const hit = BASES.find(([re]) => re.test(name));
    if (hit) return [{ ...hit[1], guess: true }];
    const n = J.list.length || 1;
    return [{ name: name + ' centre of jobs', lat: J.list.reduce((a, j) => a + j.lat, 0) / n || -8.67, lng: J.list.reduce((a, j) => a + j.lng, 0) / n || 115.17, guess: true }];
  }
  base(m, bi, J) { return this.bases(m, bi, J)[0]; }
  // Per-team setup: start base, shift start and the technician app ID that sends break / problem events.
  crew(i) { return (this.st.cfg.crew || [])[i] || {}; }
  tbase(P, i) { const BS = this._BS || [], c = this.crew(i); return BS[c.base != null ? c.base : 0] || BS[0]; }
  tstart(i) { const c = this.crew(i); return isFinite(c.start) && c.start !== '' ? +c.start : this.st.cfg.start; }
  setCrew(i, patch) { const a = (this.st.cfg.crew || []).slice(); a[i] = { ...(a[i] || {}), ...patch }; this.st.cfg.crew = a; }
  nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
  evList(P, i) { return ((P.ev || {})[i] || []).slice().sort((a, b) => a.at - b.at); }
  evDur(e) { return e.end != null ? Math.max(0, e.end - e.at) : Math.max(e.est || 0, this.nowMin() - e.at); }
  // Breaks and problems push back the job they fall in and everything after it.
  step(E, k, t, hop, dur) {
    let arr = t + hop, dl = 0, hit = [];
    while (k.i < E.length && E[k.i].at <= arr) { const x = this.evDur(E[k.i]); hit.push(E[k.i++]); arr += x; dl += x; }
    let end = arr + dur;
    while (k.i < E.length && E[k.i].at < end) { const x = this.evDur(E[k.i]); hit.push(E[k.i++]); end += x; dl += x; }
    return { arr, end, dl, hit };
  }
  nearBase(j) { const BS = this._BS || []; let bi = 0, bt = Infinity; BS.forEach((b, n) => { const t = this.travel(b, j); if (t < bt) { bt = t; bi = n; } }); return bi; }
  draftBases(d, name) {
    let v = d.bases[name];
    if (!Array.isArray(v)) { v = v && isFinite(v.lat) ? [v] : (this._BS || []).map(b => ({ name: b.name, lat: b.lat, lng: b.lng })); d.bases = { ...d.bases, [name]: v }; }
    return v;
  }

  /* ---------- scoring ---------- */
  aging(j) { const a = this.st.meta[j.key]; return a ? a.aging.length : 0; }
  score(j) { return TIERS[j.tier].s + CATS[j.cat].s + AGING * this.aging(j); }
  urgent(j) { return CATS[j.cat].s >= 400; }
  vipLate(j) { return j.tier === 'VIP' && !this.urgent(j); }
  locked(j) { const s = (this.st.meta[j.key] || {}).stat; return j.prog || s === 'start' || s === 'checkin' || s === 'checkout'; }
  cmp = (a, b) => this.score(b) - this.score(a) || CATS[b.cat].s - CATS[a.cat].s || TIERS[b.tier].r - TIERS[a.tier].r || a.t - b.t;
  dur(j) { return +this.st.cfg.dur[j.cat] || CATS[j.cat].d; }

  /* ---------- SLA ---------- */
  // SLA clock: from WO Created until WO Closed (closed WO leave the list), counted only inside working hours (start–end)
  // and paused while the customer asks to reschedule. VIP slaVip hours, everything else sla hours. "Soon" = nearH h or less left.
  slaMin(j) { const c = this.st.cfg; return (j.tier === 'VIP' ? c.slaVip : c.sla) * 60; }
  bizMin(a, b) {
    if (!(b > a)) return 0;
    const c = this.st.cfg, W = Math.max(0, c.end - c.start), cl = m => Math.min(c.end, Math.max(c.start, m));
    const A = new Date(a), Bd = new Date(b), ma = A.getHours() * 60 + A.getMinutes() + A.getSeconds() / 60, mb = Bd.getHours() * 60 + Bd.getMinutes() + Bd.getSeconds() / 60;
    const days = Math.round((new Date(Bd.getFullYear(), Bd.getMonth(), Bd.getDate()) - new Date(A.getFullYear(), A.getMonth(), A.getDate())) / 864e5);
    return days === 0 ? Math.max(0, cl(mb) - cl(ma)) : (c.end - cl(ma)) + (days - 1) * W + (cl(mb) - c.start);
  }
  rem(j) {
    if (!(j.t > 0)) return Infinity;
    const now = Date.now(), pz = ((this.st.meta[j.key] || {}).pz) || [];
    const used = this.bizMin(j.t, now) - pz.reduce((s, p) => s + this.bizMin(Math.max(p.a, j.t), p.b || now), 0);
    return this.slaMin(j) - Math.max(0, used);
  }
  soon(j) { const r = this.rem(j); return r >= 0 && r <= this.st.cfg.nearH * 60; }
  breached(j) { return this.rem(j) < 0; }
  urg = (a, b) => (this.soon(b) - this.soon(a)) || (this.soon(a) ? this.rem(a) - this.rem(b) : 0) || this.cmp(a, b);

  /* ---------- drive time ---------- */
  roadHit(a, b) { return this.st.cfg.roadOn ? this.road.get(a, b) : null; }
  travel(a, b) {
    const cfg = this.st.cfg, r = this.roadHit(a, b);
    if (r) return Math.max(r.min < 0.5 ? 0 : 1, Math.round(r.min * cfg.traffic));
    const d = hav(a, b) * cfg.road;
    return d < 0.05 ? 0 : Math.max(3, Math.round(d / Math.max(5, cfg.speed) * 60));
  }
  km(a, b) { const r = this.roadHit(a, b); return r && r.km != null ? r.km : hav(a, b) * this.st.cfg.road; }
  isRoad(a, b) { return !!this.roadHit(a, b) || hav(a, b) < 0.05; }
  // Road-time matrices, one per compact block of neighbouring cells (≤ 90 points incl. the base). Pairs across blocks fall back to the estimate.
  ensureRoad(J, B) {
    const cfg = this.st.cfg;
    if (!cfg.roadOn || !J.list.length) return;
    const byCell = new Map();
    J.list.forEach(j => { if (!byCell.has(j.cell.key)) byCell.set(j.cell.key, { c: j.cell, pts: new Map() }); byCell.get(j.cell.key).pts.set(pk(j), j); });
    const left = [...byCell.values()].sort((a, b) => b.pts.size - a.pts.size), MAX = Math.max(20, 90 - (this._BS || [B]).length);
    while (left.length) {
      const seed = left[0].c;
      const dd = x => Math.max(Math.abs(x.c.c - seed.c), Math.abs(x.c.r - seed.r));
      left.sort((a, b) => dd(a) - dd(b) || b.pts.size - a.pts.size);
      let blk = [];
      while (left.length && (blk.length + left[0].pts.size <= MAX || !blk.length)) blk = blk.concat([...left.shift().pts.values()]);
      for (let s = 0; s < blk.length; s += MAX) {
        const pts = (this._BS || [B]).concat(blk.slice(s, s + MAX));
        const sig = cfg.osrm + '|' + pts.map(pk).sort().join(';');
        if (this._tq.has(sig)) continue;
        this._tq.add(sig);
        this.road.push(() => this.road.table(cfg.osrm, pts));
      }
      left.sort((a, b) => b.pts.size - a.pts.size);
    }
  }
  routeKey(ids, B) { return [B].concat(ids.map(k => this._J.by.get(k)).filter(Boolean)).map(pk).join(';'); }
  ensureRoutes(P, B) {
    const cfg = this.st.cfg;
    if (!cfg.roadOn || this.road.busy()) return;
    P.teams.forEach((ids, ti) => {
      if (!ids.length) return;
      const B = this.tbase(P, ti), key = this.routeKey(ids, B);
      if (this.road.geo.has(key) || this._rq.has(key)) return;
      this._rq.add(key);
      const pts = [B].concat(ids.map(k => this._J.by.get(k)).filter(Boolean));
      this.road.push(() => this.road.route(cfg.osrm, key, pts));
    });
  }
  roadTick(fin) {
    this._need = null; this.ver++;
    const x = this._ctx;
    if (fin && x) {
      const P = this.st.plans[x.name];
      if (P && P.prov) {
        P.prov = false;
        if (this.road.m.size) {
          if (!Object.keys(P.manual || {}).length) { this.autoPlan(P, this._J, x.B, true); this.note('Plan re-run with road drive times.'); }
          else this.note('Road drive times loaded. Manual changes kept; use Re-plan to reassign with road times.');
        }
        this.save();
      }
    }
    this.onChange();
  }

  /* ---------- grid cells ---------- */
  ringK(a, b) { const p = String(a).split(','), q = String(b).split(','); return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])); }
  cellName(j) { return this.M.cellLabel(j.cell.key); }
  group(list) {
    const g = new Map();
    list.forEach(j => {
      if (!g.has(j.cell.key)) g.set(j.cell.key, { key: j.cell.key, jobs: [], score: 0, vip: 0, areas: new Set() });
      const x = g.get(j.cell.key); x.jobs.push(j); x.score += this.score(j); if (j.tier === 'VIP') x.vip++; if (j.area) x.areas.add(j.area);
    });
    return [...g.values()].sort((a, b) => b.jobs.length - a.jobs.length || b.score - a.score);
  }
  state(ids, B, i, P) {
    let t = i != null ? this.tstart(i) : this.st.cfg.start, pos = B;
    const E = P && i != null ? this.evList(P, i) : [], kk = { i: 0 };
    ids.forEach(k => { const j = this._J.by.get(k); if (!j) return; t = this.step(E, kk, t, this.travel(pos, j), this.dur(j)).end; pos = j; });
    return { ids, t, pos };
  }
  // Greedy: each job (already in priority order) goes to the team that would finish it earliest within working hours.
  packInto(S, jobs) {
    const cfg = this.st.cfg, left = [];
    jobs.forEach(j => {
      let best = null;
      S.forEach(s => {
        const arr = s.t + this.travel(s.pos, j), end = arr + this.dur(j);
        if (arr > cfg.cut || (!cfg.ot && end > cfg.end)) return;
        if (!best || end < best.end) best = { s, end };
      });
      if (best) { best.s.ids.push(j.key); best.s.t = best.end; best.s.pos = j; } else left.push(j);
    });
    return left;
  }
  // Teams a cell needs: the smallest number of teams that fits every job of the cell into today's hours.
  needOf(jobs, B) {
    const cfg = this.st.cfg, avail = Math.max(60, cfg.end - cfg.start);
    if (!jobs.length) return { n: 0, left: 0, finish: cfg.start };
    let n = Math.max(1, Math.ceil(jobs.reduce((a, j) => a + this.dur(j), 0) / avail)), r = null;
    for (; n <= jobs.length; n++) {
      const S = Array.from({ length: n }, () => ({ ids: [], t: cfg.start, pos: B }));
      const left = this.packInto(S, jobs);
      r = { n, left: left.length, finish: Math.max(...S.map(s => s.t)) };
      if (!left.length) break;
    }
    return r;
  }
  // Anchor blocks: the cell whose 3×3 block (cell + 8 neighbours) holds the most work becomes a centre when the block has at
  // least anchorH hours. Its block is taken out and the search repeats. Cells left over are sparse: floater work.
  // Blocks are ordered by the job closest to SLA breach (still savable), then breached count, then load.
  clusters(list, B) {
    const cfg = this.st.cfg, G = this.group(list), by = new Map(G.map(g => [g.key, g])), left = new Set(by.keys()), out = [];
    const work = new Map(G.map(g => [g.key, g.jobs.reduce((a, j) => a + this.dur(j), 0)]));
    const blk = k => { const [c, r] = String(k).split(',').map(Number), a = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) { const q = (c + x) + ',' + (r + y); if (left.has(q)) a.push(q); } return a; };
    while (left.size) {
      let best = null;
      left.forEach(k => { const cs = blk(k), w = cs.reduce((a, q) => a + work.get(q), 0); if (!best || w > best.w || (w === best.w && by.get(k).jobs.length > by.get(best.k).jobs.length)) best = { k, cs, w }; });
      if (best.w < cfg.anchorH * 60) break;
      best.cs.forEach(q => left.delete(q));
      const jobs = best.cs.flatMap(q => by.get(q).jobs).sort(this.urg);
      const live = jobs.map(j => this.rem(j)).filter(r => r >= 0);
      const nd = this.needOf(jobs, (this._BS || [])[this.nearBase(jobs[0])] || B);
      out.push({ key: best.k, cells: best.cs, jobs, load: best.w, minRem: live.length ? Math.min(...live) : Infinity, breached: jobs.filter(j => this.breached(j)).length, need: nd.n, finish: nd.finish, left: nd.left });
    }
    out.sort((a, b) => a.minRem - b.minRem || b.breached - a.breached || b.load - a.load);
    const of = new Map(); out.forEach(c => c.cells.forEach(k => of.set(k, c)));
    return { list: out, of, sparse: [...left].flatMap(k => by.get(k).jobs) };
  }
  clusterInfo(B) {
    const sig = this.cfgSig();
    if (this._need && this._need.J === this._J && this._need.rv === this.road.ver && this._need.cv === sig) return this._need.v;
    const v = this.clusters(this._J.list, B);
    this._need = { J: this._J, rv: this.road.ver, cv: sig, v };
    return v;
  }
  cfgSig() { const c = this.st.cfg; return [c.start, c.cut, c.end, c.ot, c.traffic, c.speed, c.road, c.roadOn, c.anchorH, c.sla, c.slaVip, c.nearH, Math.floor(Date.now() / 600000), JSON.stringify(c.dur), JSON.stringify(Object.values(this.st.meta).map(x => x.aging.length))].join('|'); }

  /* ---------- planning ---------- */
  today() { return ymd(new Date()); }
  plan(m, bi, J, B) {
    const name = m.branches[bi] || 'Branch', day = this.today();
    let P = this.st.plans[name];
    if (P && (P.date !== day || !Array.isArray(P.home))) { if (P.date !== day) this.rollover(P, J); P = null; }
    if (!P) {
      P = this.st.plans[name] = { date: day, teams: [], home: [], next: [], why: {}, manual: {}, prov: this.st.cfg.roadOn && this.road.busy(), reb: this.nowMin() >= this.st.cfg.rebAt ? day : null };
      this.autoPlan(P, J, B, false);
      this.note(this.type + ' plan for ' + name + ' created: ' + P.teams.reduce((a, t) => a + t.length, 0) + ' jobs scheduled, ' + P.next.length + ' deferred' + (P.prov ? ' (provisional until road times load).' : '.'));
      this.save();
      return P;
    }
    if (!Array.isArray(P.tb)) P.tb = P.teams.map(() => 0);
    if (!Array.isArray(P.role)) P.role = P.teams.map((t, i) => P.home[i] ? 'anchor' : null);
    const known = new Set([...P.teams.flat(), ...P.next]);
    let drop = false;
    P.teams = P.teams.map(t => t.filter(k => J.by.has(k) || !(drop = true)));
    P.next = P.next.filter(k => J.by.has(k) || !(drop = true));
    P.teams.forEach((t, i) => { if (!t.length) P.home[i] = null; });
    const fresh = J.list.filter(j => !known.has(j.key));
    if (fresh.length) {
      fresh.sort(this.cmp).forEach(j => { if (!this.place(P, j, B)) { P.next.push(j.key); P.why[j.key] = 'internal'; } });
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
  // 1. Anchor blocks, most urgent SLA first: every block gets one team, then blocks are topped up to the teams they need.
  // 2. Teams still free become floaters for sparse cells, nearest next job first. 3. Teams with hours left take leftovers
  // nearby (own block, then neighbours); jobs close to SLA breach go first and may go further. 4. Anything left goes to H+1.
  autoPlan(P, J, B, keepLocked) {
    const cfg = this.st.cfg, nT = Math.max(1, Math.round(cfg.teams));
    const old = P.teams || [], oldHome = P.home || [], oldWhy = P.why || {}, oldTb = P.tb || [], oldRole = P.role || [];
    P.teams = Array.from({ length: nT }, () => []); P.home = Array(nT).fill(null); P.tb = Array(nT).fill(0); P.role = Array(nT).fill(null);
    P.why = {}; P.manual = {};
    const placed = new Set();
    if (keepLocked) old.forEach((t, i) => t.forEach(k => {
      const j = J.by.get(k), ti = Math.min(i, nT - 1);
      if (j && this.locked(j)) { P.teams[ti].push(k); placed.add(k); if (!P.home[ti]) { P.home[ti] = oldHome[i] || j.cell.key; P.tb[ti] = oldTb[i] || 0; P.role[ti] = oldRole[i] || 'anchor'; } }
    }));
    const hold = (keepLocked ? P.next || [] : []).filter(k => oldWhy[k] === 'customer' && J.by.has(k) && !placed.has(k));
    hold.forEach(k => placed.add(k));
    const CX = this.clusters(J.list.filter(j => !placed.has(j.key)), B);
    const free = () => P.teams.map((t, i) => i).filter(i => !P.home[i] && !P.teams[i].length);
    const reach = (i, j) => this.tstart(i) + this.travel(this.tbase(P, i), j);
    const take = c => {
      const f = free(); if (!f.length) return false;
      f.sort((a, b) => reach(a, c.jobs[0]) - reach(b, c.jobs[0]));
      const i = f[0]; P.home[i] = c.key; P.tb[i] = this.nearBase(c.jobs[0]); P.role[i] = 'anchor'; c.mine.push(i); return true;
    };
    CX.list.forEach(c => { c.mine = P.home.map((h, i) => h === c.key ? i : -1).filter(i => i >= 0); });
    CX.list.forEach(c => { if (!c.mine.length) take(c); });
    CX.list.forEach(c => { while (c.mine.length < c.need && take(c)); });
    const rest = [];
    CX.list.forEach(c => {
      if (!c.mine.length) { rest.push(...c.jobs); return; }
      rest.push(...this.packInto(c.mine.map(i => this.state(P.teams[i], this.tbase(P, i), i, P)), c.jobs));
    });
    const fl = free(), sp = CX.sparse.slice().sort(this.urg);
    let rest2 = sp;
    if (fl.length && sp.length) {
      const S = fl.map(i => ({ i, ids: P.teams[i], t: this.tstart(i), pos: this.tbase(P, i) }));
      rest2 = [];
      sp.forEach(j => {
        let best = null;
        S.forEach(s => {
          const hop = this.travel(s.pos, j), arr = s.t + hop, end = arr + this.dur(j);
          if (arr > cfg.cut || (!cfg.ot && end > cfg.end)) return;
          if (!best || hop < best.hop || (hop === best.hop && end < best.end)) best = { s, hop, end };
        });
        if (best) { best.s.ids.push(j.key); best.s.t = best.end; best.s.pos = j; } else rest2.push(j);
      });
      S.forEach(s => { if (s.ids.length) { P.role[s.i] = 'floater'; P.home[s.i] = J.by.get(s.ids[0]).cell.key; P.tb[s.i] = this.crew(s.i).base || 0; } });
    }
    const rest3 = [];
    rest.concat(rest2).sort(this.urg).forEach(j => {
      let best = null; const sb = this.soon(j);
      P.teams.forEach((ids, i) => {
        if (!P.home[i]) return;
        if (P.role[i] !== 'floater' && !sb && this.ringK(P.home[i], j.cell.key) > cfg.ring2) return;
        const s = this.state(ids, this.tbase(P, i), i, P), hop = this.travel(s.pos, j), arr = s.t + hop, end = arr + this.dur(j);
        if (hop > cfg.hop2 || arr > cfg.cut || (!cfg.ot && end > cfg.end)) return;
        if (!best || hop < best.hop) best = { ids, hop };
      });
      if (best) best.ids.push(j.key); else rest3.push(j);
    });
    rest3.forEach(j => { P.why[j.key] = 'internal'; });
    hold.forEach(k => { P.why[k] = 'customer'; });
    P.teams = P.teams.map((ids, i) => ids.length ? this.tidy(ids, this.tbase(P, i)) : ids);
    P.next = rest3.map(j => j.key).concat(hold);
  }
  // A work order that appears during the day joins the anchor of its own cell, then a neighbouring cell, then a floater.
  // A job close to SLA breach goes to the nearest team within ring2 / hop2 and is put at the front of its route.
  place(P, j, B) {
    const cfg = this.st.cfg, sb = this.soon(j), J = this._J;
    let best = null;
    P.teams.forEach((ids, i) => {
      if (!P.home[i]) return;
      const ring = this.ringK(P.home[i], j.cell.key), fl = (P.role || [])[i] === 'floater';
      if (!fl && ring > (sb ? cfg.ring2 : cfg.ring)) return;
      const s = this.state(ids, this.tbase(P, i), i, P), hop = this.travel(s.pos, j), arr = s.t + hop, end = arr + this.dur(j);
      if ((ids.length && hop > (sb ? cfg.hop2 : cfg.maxHop)) || arr > cfg.cut || (!cfg.ot && end > cfg.end)) return;
      const r = sb ? hop : (fl ? cfg.ring + 1 : ring) * 1e4 + hop;
      if (!best || r < best.r) best = { ids, r };
    });
    if (best) {
      if (sb) { let n = 0; while (n < best.ids.length && (k => this.locked(J.by.get(k)) || this.soon(J.by.get(k)))(best.ids[n])) n++; best.ids.splice(n, 0, j.key); }
      else best.ids.push(j.key);
      return true;
    }
    const i = P.teams.findIndex((ids, n) => !P.home[n] && !ids.length);
    if (i >= 0) {
      const nb = this.crew(i).base || 0, arr = this.tstart(i) + this.travel(this.tbase(P, i), j);
      if (arr <= cfg.cut && (cfg.ot || arr + this.dur(j) <= cfg.end)) { P.teams[i].push(j.key); P.home[i] = j.cell.key; P.tb[i] = nb; if (P.role) P.role[i] = 'floater'; return true; }
    }
    return false;
  }
  // Route order: locked jobs, then jobs close to SLA breach (least time left first), then every VIP, then nearest next stop.
  tidy(ids, B) {
    const J = this._J, lk = ids.filter(k => this.locked(J.by.get(k))), free = ids.filter(k => !this.locked(J.by.get(k)));
    const sb = free.filter(k => this.soon(J.by.get(k))).sort((a, b) => this.rem(J.by.get(a)) - this.rem(J.by.get(b)));
    const top = free.filter(k => !sb.includes(k) && J.by.get(k).tier === 'VIP').sort((a, b) => this.cmp(J.by.get(a), J.by.get(b)));
    const nr = k => (this.st.meta[k] || {}).conf === 'noresp';
    const late = free.filter(k => !sb.includes(k) && !top.includes(k) && nr(k));
    const mid = free.filter(k => !sb.includes(k) && !top.includes(k) && !nr(k));
    const out = lk.concat(sb, top);
    let pos = out.length ? J.by.get(out[out.length - 1]) : B;
    while (mid.length) { mid.sort((a, b) => this.travel(pos, J.by.get(a)) - this.travel(pos, J.by.get(b))); const n = mid.shift(); out.push(n); pos = J.by.get(n); }
    while (late.length) { late.sort((a, b) => this.travel(pos, J.by.get(a)) - this.travel(pos, J.by.get(b))); const n = late.shift(); out.push(n); pos = J.by.get(n); }
    return out;
  }

  /* ---------- timeline ---------- */
  calc(P, B) {
    const cfg = this.st.cfg, J = this._J;
    let hops = 0, roadHops = 0;
    const T = P.teams.map((ids, ti) => {
      let t = this.tstart(ti), pos = this.tbase(P, ti), work = 0, trav = 0, dist = 0;
      const E = this.evList(P, ti), kk = { i: 0 };
      const rows = ids.map((k, n) => {
        const j = J.by.get(k), hop = this.travel(pos, j), d = this.km(pos, j), road = this.isRoad(pos, j), sp = this.step(E, kk, t, hop, this.dur(j)), arr = sp.arr, end = sp.end, f = [];
        if (sp.dl) f.push(['warn', 'ETA +' + Math.round(sp.dl) + ' min: ' + sp.hit.map(x => (x.type === 'break' ? 'break' : 'problem') + ' ' + hm(x.at)).join(', ')]);
        hops++; if (road) roadHops++;
        if (arr > cfg.cut) f.push(['bad', 'Starts ' + hm(arr) + ', after the ' + hm(cfg.cut) + ' cut-off']);
        if (end > cfg.end) f.push([cfg.ot ? 'warn' : 'bad', 'Ends ' + hm(end) + ', after ' + hm(cfg.end)]);
        if (n > 0 && hop > cfg.maxHop) f.push(['warn', hop + ' min drive, limit ' + cfg.maxHop]);
        if (j.tier === 'VIP' && ids.slice(0, n).some(x => { const y = J.by.get(x); return y.tier !== 'VIP' && !this.locked(y) && !this.soon(y); })) f.push(['warn', 'VIP: move before the non-VIP jobs']);
        if (this.soon(j)) { const due = this.nowMin() + this.rem(j); if (end > due) f.push(['bad', 'Misses SLA: due ' + hm(due) + ', done ' + hm(end)]); }
        if ((this.st.meta[k] || {}).conf === 'noresp') f.push(['warn', 'No answer yet: consider the end of the route']);
        work += this.dur(j); trav += hop; dist += d; t = end; pos = j;
        return { k, j, hop, d, road, arr, end, f };
      });
      return { ids, rows, work, trav, dist, finish: t };
    });
    T.hops = hops; T.roadHops = roadHops;
    return T;
  }
  cellStats(P, B) {
    const CX = this.clusterInfo(B), inNext = new Set(P.next), st = this.st.cfg.start;
    return this.group(this._J.list).map((g, n) => {
      const cl = CX.of.get(g.key) || null, ctr = !!cl && cl.key === g.key;
      const keys = new Set(g.jobs.map(j => j.key));
      const tms = P.teams.map((ids, i) => P.home[i] === g.key || ids.some(k => keys.has(k)) ? i : -1).filter(i => i >= 0);
      return { ...g, rank: n + 1, cl, ctr, need: ctr ? cl.need : 0, finish: ctr ? cl.finish : st, left: ctr ? cl.left : 0, work: g.jobs.reduce((a, j) => a + this.dur(j), 0), tms, nx: g.jobs.filter(j => inNext.has(j.key)).length, band: bandOf(g.jobs.length) };
    });
  }

  /* ---------- breaks & problems ---------- */
  activeEv(P, i, type) { return ((P.ev || {})[i] || []).find(e => e.end == null && (!type || e.type === type)); }
  startEv(P, i, type, src, at, note) {
    if (!P.ev) P.ev = {};
    const l = P.ev[i] || (P.ev[i] = []);
    if (l.some(e => e.end == null && e.type === type)) return false;
    l.push({ type, at: at != null ? at : this.nowMin(), end: null, est: type === 'break' ? +this.st.cfg.breakEst || 60 : +this.st.cfg.probEst || 30, src: src || 'dispatcher', note: note || '' });
    this.changed(this.tn(i) + ': ' + (type === 'break' ? 'break' : 'problem') + ' started ' + hm(l[l.length - 1].at) + ' (' + (src || 'dispatcher') + ')' + (note ? ' · ' + note : '') + '. ETAs pushed back.');
    return true;
  }
  endEv(P, i, type, src, at) {
    const e = this.activeEv(P, i, type); if (!e) return false;
    e.end = Math.max(e.at, at != null ? at : this.nowMin());
    this.changed(this.tn(i) + ': ' + (e.type === 'break' ? 'break' : 'problem') + ' ended ' + hm(e.end) + ', ' + Math.round(e.end - e.at) + ' min (' + (src || 'dispatcher') + ').');
    return true;
  }
  appEvent(o) {
    const x = this._ctx; if (!x || !x.P || !o) return { ok: false, error: 'IDS not loaded' };
    const P = x.P, nT = P.teams.length;
    let i = typeof o.team === 'number' ? o.team : -1;
    if (i < 0) for (let n = 0; n < nT; n++) { const c = this.crew(n); if ((o.app && c.app && String(c.app) === String(o.app)) || (o.team && this.tn(n).toLowerCase() === String(o.team).toLowerCase())) { i = n; break; } }
    if (i < 0 || i >= nT) return { ok: false, error: 'No team matches ' + (o.app || o.team) };
    const at = o.time ? (d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60)(new Date(o.time)) : null;
    const [kind, phase] = String(o.type || '').split('_');
    if (kind !== 'break' && kind !== 'problem') return { ok: false, error: 'Unknown type ' + o.type };
    const ok = phase === 'end' ? this.endEv(P, i, kind, 'app', at) : this.startEv(P, i, kind, 'app', at, o.note);
    return { ok, team: this.tn(i) };
  }

  /* ---------- actions ---------- */
  move(P, key, dest, idx, label) {
    const J = this._J, j = J.by.get(key);
    if (!j || this.locked(j)) return;
    const from = P.next.includes(key) ? 'H+1' : this.tn(P.teams.findIndex(t => t.includes(key)));
    P.teams = P.teams.map(t => t.filter(k => k !== key));
    P.next = P.next.filter(k => k !== key);
    const list = dest === 'next' ? P.next : P.teams[dest];
    list.splice(Math.max(0, Math.min(idx == null ? list.length : idx, list.length)), 0, key);
    if (dest !== 'next' && !P.home[dest]) { P.home[dest] = j.cell.key; P.tb[dest] = this.nearBase(j); }
    P.teams.forEach((t, i) => { if (!t.length) P.home[i] = null; });
    if (dest === 'next') { if (!P.why[key]) P.why[key] = (this.meta(key).conf === 'resched') ? 'customer' : 'internal'; }
    else delete P.why[key];
    P.manual[key] = true;
    const to = dest === 'next' ? 'H+1' : this.tn(dest);
    this.changed(label || (j.wo + ' (' + (j.uid || j.cid) + ') ' + (from === to ? 'moved to position ' + (list.indexOf(key) + 1) + ' in ' + to : 'moved from ' + from + ' to ' + to) + (dest === 'next' ? ', reason ' + P.why[key] : '') + '.'));
  }
  replan() {
    if (!this.ui.armed) { this.ui.armed = true; clearTimeout(this._arm); this._arm = setTimeout(() => { this.ui.armed = false; this.onChange(); }, 4000); this.onChange(); return; }
    clearTimeout(this._arm); this.ui.armed = false;
    const { P, B } = this._ctx;
    this.autoPlan(P, this._J, B, true);
    this.changed('Plan re-run automatically. Locked jobs and customer reschedules were kept.');
  }
  nudge(P, key, colId, d) {
    const list = colId === 'next' ? P.next : P.teams[colId], i = list.indexOf(key), n = i + d;
    if (i < 0 || n < 0 || n >= list.length) return;
    this.move(P, key, colId, n);
  }
  setConf(P, j, v) {
    const mt = this.meta(j.key), pz = mt.pz || (mt.pz = []), open = pz.length && pz[pz.length - 1].b == null;
    if (v === 'resched' && !open) pz.push({ a: Date.now() }); else if (v !== 'resched' && open) pz[pz.length - 1].b = Date.now();
    mt.conf = v;
    if (v === 'resched' && !this.locked(j)) { P.why[j.key] = 'customer'; this.move(P, j.key, 'next', null, j.wo + ': customer asks to reschedule, deferred to H+1 without aging.'); return; }
    const ti = P.teams.findIndex(t => t.includes(j.key));
    if (ti >= 0 && !this.locked(j)) {
      const t = P.teams[ti].filter(k => k !== j.key);
      if (v === 'noresp') { t.push(j.key); P.teams[ti] = t; this.changed(j.wo + ': no answer, moved to the end of ' + this.tn(ti) + '.'); return; }
      if (v === 'ok') { const idx = P.teams[ti].indexOf(j.key), nr = t.findIndex(k => (this.st.meta[k] || {}).conf === 'noresp'); t.splice(nr >= 0 && nr < idx ? nr : idx, 0, j.key); P.teams[ti] = t; }
    }
    this.changed(j.wo + ': confirmation ' + CONF[v] + '.');
  }
  locate(j) { if (this.onLocate) this.onLocate(j.i); }
  hasJobs(m, i) {
    this._has = this._has && this._has.m === m ? this._has : { m, v: {} };
    if (i in this._has.v) return this._has.v[i];
    const ST = m[this.TY.st]; let y = false;
    if (ST) for (let k = 0; k < m.count && !y; k++) if (m.branch[k] === i && (ST[k] === 0 || ST[k] === 1)) y = true;
    return (this._has.v[i] = y);
  }

  /* ---------- view ---------- */
  // ctx: { host, mapBox, full, hideF, hostBi }
  view(m, ctx) {
    const R = this.R, e = R.createElement, host = ctx.host, cfg = this.st.cfg;
    const bi = this.branchIdx(m, ctx.hostBi);
    const J = this._J = this.jobs(m, bi);
    const BS = this._BS = this.bases(m, bi, J), B = BS[0];
    this.ensureRoad(J, B);
    this._ctx = { m, bi, B, name: m.branches[bi] };
    const P = this.plan(m, bi, J, B);
    this._ctx.P = P;
    if (cfg.rebOn && P.date === this.today() && P.reb !== P.date && !P.prov && this.nowMin() >= cfg.rebAt) {
      P.reb = P.date;
      if (!Object.keys(P.manual || {}).length) { this.autoPlan(P, J, B, true); this.note('Rebalance ' + hm(cfg.rebAt) + ': plan re-run on the current spread of open WO. Locked jobs and customer reschedules kept.'); }
      else this.note('Rebalance ' + hm(cfg.rebAt) + ' skipped: the plan has manual changes. Use Re-plan to rebalance.');
      this.save();
    }
    const T = this.calc(P, B);
    this.ensureRoutes(P, B);
    const G = this._cells = this.cellStats(P, B);
    const pal = this.pal, col = n => pal[n % pal.length];

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
    const sw = (color, k, round) => e('span', { key: k, style: { width: 10, height: 10, borderRadius: round ? '50%' : 2, background: color, flex: 'none' } });

    /* road status */
    const rd = this.road, busy = rd.busy();
    const roadPct = T.hops ? Math.round(T.roadHops / T.hops * 100) : 0;
    const roadTxt = !cfg.roadOn ? 'Road routing off: straight-line estimate' : busy ? 'Loading road drive times ' + rd.done + '/' + rd.total + '…' : rd.err && !rd.m.size ? 'Road router unavailable: straight-line estimate (' + rd.err + ')' : roadPct + '% of drives on road times';

    /* KPIs */
    const used = T.filter(t => t.ids.length), sched = used.reduce((a, t) => a + t.ids.length, 0);
    const nInt = P.next.filter(k => P.why[k] !== 'customer').length, nCus = P.next.length - nInt;
    const CX = this.clusterInfo(B), avail = Math.max(60, cfg.end - cfg.start), flNeed = Math.ceil(CX.sparse.reduce((a, j) => a + this.dur(j), 0) / avail);
    const needAll = CX.list.reduce((a, c) => a + c.need, 0) + flNeed, hot = G.filter(g => g.jobs.length >= 8).length;
    const soonN = J.list.filter(j => this.soon(j)).length, brN = J.list.filter(j => this.breached(j)).length;
    const breaches = T.reduce((a, t) => a + t.rows.reduce((b, r) => b + r.f.filter(f => f[0] === 'bad').length, 0), 0);
    const kpis = [
      { label: 'Open ' + this.type + ' jobs', value: fmtN(J.list.length), sub: (m.branches[bi] || '') + ' · last ' + cfg.maxAge + ' days' },
      { label: 'Grid cells with work', value: fmtN(G.length), sub: hot + ' red or dark red (8+ WO)' },
      { label: 'Teams needed', value: fmtN(needAll), sub: CX.list.length + ' anchor blocks + ' + flNeed + ' floater · ' + cfg.teams + ' available' + (needAll > cfg.teams ? ' · short by ' + (needAll - cfg.teams) : '') },
      { label: 'Near SLA breach', value: fmtN(soonN), sub: cfg.nearH + ' h or less left · ' + fmtN(brN) + ' already breached' },
      { label: 'Scheduled today', value: fmtN(sched), sub: used.length + ' of ' + cfg.teams + ' teams used' + (breaches ? ' · ' + breaches + ' hour breaches' : '') },
      { label: 'Deferred to H+1', value: fmtN(P.next.length), sub: nInt + ' internal (aging) · ' + nCus + ' customer' },
      { label: 'Drive times', value: !cfg.roadOn ? 'Estimate' : busy ? '…' : roadPct + '%', sub: !cfg.roadOn ? 'road routing off' : busy ? 'loading from road router' : 'of drives on real roads' },
    ];

    /* controls */
    const brs = m.branches.map((b, i) => i).filter(i => i === bi || this.hasJobs(m, i));
    const armed = this.ui.armed;
    const controls = e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 } },
      row('Branch', ctx.hostBi >= 0 ? [e('span', { key: 'bn', style: { font: SANS, color: C.ink } }, m.branches[bi]), e('span', { key: 'bh', style: { font: SANS, color: C.muted } }, 'set by the branch filter above')]
        : brs.map(i => chip('br' + i, i === bi, m.branches[i], null, null, () => { cfg.branch = m.branches[i]; this._jobs = null; this.changed(); }))),
      row('Plan', [
        e('span', { key: 'pd', style: { font: MONO, color: C.ink } }, new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })),
        e('span', { key: 'pb', style: { font: SANS, color: C.muted } }, BS.length > 1 ? 'from ' + BS.length + ' bases' : 'from ' + B.name + (B.guess ? ' (approx.)' : '')),
        btn('rp', armed ? 'Click again to replace manual changes' : 'Re-plan automatically', () => this.replan(), true, armed ? { background: C.bad, borderColor: C.bad } : null),
        btn('td', 'Tidy all routes', () => { P.teams = P.teams.map((ids, i) => ids.length ? this.tidy(ids, this.tbase(P, i)) : ids); this.changed('All routes tidied by nearest next stop; VIP rules kept.'); }),
        btn('st', this.ui.settings ? 'Hide settings ▴' : 'Settings ▾', () => { this.ui.settings = !this.ui.settings; if (this.ui.settings) this.ui.draft = JSON.parse(JSON.stringify(cfg)); this.onChange(); }, false, this.ui.settings ? { borderColor: C.ink, background: C.bg } : null),
      ]),
      row('Road', [e('span', { key: 'rs', style: { font: SANS, color: rd.err && !rd.m.size && cfg.roadOn ? C.bad : busy ? C.warn : C.muted } }, roadTxt + (P.prov ? ' · plan is provisional until road times load' : ''))]),
      this.ui.settings ? this.settings(e, row, chip, btn) : null,
      row('WO per cell', BANDS.map((b, n) => e('span', { key: 'b' + n, style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text } },
        e('span', { style: { width: 14, height: 10, background: b.color, opacity: 0.75, border: '1px solid ' + b.color } }), b.label)), 'bands'),
      row('Routes', [
        ...T.map((t, n) => t.ids.length ? e('span', { key: 'lg' + n, style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text } }, sw(col(n)), this.tn(n)) : null),
        e('span', { key: 'lgn', style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text } }, e('span', { style: { width: 10, height: 10, borderRadius: '50%', border: '2px solid #D9480F', boxSizing: 'border-box' } }), 'Deferred H+1'),
        e('span', { key: 'lgd', style: { font: SANS, color: C.muted } }, 'route lines appear once the road route is loaded'),
      ], 'lgd'),
      row('Opacity', [['cellA', 'Grid cells', 0.36], ['routeA', 'Route lines', 1]].map(([k, label, def]) => {
        const v = cfg[k] ?? def;
        return e('label', { key: k, style: { display: 'flex', alignItems: 'center', gap: 8, font: SANS, color: C.text } }, label,
          e('input', { type: 'range', min: 0, max: 1, step: 0.05, value: v, onChange: ev => { cfg[k] = +ev.target.value; this.ver++; this.save(); this.onChange(); }, style: { width: 120, accentColor: C.ink } }),
          e('span', { style: { font: MONO, color: C.muted, minWidth: 34 } }, Math.round(v * 100) + '%'));
      }), 'opa'));

    const tierTxt = 'VIP 10,000 · Highest 800 · High 600 · Normal 400 · Low 200';
    const cards = [
      host.card('IDS ' + this.type + ' map', {
        span: 12, meta: fmtN(J.list.length) + ' open jobs · ' + G.length + ' cells of ' + cfg.gridKm + ' km',
        body: host.mapFrame(controls, ctx.mapBox, ctx.full, ctx.hideF, SANS),
        note: 'Jobs: the latest ' + this.type + ' work order per CID by timestamp, kept only while that order is open' + (cfg.prog ? ' or in progress' : '') + ', dated within the last ' + cfg.maxAge + ' days, on ' + (cfg.blocked ? 'Active and Blocked' : 'Active') + ' accounts' + (J.skipped.old ? ' (' + fmtN(J.skipped.old) + ' older open orders left out)' : '') + '. Job score = ticket priority (' + tierTxt + ') + job type + aging (' + AGING + ' per day carried over for an internal reason). Cell colour and rank = number of open WO in the cell (density); VIP does not change the colour. Inside each team route, VIP jobs go first. Hover a cell for its numbers.' + (J.skipped.unknown ? ' ' + fmtN(J.skipped.unknown) + ' job' + (J.skipped.unknown > 1 ? 's have' : ' has') + ' an unrecognised category and count as Low/Unknown.' : '') + (J.skipped.noPrio ? ' ' + fmtN(J.skipped.noPrio) + ' job' + (J.skipped.noPrio > 1 ? 's have' : ' has') + ' no readable priority and count as Normal.' : ''),
      }),
      host.card('Priority by grid cell', {
        span: 12, meta: 'densest first (most WO) · ' + (this.ui.cellsAll || G.length <= 25 ? G.length : '25 of ' + G.length) + ' cells',
        body: this.cellTable(e, P, host, col, G),
        note: 'Anchor block = a cell plus its 8 neighbours holding ' + cfg.anchorH + ' h of work or more; the block is named after its centre cell. Every block gets one anchor team first, in order of the job closest to SLA breach (SLA ' + cfg.sla + ' h, VIP ' + cfg.slaVip + ' h, counted from WO Created inside ' + hm(cfg.start) + '–' + hm(cfg.end) + ' and paused while the customer asks to reschedule), then is topped up to its Teams needed = the fewest teams that fit every job of the block between ' + hm(cfg.start) + ' and ' + hm(cfg.end) + '. Teams left over become floaters for cells outside any block. Teams with hours left take leftovers from neighbouring cells within ' + cfg.hop2 + ' min; jobs with ' + cfg.nearH + ' h or less to SLA breach go first and to the nearest team. ' + (cfg.rebOn ? 'The plan is re-run once at ' + hm(cfg.rebAt) + ' unless it has manual changes. ' : '') + 'Remaining jobs go to H+1.',
      }),
      host.card('Dispatch board', {
        span: 12, meta: sched + ' scheduled · ' + P.next.length + ' deferred · ' + Object.keys(P.manual).length + ' manual changes',
        body: this.board(e, P, T, B, pill, col),
        note: 'Team 1 works the densest cell. Click a team name to rename it. Within a route: locked jobs, then VIP, then nearest next stop, then customers who did not answer. Setting a job to No answer moves it to the end of its team; Confirmed moves it back ahead of the unanswered jobs. Drag a card to reorder a route at any time. Drag a card to reorder a route, move it to another team or defer it to H+1; on touch screens use the arrows and the Move to list. Jobs on the way, checked in, checked out or In Progress in the data are locked. Drive times marked "est." are straight-line estimates. Plans are saved in this browser for now.',
      }),
      host.card('Dispatcher change log', { span: 12, meta: this.type + ' · latest first', body: this.logView(e) }),
    ];
    return { kpis, cards };
  }

  board(e, P, T, B, pill, col) {
    const J = this._J, cols = [], span = this.st.cfg.end - this.st.cfg.start;
    T.forEach((t, n) => {
      const home = P.home[n] ? this.M.cellLabel(P.home[n]) : null;
      const est = t.rows.filter(r => !r.road).length;
      cols.push(this.column(e, n, this.nameInput(e, n), col(n), [this.baseRow(e, P, n, home), this.evRow(e, P, n)].concat(t.ids.length ? [
        e('div', { key: 'bar', style: { display: 'flex', height: 6, borderRadius: 2, overflow: 'hidden', background: C.soft }, title: 'Dark = on-site work, yellow = travel' },
          e('div', { style: { width: Math.min(100, t.work / span * 100) + '%', background: C.ink } }),
          e('div', { style: { width: Math.max(0, Math.min(100 - t.work / span * 100, t.trav / span * 100)) + '%', background: C.acc } })),
        e('div', { key: 'mt', style: { display: 'flex', flexWrap: 'wrap', gap: '2px 10px', font: MONO, color: C.muted } },
          e('span', null, nf1(t.work / 60) + ' h work'), e('span', null, t.trav + ' min · ' + nf1(t.dist) + ' km' + (est ? ' (' + est + ' est.)' : '')), e('span', { style: { color: t.finish > this.st.cfg.end ? C.bad : C.muted } }, 'done ' + hm(t.finish))),
        e('div', { key: 'cl', style: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' } },
          e('button', { key: 'tidy', type: 'button', onClick: () => { P.teams[n] = this.tidy(P.teams[n], this.tbase(P, n)); this.changed(this.tn(n) + ' route tidied.'); }, style: { marginLeft: 'auto', padding: 0, border: 'none', background: 'none', color: C.ink, textDecoration: 'underline', textUnderlineOffset: 2, font: SANS, cursor: 'pointer' } }, 'Tidy route')),
      ] : [e('span', { key: 'idle', style: { font: SANS, color: C.muted } }, 'Standby')]),
      pill(t.ids.length ? t.ids.length + ' jobs' : 'Idle', t.ids.length ? 'good' : null),
      t.rows.map((r, i) => this.cardEl(e, P, r.j, r, n, i, pill)), P));
    });
    const shown = this.ui.nextAll ? P.next : P.next.slice(0, 60);
    cols.push(this.column(e, 'next', 'Defer to H+1', '#D9480F', [e('span', { key: 'nx', style: { font: SANS, color: C.warn } }, 'Internal reasons add aging +' + AGING + ' tomorrow. Customer requests do not.')],
      pill(P.next.length + ' jobs', 'warn'),
      shown.map((k, i) => this.cardEl(e, P, J.by.get(k), null, 'next', i, pill)).concat(P.next.length > shown.length ? [e('button', { key: 'more', type: 'button', onClick: () => { this.ui.nextAll = true; this.onChange(); }, style: { padding: '6px', border: '1px dashed ' + C.warnLine, borderRadius: 3, background: 'transparent', font: SANS, color: C.warn, cursor: 'pointer' } }, 'Show all ' + P.next.length)] : []), P, true));
    return e('div', { style: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, alignItems: 'flex-start' } }, ...cols);
  }

  baseRow(e, P, n, home) {
    const BS = this._BS || [], cur = this.crew(n).base || 0;
    return e('div', { key: 'hb', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, font: MONO, color: C.muted } },
      home ? e('span', { style: { color: (P.role || [])[n] === 'floater' ? C.warn : C.ink } }, ((P.role || [])[n] === 'floater' ? 'Floater · from ' : 'Anchor · ') + home) : null,
      BS.length > 1 ? e('select', { value: cur, 'aria-label': 'Start base', onChange: ev => { this.setCrew(n, { base: +ev.target.value }); this.changed(this.tn(n) + ' now starts from ' + BS[+ev.target.value].name + '.'); },
        style: { padding: '2px 5px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: SANS, fontSize: 11.5, maxWidth: 170 } },
        ...BS.map((b, i) => e('option', { key: i, value: i }, 'From ' + b.name)))
        : e('span', null, 'From ' + (BS[0] ? BS[0].name : 'base')),
      e('span', null, '· shift ' + hm(this.tstart(n))));
  }
  evRow(e, P, n) {
    const L = this.evList(P, n), br = this.activeEv(P, n, 'break'), pr = this.activeEv(P, n, 'problem');
    const b = (k, label, on, fn) => e('button', { key: k, type: 'button', onClick: fn, style: { padding: '2px 8px', border: '1px solid ' + (on ? C.bad : C.line), borderRadius: 3, background: on ? C.badBg : C.white, color: on ? C.bad : C.ink, font: SANS, fontSize: 11.5, cursor: 'pointer' } }, label);
    return e('div', { key: 'ev', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
        b('br', br ? 'End break' : 'Break', !!br, () => br ? this.endEv(P, n, 'break') : this.startEv(P, n, 'break')),
        b('pr', pr ? 'Problem solved' : 'Problem', !!pr, () => pr ? this.endEv(P, n, 'problem') : this.startEv(P, n, 'problem'))),
      ...L.map((x, k) => e('span', { key: 'e' + k, style: { font: "500 10.5px 'IBM Plex Mono',ui-monospace,monospace", color: x.end == null ? C.bad : C.muted } },
        (x.type === 'break' ? 'Break ' : 'Problem ') + hm(x.at) + '–' + (x.end != null ? hm(x.end) : 'now') + ' · ' + Math.round(this.evDur(x)) + ' min' + (x.end == null && this.evDur(x) <= (x.est || 0) ? ' (est.)' : '') + ' · ' + x.src)));
  }
  nameInput(e, n) {
    return e('input', { key: 'nm' + n + '|' + this.tn(n), type: 'text', defaultValue: this.tn(n), placeholder: 'Team ' + (n + 1), title: 'Team name: click to edit',
      onBlur: ev => { const v = ev.target.value.trim(); if (v !== this.tn(n)) { const old = this.tn(n); this.setName(n, v === 'Team ' + (n + 1) ? '' : v); this.note(old + ' renamed to ' + this.tn(n) + '.'); this.save(); } },
      onKeyDown: ev => { if (ev.key === 'Enter') ev.target.blur(); if (ev.key === 'Escape') { ev.target.value = this.tn(n); ev.target.blur(); } },
      style: { width: 150, minWidth: 0, padding: '2px 5px', border: '1px solid transparent', borderBottom: '1px dashed #B8B8B3', borderRadius: 2, background: 'transparent', color: C.ink, font: "600 12px 'IBM Plex Sans',system-ui,sans-serif", outline: 'none' } });
  }
  column(e, id, title, color, head, badge, cards, P, warn) {
    const drop = this.ui.drop, active = drop && drop.col === id;
    const onDragOver = ev => { if (!this.ui.drag) return; ev.preventDefault(); if (!cards.length || ev.target === ev.currentTarget) this.setDrop(id, cards.length); };
    const onDrop = ev => { ev.preventDefault(); const k = this.ui.drag, d = this.ui.drop; this.ui.drag = null; this.ui.drop = null; if (k && d) this.move(P, k, d.col, d.idx); else this.onChange(); };
    return e('div', { key: 'col' + id, style: { flex: '0 0 288px', display: 'flex', flexDirection: 'column', background: warn ? C.warnBg : C.paper, border: '1px solid ' + (active ? C.ink : warn ? C.warnLine : C.line), borderRadius: 3 } },
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 10px', borderBottom: '1px solid ' + (warn ? C.warnLine : C.line) } },
        e('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          e('span', { style: { display: 'flex', alignItems: 'center', gap: 7, font: "600 11.5px 'IBM Plex Mono',ui-monospace,monospace", letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink } },
            e('span', { style: { width: 10, height: 10, borderRadius: warn ? '50%' : 2, background: warn ? 'transparent' : color, border: warn ? '2px solid ' + color : 'none', boxSizing: 'border-box', flex: 'none' } }), title), badge),
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
    const moveOpts = { '': 'Move to…' }; for (let n = 0; n < nT; n++) moveOpts[n] = this.tn(n) + (P.home[n] ? ' · ' + this.M.cellLabel(P.home[n]) : ''); moveOpts.next = 'Defer H+1';
    const chips = [pill(j.tier, j.tier === 'VIP' ? 'vip' : j.tier === 'Highest' || j.tier === 'High' ? 'acc' : null, 't'),
      pill(j.cat + ' · ' + nf1(this.dur(j) / 60).replace('.0', '') + 'h', CATS[j.cat].lvl === 'Critical' ? 'bad' : CATS[j.cat].lvl === 'High' ? 'warn' : null, 'c'),
      pill(this.cellName(j), null, 'g')];
    const rm = this.rem(j);
    if (rm < 0) chips.push(pill('SLA breached ' + dd(-rm), 'bad', 's')); else if (this.soon(j)) chips.push(pill('SLA ' + dh(rm) + ' left', 'warn', 's'));
    if (ag) chips.push(pill('Aging +' + AGING * ag, 'warn', 'a'));
    if (j.tier === 'VIP') chips.push(pill('VIP first', 'vip', 'v'));
    if (j.noPrio) chips.push(pill('Priority missing', 'warn', 'np'));
    if (j.prog) chips.push(pill('In progress', 'good', 'p'));
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
          e('div', { style: { font: MONO, color: r.road ? C.muted : C.warn, textAlign: 'right' }, title: r.road ? 'Road drive time' : 'Straight-line estimate' }, (r.road ? '+' : '~') + r.hop + ' min' + (r.road ? '' : ' est.'), e('br'), nf1(r.d) + ' km'))
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

  cellTable(e, P, host, col, G) {
    const cfg = this.st.cfg;
    if (!G.length) return e('div', { style: { font: SANS, color: C.muted, padding: '8px 0' } }, 'No open ' + this.type + ' jobs in scope.');
    const mono = v => e('span', { style: { font: "500 12.5px 'IBM Plex Mono',ui-monospace,monospace" } }, v);
    const rows = (this.ui.cellsAll ? G : G.slice(0, 25)).map(g => [
      mono('#' + g.rank),
      e('button', { type: 'button', onClick: () => this.locate(g.jobs.slice().sort(this.cmp)[0]), title: 'Show on the map', style: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', font: "600 12.5px 'IBM Plex Mono',ui-monospace,monospace", color: C.ink, textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: '#B8B8B3', whiteSpace: 'nowrap' } },
        e('span', { style: { width: 12, height: 12, borderRadius: 2, background: g.band.color, flex: 'none' } }), this.M.cellLabel(g.key)),
      [...g.areas].slice(0, 2).join(', ') || '—',
      fmtN(g.jobs.length),
      g.vip ? e('span', { style: { color: C.vip, fontWeight: 600 } }, String(g.vip)) : '0',
      nf1(g.work / 60) + ' h',
      g.ctr ? e('span', { style: { color: C.ink, fontWeight: 600, whiteSpace: 'nowrap' } }, 'Anchor · ' + nf1(g.cl.load / 60) + ' h')
        : g.cl ? e('span', { style: { color: C.muted, whiteSpace: 'nowrap' } }, 'in ' + this.M.cellLabel(g.cl.key)) : e('span', { style: { color: C.warn } }, 'Floater'),
      g.ctr ? e('span', { style: { font: "600 13px 'IBM Plex Mono',ui-monospace,monospace", color: C.ink } }, String(g.need) + (g.left ? ' +' : '')) : '—',
      g.ctr ? e('span', { style: { whiteSpace: 'nowrap', color: g.finish > cfg.end ? C.bad : C.text } }, dh(g.finish - cfg.start) + ' · done ' + hm(g.finish)) : '—',
      g.tms.length ? e('span', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } }, ...g.tms.map(n => e('span', { key: n, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, e('span', { style: { width: 8, height: 8, borderRadius: 2, background: col(n) } }), this.tn(n))))
        : e('span', { style: { color: C.bad, fontWeight: 600 } }, 'none'),
      g.nx ? e('span', { style: { color: C.warn, fontWeight: 600 } }, String(g.nx)) : '0',
    ]);
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      host.table(['#', 'Cell', 'Area', 'WO', 'VIP', 'Work', 'Block', 'Teams needed', 'Est. duration', 'Assigned', 'H+1'], rows, { minWidth: 1000, maxHeight: 520 }),
      G.length > 25 ? e('button', { type: 'button', onClick: () => { this.ui.cellsAll = !this.ui.cellsAll; this.onChange(); }, style: { alignSelf: 'flex-start', padding: '5px 11px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: SANS, cursor: 'pointer' } }, this.ui.cellsAll ? 'Show top 25' : 'Show all ' + G.length + ' cells') : null);
  }
  logView(e) {
    const L = this.st.log;
    if (!L.length) return e('div', { style: { font: SANS, color: C.muted } }, 'No changes yet.');
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' } },
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
    const bl = this.draftBases(d, name), setB = () => { d.bases = { ...d.bases, [name]: bl }; this.onChange(); };
    const tx = { padding: '5px 8px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO };
    return e('div', { key: 'set', style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid ' + C.line, borderRadius: 3, background: C.paper } },
      row('Scope', [lab('Open orders from the last', 'l1'), num('maxAge', 60), lab('days', 'l2'),
        chip('sb', d.blocked, 'Include Blocked accounts', null, null, () => set('blocked', !d.blocked)),
        chip('sp', d.prog, 'Include In Progress orders', null, null, () => set('prog', !d.prog))]),
      row('Teams', [lab('Available', 'l3'), num('teams', 56), lab('Cell size', 'l5'),
        ...[1, 2, 3, 5].map(v => chip('gk' + v, d.gridKm === v, v + ' km', null, null, () => set('gridKm', v)))]),
      ...Array.from({ length: Math.max(1, Math.round(+d.teams || 1)) }, (_, n) => {
        const cr = (d.crew || [])[n] || {}, upd = p => { const a = (d.crew || []).slice(); a[n] = { ...(a[n] || {}), ...p }; d.crew = a; this.onChange(); };
        const st = isFinite(cr.start) && cr.start !== '' ? +cr.start : d.start;
        return row(n ? '' : 'Crew', [
          e('span', { key: 'cn', style: { font: "600 12px 'IBM Plex Sans',system-ui,sans-serif", color: C.ink, minWidth: 110 } }, this.tn(n)),
          e('select', { key: 'cb', value: cr.base || 0, onChange: ev => upd({ base: +ev.target.value }), style: { padding: '4px 6px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: SANS, maxWidth: 260 } },
            ...bl.map((b, k) => e('option', { key: k, value: k }, 'From ' + (b.name || 'Base ' + (k + 1))))),
          lab('Shift start', 'cs' + n),
          e('input', { key: 'ct', type: 'time', value: hm(st), onChange: ev => { const [a, b] = String(ev.target.value).split(':').map(Number); if (isFinite(a) && isFinite(b)) upd({ start: a * 60 + b }); }, style: { padding: '4px 6px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO } }),
          lab('App ID', 'ca' + n),
          e('input', { key: 'cap', type: 'text', defaultValue: cr.app || '', placeholder: 'technician app / device ID', onBlur: ev => upd({ app: ev.target.value.trim() }), style: { ...tx, width: 190 } }),
        ], 'crew' + n);
      }),
      row('Breaks', [lab('Break estimate', 'be'), num('breakEst', 56, 5), lab('min · Problem estimate', 'pe'), num('probEst', 56, 5),
        lab('min. Used until the technician app sends the end; after that the real duration counts.', 'bx')]),
      row('Road', [chip('ro', d.roadOn, 'Road drive times (OSRM)', null, null, () => set('roadOn', !d.roadOn)),
        e('input', { key: 'osrm', type: 'text', value: d.osrm, onChange: ev => set('osrm', ev.target.value), placeholder: 'https://router.project-osrm.org',
          style: { width: 260, padding: '5px 8px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO } }),
        lab('Traffic factor ×', 'l6'), num('traffic', 60, 0.05)]),
      row('Fallback', [lab('If no road time: straight line ×', 'l7'), num('road', 60, 0.05), lab('at', 'l7b'), num('speed', 56), lab('km/h', 'l7c')]),
      row('Reach', [lab('New jobs during the day join a team within', 'l8'), num('ring', 48), lab('cells and', 'l9'), num('maxHop', 56), lab('min', 'l10'),
        lab('· Teams with hours left take leftovers within', 'l11'), num('ring2', 48), lab('cells and', 'l12'), num('hop2', 56), lab('min', 'l13')]),
      row('Anchor', [lab('A block (cell + 8 neighbours) gets an anchor team from', 'an1'), num('anchorH', 56, 0.5), lab('h of work. Teams left over become floaters.', 'an2')]),
      row('SLA', [lab('Normal', 's1'), num('sla', 56), lab('h · VIP', 's2'), num('slaVip', 56), lab('working h from WO Created (paused on reschedule) · near breach at', 's3'), num('nearH', 56, 0.5), lab('h or less left (goes first)', 's4')]),
      row('Rebalance', [chip('rb', d.rebOn, 'Re-plan once at', null, null, () => set('rebOn', !d.rebOn)), time('rebAt'), lab('skipped when the plan has manual changes', 'rb2')]),
      row('Hours', [lab('Start', 'l14'), time('start'), lab('Last start', 'l15'), time('cut'), lab('End', 'l16'), time('end'),
        chip('ot', d.ot, 'Allow overtime', null, null, () => set('ot', !d.ot))]),
      row('Duration', Object.keys(CATS).map(k => e('span', { key: 'd' + k, style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.muted } }, k, num(k, 60, 5, d.dur, 'dur' + k), 'min',
        e('span', { style: { font: "600 9.5px 'IBM Plex Mono',ui-monospace,monospace", letterSpacing: '0.08em', textTransform: 'uppercase', color: CATS[k].src === 'assumed' ? C.warn : C.good } }, CATS[k].src)))),
      ...bl.map((b, n) => row(n ? '' : 'Bases', [
        e('input', { key: 'bn' + n + '|' + bl.length, type: 'text', defaultValue: b.name, placeholder: 'Base name', onBlur: ev => { bl[n] = { ...bl[n], name: ev.target.value.trim() || 'Base ' + (n + 1) }; setB(); }, style: { ...tx, width: 170, font: SANS } }),
        e('input', { key: 'bl' + n + '|' + bl.length, type: 'text', defaultValue: (+b.lat).toFixed(5) + ', ' + (+b.lng).toFixed(5), placeholder: 'lat, lng',
          onBlur: ev => { const p = String(ev.target.value).split(/[,;\s]+/).filter(Boolean).map(Number); if (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) { bl[n] = { ...bl[n], lat: p[0], lng: p[1] }; setB(); } }, style: { ...tx, width: 200 } }),
        bl.length > 1 ? btn('rm' + n, 'Remove', () => { bl.splice(n, 1); setB(); }) : null,
      ], 'base' + n)),
      row('', [btn('ab', '+ Add base', () => { const l = bl[bl.length - 1] || { lat: -8.67, lng: 115.17 }; bl.push({ name: 'Base ' + (bl.length + 1), lat: l.lat, lng: l.lng }); setB(); }),
        lab('Each team starts from the base nearest to its first cell, or the one picked on the board. Paste coordinates from Google Maps as "lat, lng".', 'bh')], 'addb'),
      row('', [btn('ap', 'Apply and re-plan', () => this.apply(), true), btn('cx', 'Cancel', () => { this.ui.settings = false; this.ui.draft = null; this.onChange(); }),
        btn('rs', 'Reset defaults', () => { const keep = { bases: d.bases, branch: d.branch }; this.ui.draft = { ...JSON.parse(JSON.stringify(DEF)), ...keep }; this.onChange(); })], 'act'));
  }
  apply() {
    const d = this.ui.draft; if (!d) return;
    const clean = (v, lo, hi, def) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    const c = this.st.cfg, osrm = String(d.osrm || DEF.osrm).trim().replace(/\/+$/, '');
    if (osrm !== c.osrm) { this.road = new Road(fin => this.roadTick(fin)); this._tq.clear(); this._rq.clear(); }
    Object.assign(c, {
      teams: Math.round(clean(d.teams, 1, 60, DEF.teams)), gridKm: d.gridKm,
      speed: clean(d.speed, 5, 80, DEF.speed), road: clean(d.road, 1, 2.5, DEF.road), traffic: clean(d.traffic, 0.5, 3, DEF.traffic), roadOn: !!d.roadOn, osrm,
      maxHop: clean(d.maxHop, 5, 180, DEF.maxHop), ring: Math.round(clean(d.ring, 0, 5, DEF.ring)), ring2: Math.round(clean(d.ring2, 0, 8, DEF.ring2)), hop2: clean(d.hop2, 5, 240, DEF.hop2),
      start: d.start, cut: Math.max(d.start, d.cut), end: Math.max(d.start + 60, d.end), ot: !!d.ot, maxAge: Math.round(clean(d.maxAge, 0, 3650, DEF.maxAge)),
      blocked: !!d.blocked, prog: !!d.prog, bases: { ...d.bases }, names: (c.names || []).slice(),
      crew: (d.crew || []).map(x => x ? { base: Math.max(0, Math.round(+x.base || 0)), start: isFinite(x.start) && x.start !== '' ? +x.start : undefined, app: x.app || '' } : null),
      breakEst: clean(d.breakEst, 5, 240, DEF.breakEst), probEst: clean(d.probEst, 5, 480, DEF.probEst),
      anchorH: clean(d.anchorH, 0.5, 24, DEF.anchorH), sla: clean(d.sla, 1, 240, DEF.sla), slaVip: clean(d.slaVip, 1, 240, DEF.slaVip), nearH: clean(d.nearH, 0.5, 24, DEF.nearH),
      rebOn: !!d.rebOn, rebAt: clean(d.rebAt, 0, 1439, DEF.rebAt),
      dur: Object.fromEntries(Object.keys(CATS).map(k => [k, clean(d.dur[k], 10, 720, CATS[k].d)])),
    });
    this.ui.settings = false; this.ui.draft = null; this._jobs = null; this._need = null;
    const { m, bi } = this._ctx;
    const J = this._J = this.jobs(m, bi), BS = this._BS = this.bases(m, bi, J), B = BS[0], P = this.st.plans[m.branches[bi]];
    this.ensureRoad(J, B);
    if (P) { this.autoPlan(P, J, B, true); P.prov = c.roadOn && this.road.busy(); }
    this.changed('Settings changed and the plan was re-run.');
  }

  /* ---------- map layer ---------- */
  layer() {
    const x = this._ctx; if (!x || !this._J || !x.P || !this._cells) return null;
    const k = this.type + '|' + this.ver + '|' + this.road.ver + '|' + x.name + '|' + this._J.list.length;
    if (this._layer && this._layer.key === k) return this._layer;
    const J = this._J, P = x.P, cfg = this.st.cfg;
    const tip = j => j.wo + ' · ' + (j.uid || j.cid) + ' · ' + j.tier + ' · ' + j.cat;
    const fit = !this._layer || this._layer.name !== x.name;
    this._layer = {
      key: k, name: x.name, fit, size: cfg.gridKm * 1000, cellA: cfg.cellA ?? 0.36, routeA: cfg.routeA ?? 1,
      cells: this._cells.map(g => ({ key: g.key, color: g.band.color, rank: g.rank,
        tip: [this.M.cellLabel(g.key) + ' · priority #' + g.rank, fmtN(g.jobs.length) + ' WO' + (g.vip ? ' · ' + g.vip + ' VIP (worked first)' : ''),
          g.ctr ? 'Anchor block · ' + nf1(g.cl.load / 60) + ' h · ' + g.need + ' team' + (g.need === 1 ? '' : 's') + ' needed · ' + dh(g.finish - cfg.start) : g.cl ? 'In anchor block ' + this.M.cellLabel(g.cl.key) : 'Outside blocks · floater work', g.tms.length ? 'Assigned: ' + g.tms.map(n => this.tn(n)).join(', ') : 'No team assigned today'] })),
      base: { lat: x.B.lat, lng: x.B.lng, title: x.B.name }, bases: (this._BS || [x.B]).map(b => ({ lat: b.lat, lng: b.lng, title: b.name })),
      teams: P.teams.map((ids, n) => ({ color: this.pal[n % this.pal.length], label: this.tn(n), line: ids.length ? this.road.geo.get(this.routeKey(ids, x.B)) || null : null,
        pts: ids.map(k2 => J.by.get(k2)).filter(Boolean).map(j => ({ lat: j.lat, lng: j.lng, title: this.tn(n) + ' · ' + tip(j) })) })).filter(t => t.pts.length),
      next: P.next.map(k2 => J.by.get(k2)).filter(Boolean).map(j => ({ lat: j.lat, lng: j.lng, title: 'H+1 · ' + tip(j) })),
    };
    return this._layer;
  }
}
