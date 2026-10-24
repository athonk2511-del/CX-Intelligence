// GlobalXtreme BI — IDS (Intelligence Dispatch System). One instance per work-order type: WWR and WCM run as separate pages.
// Grid first: open jobs (latest WO per CID, still open) are grouped into fixed grid cells. A busy cell (more than gridMin WO)
// gets its own anchor team, busy cells ranked by their total job score, then as many teams as it needs. A share of the teams
// (floatPct) is held back as floaters for isolated jobs. Teams with hours left take jobs from the 8 neighbouring cells only.
// Job score = priority tier + job type + aging (internal deferrals) + SLA-overdue booster; within a route higher scores go
// first. A planned lunch break is taken out of every team's day. Drive times: OSRM car routes (or a straight-line estimate)
// multiplied by a traffic factor for the zone: tourist centre, dense, medium or open land (from customer density per cell).

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
// Built-in hubs per branch. The first hub is the default: every team departs from it unless another hub is assigned.
const BALI_RE = /bali|denpasar|badung|kerobokan/i;
const BASES = [
  [BALI_RE, [
    { name: 'GX HQ · Jl. Raya Kerobokan', lat: -8.663833327967687, lng: 115.1673543142895 },
    { name: 'GX GWK', lat: -8.80818374437819, lng: 115.163520401385 },
    { name: 'GX Gatsu', lat: -8.63480345205987, lng: 115.24986225895645 },
  ]],
  [/malang/i, [{ name: 'GX Malang', lat: -7.9797, lng: 112.6304 }]],
];
// Bumped when the built-in hubs change: saved Bali hub lists are replaced by the built-in ones and team hub assignments are
// cleared once (hub numbers change), so every browser starts from the same official hubs.
const HUB_V = '2026-10-24b';
// Settings that stay in this browser (view preferences and migration markers); everything else is shared.
const LOCAL_CFG = ['branch', 'cellA', 'routeA', 'defV', 'hubV'];
const POLL_MS = 10000;
// Tourist centres in Bali, approximate. Within tR km of one of these, drives get the tourist traffic factor. Assumption to be
// calibrated against real Traccar drive times.
const TOURIST = [
  ['Kuta', -8.7180, 115.1690], ['Legian', -8.7040, 115.1700], ['Seminyak', -8.6900, 115.1610], ['Canggu', -8.6480, 115.1380],
  ['Kerobokan', -8.6650, 115.1650], ['Jimbaran', -8.7900, 115.1600], ['Nusa Dua', -8.8000, 115.2300], ['Sanur', -8.6880, 115.2620],
  ['Ubud', -8.5069, 115.2625], ['Denpasar centre', -8.6560, 115.2160],
];
const DEF = {
  teams: 10, gridKm: 3, speed: 35, road: 1.3, roadOn: true, osrm: 'https://router.project-osrm.org',
  zTour: 2.0, zDense: 1.7, zMid: 1.4, zOpen: 1.2, tR: 2.5,
  maxHop: 30, ring: 1, ring2: 1, hop2: 45, homeDetour: 30, start: 540, end: 1020, lastBefore: 60, maxAge: 7, blocked: false, prog: true,
  dur: Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, v.d])), bases: {}, branch: '', crew: [], breakEst: 60, probEst: 30,
  lunchAt: 720, lunchMin: 60, gridMin: 3, floatPct: 10, slaB0: 300, slaBd: 200,
  sla: 12, slaVip: 6, nearH: 3, rebOn: true, rebAt: 720,
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
    // Shared plan: set by the host (api = { get(type, since), post(body) }); without it the plan stays in this browser.
    this.api = null; this.user = ''; this.active = false; this.dataAt = 0;
    this.shInit();
    this.loadHidden();
    this._poll = setInterval(() => this.shPoll(false), POLL_MS);
    // Hook for the technician mobile app: window.GXIDS.WWR.event({ app | team, type, time, note }).
    if (typeof window !== 'undefined') { window.GXIDS = window.GXIDS || {}; window.GXIDS[this.type] = { event: o => this.appEvent(o), types: ['break_start', 'break_end', 'problem_start', 'problem_end'] }; }
    this._tick = setInterval(() => { const P = this._ctx && this._ctx.P; if (P && Object.values(P.ev || {}).some(l => l.some(e => e.end == null))) { this.ver++; this.onChange(); } }, 60000);
  }

  /* ---------- persistence ---------- */
  load() {
    let s = store.load(this.LS);
    s = s && typeof s === 'object' ? s : {};
    const DEF_V = '2026-10-23';
    if (s.cfg && s.cfg.defV !== DEF_V) { ['traffic', 'anchorH', 'speed', 'maxHop', 'ring', 'ring2', 'hop2'].forEach(k => { delete s.cfg[k]; }); s.cfg.defV = DEF_V; }
    if (s.cfg && s.cfg.hubV !== HUB_V) {
      const b = { ...(s.cfg.bases || {}) };
      Object.keys(b).forEach(k => { if (BALI_RE.test(k)) delete b[k]; });
      s.cfg.bases = b;
      s.cfg.crew = (s.cfg.crew || []).map(x => x ? { ...x, base: undefined } : x);
    }
    const cfg = { ...DEF, ...(s.cfg || {}), defV: DEF_V, hubV: HUB_V };
    cfg.dur = { ...DEF.dur, ...((s.cfg || {}).dur || {}) };
    cfg.bases = { ...((s.cfg || {}).bases || {}) };
    return { cfg, plans: s.plans || {}, meta: s.meta || {}, log: Array.isArray(s.log) ? s.log.slice(0, 200) : [] };
  }
  save() {
    store.save(this.LS, this.st);
    if (this.sh && this.sh.on) { clearTimeout(this._pushT); this._pushT = setTimeout(() => this.shPush(), 400); }
  }
  changed(msg) { if (msg) this.note(msg); this.ver++; this.save(); this.onChange(); }
  note(msg) {
    const d = new Date();
    this.st.log.unshift({ id: d.getTime().toString(36) + Math.random().toString(36).slice(2, 7), at: d.getTime(), by: this.user || '', t: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()), msg });
    this.st.log = this.st.log.slice(0, 200);
  }
  tn(n) { const v = (this.st.cfg.names || [])[n]; return v && String(v).trim() ? String(v).trim() : 'Team ' + (n + 1); }
  setName(n, v) { const a = (this.st.cfg.names || []).slice(); a[n] = String(v || '').slice(0, 40); this.st.cfg.names = a; if (this.ui.draft) { const b = (this.ui.draft.names || []).slice(); b[n] = a[n]; this.ui.draft.names = b; } this.ver++; this.save(); this.onChange(); }
  meta(key) { return this.st.meta[key] || (this.st.meta[key] = { conf: 'none', stat: 'none', aging: [] }); }

  /* ---------- what this screen shows on the map (per screen, not shared) ---------- */
  loadHidden() {
    const v = store.load('gx.ids.' + this.type + '.view') || {};
    this.ui.hidden = new Set(Array.isArray(v.teams) ? v.teams : []); this.ui.hideNext = !!v.next; this.ui.hideTech = !!v.tech;
  }
  saveHidden() {
    store.save('gx.ids.' + this.type + '.view', { teams: [...this.ui.hidden], next: this.ui.hideNext, tech: this.ui.hideTech });
    this._layer = null; this.ver++; this.onChange();
  }
  toggleTeam(n) { if (this.ui.hidden.has(n)) this.ui.hidden.delete(n); else this.ui.hidden.add(n); this.saveHidden(); }
  // The team a live Traccar device belongs to: the crew App ID equals the device identifier (or its Traccar id),
  // or the device name equals the team name.
  teamOfDevice(d) {
    const uid = String(d.uniqueId == null ? '' : d.uniqueId).trim(), nm = String(d.name || '').trim().toLowerCase();
    const n = Math.max(1, Math.round(+this.st.cfg.teams || 1));
    for (let i = 0; i < n; i++) {
      const app = String(this.crew(i).app || '').trim();
      if ((app && (app === uid || app === String(d.id))) || (nm && this.tn(i).toLowerCase() === nm)) return i;
    }
    return -1;
  }
  // Live technicians for the IDS map: hidden teams and the "Live technicians" switch apply; team name in the label.
  mapDevices(list) {
    if (this.ui.hideTech) return [];
    return (list || []).map(d => ({ d, t: this.teamOfDevice(d) })).filter(x => x.t < 0 || !this.ui.hidden.has(x.t))
      .map(x => x.t < 0 ? x.d : { ...x.d, name: this.tn(x.t) + ' · ' + x.d.name });
  }

  /* ---------- shared plan (Apps Script) ----------
     The plan is split into parts: 'cfg' (settings shared by everyone), 'plan:<branch>' and 'meta:<WO>' (confirmation,
     technician status, aging). sh.snap holds the JSON of each part as last agreed with the server, sh.revs its server
     revision. A part whose JSON differs from its snapshot is an unsent change. Changes are sent with the revision they
     were made on; the server refuses a part that someone else changed in the meantime (a conflict), and this screen then
     shows their version. Every screen polls for changes every few seconds. */
  shInit() { this.sh = { on: false, ready: false, unsupported: false, rev: null, revs: {}, snap: {}, logSent: new Set(), busy: false, dirty: false, err: null, msg: null, at: 0, by: '', lastOk: 0 }; }
  sharedCfg(c) { const o = { ...c }; LOCAL_CFG.forEach(k => { delete o[k]; }); return o; }
  localParts() {
    const out = { cfg: JSON.stringify(this.sharedCfg(this.st.cfg)) };
    Object.keys(this.st.plans).forEach(n => { out['plan:' + n] = JSON.stringify(this.st.plans[n]); });
    Object.keys(this.st.meta).forEach(k => { out['meta:' + k] = JSON.stringify(this.st.meta[k]); });
    return out;
  }
  serverParts(ids) {
    const out = {};
    if (ids.cfg) out.cfg = JSON.stringify(ids.cfg);
    Object.keys(ids.plans || {}).forEach(n => { out['plan:' + n] = JSON.stringify(ids.plans[n]); });
    Object.keys(ids.meta || {}).forEach(k => { out['meta:' + k] = JSON.stringify(ids.meta[k]); });
    return out;
  }
  hasUnsent() {
    const cur = this.localParts(), sn = this.sh.snap;
    if (Object.keys(cur).some(id => cur[id] !== sn[id]) || Object.keys(sn).some(id => !(id in cur) && id !== 'cfg')) return true;
    return this.st.log.some(e => e.id && !this.sh.logSent.has(e.id));
  }
  setPart(id, json) {
    const v = json == null ? null : JSON.parse(json);
    if (id === 'cfg') {
      if (!v) return;
      const keep = {}; LOCAL_CFG.forEach(k => { if (k in this.st.cfg) keep[k] = this.st.cfg[k]; });
      this.st.cfg = { ...DEF, ...v, dur: { ...DEF.dur, ...(v.dur || {}) }, bases: { ...(v.bases || {}) }, ...keep };
    } else if (id.startsWith('plan:')) { const n = id.slice(5); if (v) this.st.plans[n] = v; else delete this.st.plans[n]; }
    else if (id.startsWith('meta:')) { const k = id.slice(5); if (v) this.st.meta[k] = v; else delete this.st.meta[k]; }
  }
  mergeLog(server) {
    const sh = this.sh, ids = new Set((server || []).map(e => e.id));
    (server || []).forEach(e => sh.logSent.add(e.id));
    const mine = this.st.log.filter(e => e.id && !ids.has(e.id) && !sh.logSent.has(e.id));
    this.st.log = mine.concat(server || []).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 200);
  }
  afterSync(ids) {
    const sh = this.sh;
    sh.rev = ids.rev || 0; sh.at = ids.at || 0; sh.by = ids.by || ''; sh.lastOk = Date.now(); sh.err = null;
    this._jobs = null; this._need = null; this._zone = null; this._zf = null; this._layer = null;
    store.save(this.LS, this.st); this.ver++;
  }
  // First contact: the server plan replaces whatever this browser had (an empty server is seeded from this browser).
  shTakeAll(ids) {
    const sh = this.sh, srv = this.serverParts(ids);
    this.st.plans = {}; this.st.meta = {};
    Object.keys(srv).forEach(id => this.setPart(id, srv[id]));
    sh.snap = { ...srv }; sh.revs = { ...(ids.revs || {}) };
    this.st.log = []; this.mergeLog(ids.log);
    this.afterSync(ids);
  }
  // Merge a newer server plan. sent = the parts this screen just sent (JSON), conflicts = parts the server refused.
  shApply(ids, sent, conflicts, ops) {
    const sh = this.sh, cur = this.localParts(), srv = this.serverParts(ids), cf = new Set(conflicts || []), lost = [];
    const all = new Set([...Object.keys(srv), ...Object.keys(cur), ...Object.keys(sh.snap)]);
    all.forEach(id => {
      const local = cur[id] ?? null, server = srv[id] ?? null, rev = (ids.revs || {})[id] || 0, wasSent = !!sent && Object.prototype.hasOwnProperty.call(sent, id);
      if (wasSent && !cf.has(id)) {
        if (local !== sent[id]) { sh.snap[id] = sent[id] ?? undefined; if (sent[id] == null) delete sh.snap[id]; sh.revs[id] = rev; return; } // edited again since: keep it
      } else if (!wasSent && local !== (sh.snap[id] ?? null)) return; // a local change not sent yet: keep it
      if (cf.has(id) && local !== server) lost.push(id);
      if (id === 'cfg' && server == null) return;
      this.setPart(id, server);
      if (server == null) { delete sh.snap[id]; delete sh.revs[id]; } else { sh.snap[id] = server; sh.revs[id] = rev; }
    });
    this.mergeLog(ids.log);
    this.afterSync(ids);
    const replayable = new Set((ops || []).map(o => 'plan:' + o.plan));
    const shown = lost.filter(id => !replayable.has(id));
    if (shown.length) {
      const what = shown.map(id => id === 'cfg' ? 'the settings' : id.startsWith('plan:') ? 'the ' + id.slice(5) + ' plan' : 'work order ' + id.slice(5));
      sh.msg = { at: Date.now(), text: (ids.by ? ids.by : 'Someone') + ' changed ' + [...new Set(what)].join(', ') + ' at the same time. Their version is shown; redo your change if it is still needed.' };
    }
    return lost;
  }
  // Re-apply this screen's card moves on top of the plan someone else just saved.
  replay(ops, lost) {
    const J = this._J, done = [], skipped = [];
    this._replaying = true;
    try {
      ops.forEach(o => {
        if (lost.indexOf('plan:' + o.plan) === -1) return;
        const P = this.st.plans[o.plan], j = J && J.by.get(o.key);
        if (!P || !j || this.locked(j) || (o.dest !== 'next' && !P.teams[o.dest])) { skipped.push(o.key); return; }
        const list = (o.dest === 'next' ? P.next : P.teams[o.dest]).filter(k => k !== o.key);
        let idx = o.before ? list.indexOf(o.before) : list.length;
        if (idx < 0) idx = o.idx == null ? list.length : Math.min(o.idx, list.length);
        this.move(P, o.key, o.dest, idx, (j.wo || o.key) + ' move re-applied after a simultaneous change by ' + (this.sh.by || 'someone') + '.');
        done.push(o.key);
      });
    } finally { this._replaying = false; }
    if (skipped.length) this.sh.msg = { at: Date.now(), text: (this.sh.by || 'Someone') + ' changed the plan at the same time. ' + skipped.length + ' of your moves could not be re-applied (job started or gone); check the board.' };
    else if (done.length) this.sh.msg = { at: Date.now(), text: 'Merged with ' + (this.sh.by || 'someone') + '\u2019s change made at the same time; your ' + (done.length === 1 ? 'move was' : done.length + ' moves were') + ' re-applied.' };
  }
  shPush() {
    const sh = this.sh;
    if (!this.api || !sh.on) return;
    if (sh.busy) { sh.dirty = true; return; }
    const cur = this.localParts(), parts = {}, base = {}, sent = {};
    new Set([...Object.keys(cur), ...Object.keys(sh.snap)]).forEach(id => {
      const l = cur[id] ?? null;
      if (l === (sh.snap[id] ?? null) || (id === 'cfg' && l == null)) return;
      parts[id] = l == null ? null : JSON.parse(l); base[id] = sh.revs[id] || 0; sent[id] = l;
    });
    const log = this.st.log.filter(e => e.id && !sh.logSent.has(e.id)).map(e => ({ id: e.id, at: e.at, t: e.t, msg: e.msg }));
    if (!Object.keys(parts).length && !log.length) return;
    sh.busy = true; sh.dirty = false;
    const ops = (sh.ops || []).splice(0);
    this.api.post({ type: this.type, base, parts, log }).then(out => {
      log.forEach(e => sh.logSent.add(e.id));
      const lost = this.shApply(out.ids, sent, out.conflicts, ops);
      if (lost.length) this.replay(ops, lost);
    }).catch(err => { sh.err = err.message || String(err); sh.dirty = true; sh.ops = ops.concat(sh.ops || []); })
      .finally(() => { sh.busy = false; this.onChange(); if (sh.dirty) { clearTimeout(this._pushT); this._pushT = setTimeout(() => this.shPush(), sh.err ? 8000 : 50); } });
  }
  shPoll(force) {
    const sh = this.sh;
    if (!this.api || sh.busy || sh.unsupported) return;
    if (!force && (!this.active || (typeof document !== 'undefined' && document.visibilityState === 'hidden'))) return;
    if (this._polling) return;
    this._polling = true;
    this.api.get(this.type, sh.rev).then(ids => {
      if (!ids) { sh.unsupported = true; sh.ready = true; return; }
      const first = sh.rev === null;
      sh.on = true; sh.ready = true;
      if (first) { if ((ids.rev || 0) === 0) { sh.rev = 0; sh.lastOk = Date.now(); this.shPush(); } else this.shTakeAll(ids); }
      else if (!ids.same) this.shApply(ids);
      else { sh.lastOk = Date.now(); sh.err = null; }
      if (!sh.busy && this.hasUnsent()) this.shPush();
    }).catch(err => { sh.err = err.message || String(err); sh.ready = true; })
      .finally(() => { this._polling = false; this.onChange(); });
  }
  syncText() {
    const sh = this.sh;
    if (!this.api) return null;
    if (sh.unsupported) return ['warn', 'This plan is saved in this browser only. Update the Apps Script proxy (ROLE_SETUP.md, step 1) to share it.'];
    if (!sh.on) return sh.err ? ['bad', 'Shared plan not reachable: ' + sh.err + '. Changes stay on this screen until it is back.'] : ['muted', 'Connecting to the shared plan…'];
    const t = sh.at ? new Date(sh.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    if (sh.err) return ['bad', 'Shared plan offline (' + sh.err + '). Your changes are kept and will be sent when it is back.'];
    if (sh.busy || this.hasUnsent()) return ['muted', 'Shared plan · saving…'];
    return ['good', 'Shared plan · everyone sees the same board · last change ' + (t || '—') + (sh.by ? ' by ' + sh.by : '')];
  }

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
    if (this._zm !== m || this._zbi !== bi || this._zg !== cfg.gridKm) { this._zm = m; this._zbi = bi; this._zg = cfg.gridKm; this._zone = null; }
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
    if (hit) return hit[1].map(b => ({ ...b, guess: false }));
    const n = J.list.length || 1;
    return [{ name: name + ' centre of jobs', lat: J.list.reduce((a, j) => a + j.lat, 0) / n || -8.67, lng: J.list.reduce((a, j) => a + j.lng, 0) / n || 115.17, guess: true }];
  }
  base(m, bi, J) { return this.bases(m, bi, J)[0]; }
  // Per-team setup: start base, shift start and the technician app ID that sends break / problem events.
  crew(i) { return (this.st.cfg.crew || [])[i] || {}; }
  // Departure hub of a team: the hub assigned in Crew settings (or on the board), else the first hub = default
  // (GlobalXtreme HQ Kerobokan for Bali). The team departs from and returns to this hub every day.
  hubOf(i) { const BS = this._BS || [], b = this.crew(i).base; return b != null && b !== '' && +b >= 0 && BS[+b] ? +b : 0; }
  tbase(P, i) { const BS = this._BS || []; return BS[this.hubOf(i)] || BS[0]; }
  // Hubs in use by the available teams: used to estimate how many teams a cell needs.
  usedHubs() { const BS = this._BS || [], n = Math.max(1, Math.round(+this.st.cfg.teams || 1)), set = new Set(); for (let i = 0; i < n; i++) set.add(this.hubOf(i)); return [...set].map(k => BS[k]).filter(Boolean); }
  nearUsedHub(j, B) { let best = null, bt = Infinity; this.usedHubs().forEach(h => { const t = this.travel(h, j); if (t < bt) { bt = t; best = h; } }); return best || B; }
  tstart(i) { const c = this.crew(i); return isFinite(c.start) && c.start !== '' ? +c.start : this.st.cfg.start; }
  // Shift end of a team: its own end time, else its start plus the default shift length.
  tend(i) {
    const c = this.crew(i), cfg = this.st.cfg, st = this.tstart(i);
    const e = isFinite(c.end) && c.end !== '' && c.end !== null ? +c.end : st + (cfg.end - cfg.start);
    return e > st ? e : st + (cfg.end - cfg.start);
  }
  // Latest time a job may start for a team: lastBefore minutes before its shift end. The job may finish after the shift.
  tlast(i) { return (i != null ? this.tend(i) : this.st.cfg.end) - Math.max(0, +this.st.cfg.lastBefore || 0); }
  setCrew(i, patch) { const a = (this.st.cfg.crew || []).slice(); a[i] = { ...(a[i] || {}), ...patch }; this.st.cfg.crew = a; }
  nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
  // Planned lunch, taken out of every team's day. Replaced by the real break once the technician app reports one.
  // Lunch sits the same time after shift start as in the default shift (12:00 for 09:00 = 3 h in).
  lunchE(i) {
    const c = this.st.cfg, n = +c.lunchMin || 0, at = (i != null ? this.tstart(i) : c.start) + ((+c.lunchAt || 720) - c.start);
    return n > 0 ? [{ type: 'break', at, end: at + n, planned: true }] : [];
  }
  evList(P, i) {
    const real = ((P && P.ev) || {})[i] || [];
    return real.concat(real.some(e => e.type === 'break') ? [] : this.lunchE(i)).slice().sort((a, b) => a.at - b.at);
  }
  // A team's running state for planning: { ids, t (free from), pos, E (breaks/problems), k (cursor into E) }.
  fresh(i, P, B) { return { i, ids: [], t: i != null ? this.tstart(i) : this.st.cfg.start, last: this.tlast(i), pos: B, E: i != null ? this.evList(P, i) : this.lunchE(), k: { i: 0 } }; }
  fit(s, j) { const k = { i: s.k.i }, hop = this.travel(s.pos, j), sp = this.real(j, s.E, k, this.step(s.E, k, s.t, hop, this.dur(j))); return { arr: sp.arr, end: sp.end, hop, ki: k.i, last: s.last }; }
  // Check-out time typed by the dispatcher for today (minutes since midnight), or null.
  coOf(j) { const mt = this.st.meta[j.key]; return mt && mt.stat === 'checkout' && mt.co != null && mt.coDay === this.today() ? +mt.co : null; }
  // Replace the projection with what really happened: a checked-out job ends at its check-out time (earlier or later than
  // projected); a job checked in, or on the way, is still running, so it cannot end before now (+ its work time when the
  // technician has not arrived yet). Everything after it in the route moves with it.
  real(j, E, k, sp) {
    const st = (this.st.meta[j.key] || {}).stat, co = this.coOf(j), proj = sp.end;
    if (co != null) {
      sp.arr = Math.min(sp.arr, co); sp.end = co;
      while (k.i < E.length && E[k.i].at < co) k.i++;   // breaks / problems before the check-out are inside the real time
    } else if (st === 'checkin' || (j.prog && st !== 'start')) {
      sp.end = Math.max(sp.end, this.nowMin());
    } else if (st === 'start') {
      sp.arr = Math.max(sp.arr, this.nowMin()); sp.end = Math.max(sp.end, sp.arr + this.dur(j));
    }
    sp.proj = proj;
    return sp;
  }
  // A job fits when it can start by the team's last-start time; finishing after the shift end is allowed.
  ok(f) { return f.arr <= f.last; }
  put(s, j, f) { s.ids.push(j.key); s.t = f.end; s.pos = j; s.k.i = f.ki; }
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
  score(j) { return TIERS[j.tier].s + CATS[j.cat].s + AGING * this.aging(j) + this.slaBoost(j); }
  // Overdue booster: slaB0 once the SLA is breached, plus slaBd for every full working day past it.
  slaBoost(j) {
    const c = this.st.cfg, r = this.rem(j);
    if (!(r < 0)) return 0;
    return (+c.slaB0 || 0) + (+c.slaBd || 0) * Math.floor(-r / Math.max(60, c.end - c.start));
  }
  urgent(j) { return CATS[j.cat].s >= 400; }
  vipLate(j) { return j.tier === 'VIP' && !this.urgent(j); }
  locked(j) { const s = (this.st.meta[j.key] || {}).stat; return j.prog || s === 'start' || s === 'checkin' || s === 'checkout'; }
  // Started jobs first, in the order they really happened: checked out (by check-out time), then the job the team is
  // working on (checked in / In Progress), then the one it is driving to. The other jobs keep their order after them.
  lockRank(j) { const co = this.coOf(j), s = (this.st.meta[j.key] || {}).stat; return co != null ? co : s === 'start' ? 3000 : 2000; }
  lockFirst(ids) {
    const by = k => this._J.by.get(k), lk = ids.filter(k => by(k) && this.locked(by(k)));
    if (!lk.length) return ids;
    const pos = new Map(ids.map((k, n) => [k, n]));
    lk.sort((a, b) => this.lockRank(by(a)) - this.lockRank(by(b)) || pos.get(a) - pos.get(b));
    return lk.concat(ids.filter(k => !lk.includes(k)));
  }
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
  // Car drive time, free-flow (OSRM or straight line ÷ speed), times the average traffic factor of the two end zones.
  travel(a, b) {
    const cfg = this.st.cfg, r = this.roadHit(a, b), f = (this.zoneF(a) + this.zoneF(b)) / 2;
    if (r) return Math.max(r.min < 0.5 ? 0 : 1, Math.round(r.min * f));
    const d = hav(a, b) * cfg.road;
    return d < 0.05 ? 0 : Math.max(3, Math.round(d / Math.max(5, cfg.speed) * 60 * f));
  }
  // Traffic zone of a point: tourist centre (within tR km), else by customer density of its grid cell: top quarter of
  // cells = dense, next third = medium, the rest (rice fields, open land) = open.
  zoneOf(p) {
    const c = this.st.cfg;
    if (TOURIST.some(t => hav(p, { lat: t[1], lng: t[2] }) <= (+c.tR || 2.5))) return 'tour';
    const Z = this.zoneMap(); if (!Z) return 'mid';
    const k = this.M.cellOf(p.lat, p.lng, c.gridKm * 1000), n = Z.n.get(k[0] + ',' + k[1]) || 0;
    return n >= Z.hi ? 'dense' : n >= Z.mid ? 'mid' : 'open';
  }
  zoneF(p) {
    if (!p || !isFinite(p.lat)) return 1.4;
    const c = this.st.cfg, key = p.zk || (p.zk = p.lat.toFixed(4) + ',' + p.lng.toFixed(4)), Z = this.zoneMap(), cache = Z ? Z.f : (this._zf || (this._zf = new Map()));
    let z = cache.get(key); if (!z) { z = this.zoneOf(p); cache.set(key, z); }
    return +({ tour: c.zTour, dense: c.zDense, mid: c.zMid, open: c.zOpen }[z]) || 1.4;
  }
  zoneMap() {
    if (this._zone) return this._zone;
    const m = this._zm, bi = this._zbi, c = this.st.cfg;
    if (!m || !m.count) return null;
    const n = new Map();
    for (let i = 0; i < m.count; i++) {
      if (m.branch[i] !== bi || !isFinite(m.lat[i]) || !isFinite(m.lng[i])) continue;
      const k = this.M.cellOf(m.lat[i], m.lng[i], c.gridKm * 1000), key = k[0] + ',' + k[1];
      n.set(key, (n.get(key) || 0) + 1);
    }
    const v = [...n.values()].sort((a, b) => a - b), q = x => v.length ? v[Math.min(v.length - 1, Math.floor(v.length * x))] : Infinity;
    this._zone = { n, hi: q(0.75), mid: q(0.42), f: new Map() };
    return this._zone;
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
    const s = this.fresh(i, P, B);
    ids.forEach(k => { const j = this._J.by.get(k); if (!j) return; this.put(s, j, this.fit(s, j)); });
    s.ids = ids;
    return s;
  }
  // Greedy: each job (already in score order) goes to the team that would finish it earliest within working hours.
  packInto(S, jobs) {
    const left = [];
    jobs.forEach(j => {
      let best = null;
      S.forEach(s => { const f = this.fit(s, j); if (this.ok(f) && (!best || f.end < best.f.end)) best = { s, f }; });
      if (best) this.put(best.s, j, best.f); else left.push(j);
    });
    return left;
  }
  // Working minutes in a team day, after the planned lunch.
  dayMin() { const c = this.st.cfg; return Math.max(60, c.end - c.start - (+c.lunchMin || 0)); }
  // Teams a cell needs: the smallest number of teams that fits every job of the cell into today's hours.
  needOf(jobs, B) {
    const cfg = this.st.cfg;
    if (!jobs.length) return { n: 0, left: 0, finish: cfg.start };
    let n = Math.max(1, Math.ceil(jobs.reduce((a, j) => a + this.dur(j), 0) / this.dayMin())), r = null;
    for (; n <= jobs.length; n++) {
      const S = Array.from({ length: n }, () => this.fresh(null, null, B));
      const left = this.packInto(S, jobs);
      r = { n, left: left.length, finish: Math.max(...S.map(s => s.t)) };
      if (!left.length) break;
    }
    return r;
  }
  // Busy cells: a cell holding more than gridMin open WO gets its own anchor team. Busy cells are ranked by the total score
  // of their jobs, so with too few teams the most important cells are staffed first. Other cells are sparse: their jobs go
  // to anchor teams in a neighbouring cell (8 directions) or to floaters.
  clusters(list, B) {
    const cfg = this.st.cfg, min = Math.max(0, Math.round(+cfg.gridMin || 0)), out = [], sparse = [];
    this.group(list).forEach(g => {
      // A cell holding an urgent VIP (Wiredown / Power) always counts as busy, so it gets a team even when it is quiet.
      if (g.jobs.length <= min && !g.jobs.some(j => j.tier === 'VIP' && this.urgent(j))) { sparse.push(...g.jobs); return; }
      const jobs = g.jobs.slice().sort(this.cmp), live = jobs.map(j => this.rem(j)).filter(r => r >= 0);
      const nd = this.needOf(jobs, this.nearUsedHub(jobs[0], B));
      out.push({ key: g.key, cells: [g.key], vipOnly: g.jobs.length <= min, jobs, load: jobs.reduce((a, j) => a + this.dur(j), 0), total: g.score, minRem: live.length ? Math.min(...live) : Infinity, breached: jobs.filter(j => this.breached(j)).length, need: nd.n, finish: nd.finish, left: nd.left });
    });
    out.sort((a, b) => b.total - a.total || b.jobs.length - a.jobs.length);
    const of = new Map(); out.forEach(c => of.set(c.key, c));
    return { list: out, of, sparse: sparse.sort(this.cmp) };
  }
  clusterInfo(B) {
    const sig = this.cfgSig();
    if (this._need && this._need.J === this._J && this._need.rv === this.road.ver && this._need.cv === sig) return this._need.v;
    const v = this.clusters(this._J.list, B);
    this._need = { J: this._J, rv: this.road.ver, cv: sig, v };
    return v;
  }
  cfgSig() { const c = this.st.cfg; return [c.start, c.end, c.lastBefore, JSON.stringify(c.crew || []), c.zTour, c.zDense, c.zMid, c.zOpen, c.tR, c.homeDetour, c.speed, c.road, c.roadOn, c.gridMin, c.lunchAt, c.lunchMin, c.slaB0, c.slaBd, c.sla, c.slaVip, c.nearH, Math.floor(Date.now() / 600000), JSON.stringify(c.dur), JSON.stringify(Object.values(this.st.meta).map(x => x.aging.length))].join('|'); }

  /* ---------- planning ---------- */
  today() { return ymd(new Date()); }
  plan(m, bi, J, B) {
    const name = m.branches[bi] || 'Branch', day = this.today();
    let P = this.st.plans[name];
    if (P && (P.date !== day || !Array.isArray(P.home))) { if (P.date !== day) this.rollover(P, J); P = null; }
    if (!P) {
      P = this.st.plans[name] = { date: day, teams: [], home: [], next: [], why: {}, manual: {}, prov: this.st.cfg.roadOn && this.road.busy(), reb: this.nowMin() >= this.st.cfg.rebAt ? day : null };
      this.autoPlan(P, J, B, false);
      P.dataAt = this.dataAt || 0; P.gone = {}; P.goneV = 2;
      this.note(this.type + ' plan for ' + name + ' created: ' + P.teams.reduce((a, t) => a + t.length, 0) + ' jobs scheduled, ' + P.next.length + ' deferred' + (P.prov ? ' (provisional until road times load).' : '.'));
      this.save();
      return P;
    }
    if (!Array.isArray(P.tb)) P.tb = P.teams.map(() => 0);
    if (!Array.isArray(P.role)) P.role = P.teams.map((t, i) => P.home[i] ? 'anchor' : null);
    // One-time repair (2026-10-25): screens that read work orders from the old sheet marked CSV work orders as
    // closed. Forget those marks so the missing work orders are added back.
    if (P.goneV !== 2) { P.gone = {}; P.goneV = 2; }
    const known = new Set([...P.teams.flat(), ...P.next]);
    // Work orders that this screen's data does not have (unknown) or has but the plan does not (fresh). When the plan was
    // last built from newer data than this screen holds, this screen reloads its data first instead of changing the plan,
    // so an older screen never removes new work orders or brings back closed ones.
    const gone = P.gone || (P.gone = {});
    const unknown = [...known].filter(k => !J.by.has(k));
    const fresh = J.list.filter(j => !known.has(j.key) && !gone[j.key]);
    this.behind = (unknown.length > 0 || fresh.length > 0) && (P.dataAt || 0) > (this.dataAt || 0) + 60000 && !this.skewOK;
    if (this.behind) return P;
    let drop = unknown.length > 0;
    const now = Date.now();
    unknown.forEach(k => { gone[k] = now; });
    Object.keys(gone).forEach(k => { if (now - gone[k] > 3 * 864e5) delete gone[k]; });
    P.teams = P.teams.map(t => t.filter(k => J.by.has(k)));
    P.next = P.next.filter(k => J.by.has(k));
    P.teams.forEach((t, i) => { if (!t.length) P.home[i] = null; });
    if (drop || fresh.length) P.dataAt = Math.max(P.dataAt || 0, this.dataAt || 0);
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
      mt.conf = 'none'; mt.stat = 'none'; delete mt.co; delete mt.coDay;
    });
    if (n) this.note(n + ' job' + (n > 1 ? 's' : '') + ' from ' + P.date + ' carried over with aging +' + AGING + ' (internal reason).');
  }
  // 1. Busy cells (more than gridMin WO), highest total score first: each gets one anchor team, then is topped up to the teams
  //    it needs, keeping floatPct of the teams back as floaters. 2. Each anchor team works its own cell, highest score first.
  // 3. Anchor teams with hours left take jobs from the 8 neighbouring cells (ring2 = 1), highest score first.
  // 4. Floaters (the reserve plus teams without a busy cell) take what is left anywhere, highest score first.
  // 5. Routes are put in order (tidy); a job that no longer fits the working day goes to H+1 with aging.
  autoPlan(P, J, B, keepLocked) {
    const cfg = this.st.cfg, nT = Math.max(1, Math.round(cfg.teams));
    const old = P.teams || [], oldHome = P.home || [], oldWhy = P.why || {}, oldTb = P.tb || [], oldRole = P.role || [];
    P.teams = Array.from({ length: nT }, () => []); P.home = Array(nT).fill(null); P.tb = Array(nT).fill(0); P.role = Array(nT).fill(null);
    P.why = {}; P.manual = {};
    const placed = new Set(), orphan = [];
    if (keepLocked) old.forEach((t, i) => t.forEach(k => {
      const j = J.by.get(k);
      if (!j || !this.locked(j)) return;
      placed.add(k);
      if (i >= nT) { orphan.push(k); return; } // its team was removed: never pile these onto another team
      P.teams[i].push(k);
      if (!P.home[i]) { P.home[i] = oldHome[i] || j.cell.key; P.tb[i] = this.hubOf(i); P.role[i] = oldRole[i] || 'anchor'; }
    }));
    const hold = (keepLocked ? P.next || [] : []).filter(k => oldWhy[k] === 'customer' && J.by.has(k) && !placed.has(k));
    hold.forEach(k => placed.add(k));
    const CX = this.clusters(J.list.filter(j => !placed.has(j.key)), B);
    const reserve = CX.list.length ? Math.min(nT - 1, Math.round(nT * (+cfg.floatPct || 0) / 100)) : 0;
    let gridLeft = nT - reserve - P.home.filter(Boolean).length;
    const free = () => P.teams.map((t, i) => i).filter(i => !P.home[i] && !P.teams[i].length);
    const reach = (i, j) => this.tstart(i) + this.travel(this.tbase(P, i), j);
    const assign = (i, c) => { P.home[i] = c.key; P.tb[i] = this.hubOf(i); P.role[i] = 'anchor'; c.mine.push(i); gridLeft--; };
    const take = c => {
      if (gridLeft <= 0) return false;
      const f = free(); if (!f.length) return false;
      f.sort((a, b) => reach(a, c.jobs[0]) - reach(b, c.jobs[0]));
      assign(f[0], c); return true;
    };
    CX.list.forEach(c => { c.mine = P.home.map((h, i) => h === c.key ? i : -1).filter(i => i >= 0); });
    // First team per busy cell. Which cells get a team is decided by score (CX.list order); which team goes where is then
    // matched across all those cells, shortest drive from the team's own hub first, so a hub team serves the cells near it.
    // Cells holding an urgent VIP (Wiredown, Power) are served first, by the team that reaches them soonest.
    CX.list.forEach(c => { if (!c.mine.length && c.jobs.some(j => j.tier === 'VIP' && this.urgent(j))) take(c); });
    const want = [];
    CX.list.forEach(c => { if (!c.mine.length && want.length < Math.min(gridLeft, free().length)) want.push(c); });
    while (want.length && gridLeft > 0) {
      let best = null;
      free().forEach(i => want.forEach((c, n) => { const r = reach(i, c.jobs[0]); if (!best || r < best.r) best = { i, c, n, r }; }));
      if (!best) break;
      assign(best.i, best.c); want.splice(best.n, 1);
    }
    CX.list.forEach(c => { while (c.mine.length < c.need && take(c)); });
    const S = new Map(), st = i => { if (!S.has(i)) S.set(i, this.state(P.teams[i], this.tbase(P, i), i, P)); return S.get(i); };
    let rest = [];
    CX.list.forEach(c => { if (!c.mine.length) rest.push(...c.jobs); else rest.push(...this.packInto(c.mine.map(st), c.jobs)); });
    rest = rest.concat(CX.sparse).sort(this.cmp);
    // A team sent to a quiet cell only for its urgent VIP works as a floater once the VIP is done.
    CX.list.forEach(c => { if (c.vipOnly) c.mine.forEach(i => { P.role[i] = 'floater'; }); });
    const better = (x, y) => !y || x.f.hop < y.f.hop || (x.f.hop === y.f.hop && x.f.end < y.f.end);
    const anchors = P.teams.map((t, i) => i).filter(i => P.home[i] && P.role[i] !== 'floater'), rest2 = [];
    rest.forEach(j => {
      let best = null;
      anchors.forEach(i => {
        if (this.ringK(P.home[i], j.cell.key) > Math.max(0, +cfg.ring2 || 0)) return;
        const s = st(i), f = this.fit(s, j);
        if (this.ok(f) && better({ f }, best)) best = { s, f };
      });
      if (best) this.put(best.s, j, best.f); else rest2.push(j);
    });
    const fl = free().concat(P.teams.map((t, i) => i).filter(i => P.role[i] === 'floater' && P.teams[i].length)), rest3 = [];
    rest2.forEach(j => {
      let best = null;
      fl.forEach(i => {
        const s = st(i), f = this.fit(s, j);
        if (!this.ok(f) || (s.ids.length && f.hop > (+cfg.hop2 || Infinity))) return;
        if (better({ f }, best)) best = { i, s, f };
      });
      if (!best) { rest3.push(j); return; }
      this.put(best.s, j, best.f);
      if (!P.home[best.i]) { P.home[best.i] = j.cell.key; P.role[best.i] = 'floater'; P.tb[best.i] = this.hubOf(best.i); }
    });
    P.teams = P.teams.map((ids, i) => ids.length ? this.tidy(ids, this.tbase(P, i)) : ids);
    const over = [];
    P.teams = P.teams.map((ids, i) => { if (!ids.length) return ids; const r = this.fitRoute(P, i, ids); over.push(...r.drop); return r.keep; });
    P.teams.forEach((t, i) => { if (!t.length) { P.home[i] = null; P.role[i] = null; } });
    // 6. Every team with hours left (anchor or floater) picks up work on the way back to its base: each pick must bring it
    //    closer to the base, cost at most homeDetour extra minutes and start by the last-start time (cut, 1 h before the
    //    end of the day); the highest score among those goes first. Teams that are free earliest choose first.
    P.ret = {};
    const pool = rest3.map(j => j.key).concat(over).map(k => J.by.get(k)).filter(Boolean);
    const fin = i => this.state(P.teams[i], this.tbase(P, i), i, P).t;
    P.teams.map((ids, i) => i).filter(i => P.teams[i].length).sort((a, b) => fin(a) - fin(b)).forEach(i => {
      const ids = P.teams[i];
      const base = this.tbase(P, i), s = this.state(ids, base, i, P);
      for (;;) {
        const dHome = this.travel(s.pos, base);
        let best = null;
        pool.forEach((j, n) => {
          const back = this.travel(j, base); if (back >= dHome) return;
          const det = this.travel(s.pos, j) + back - dHome; if (det > Math.max(0, +cfg.homeDetour || 0)) return;
          const f = this.fit(s, j); if (!this.ok(f)) return;
          const sc = this.score(j);
          if (!best || sc > best.sc || (sc === best.sc && det < best.det)) best = { n, j, f, sc, det };
        });
        if (!best) break;
        this.put(s, best.j, best.f); P.ret[best.j.key] = true; pool.splice(best.n, 1);
      }
    });
    const left = new Set(pool.map(j => j.key)), rest3k = rest3.map(j => j.key).filter(k => left.has(k)), overk = over.filter(k => left.has(k));
    rest3k.concat(overk, orphan).forEach(k => { P.why[k] = 'internal'; });
    hold.forEach(k => { P.why[k] = 'customer'; });
    P.next = rest3k.concat(overk, orphan, hold);
    P.dataAt = Math.max(P.dataAt || 0, this.dataAt || 0);
    if (orphan.length) this.note(orphan.length + ' started job' + (orphan.length > 1 ? 's' : '') + ' belonged to a removed team; moved to H+1 for the dispatcher to reassign.');
  }
  // Walk a route in order. A job not yet started that no longer fits the working day is dropped; started jobs always stay.
  fitRoute(P, i, ids) {
    const s = this.fresh(i, P, this.tbase(P, i)), drop = [];
    ids.forEach(k => { const j = this._J.by.get(k); if (!j) return; const f = this.fit(s, j); if (this.locked(j) || this.ok(f)) this.put(s, j, f); else drop.push(k); });
    return { keep: s.ids, drop };
  }
  // A work order that appears during the day joins the anchor team of its own cell, then one in a neighbouring cell (ring),
  // then a floater, then a free team. Urgent VIP (Wiredown / Power) goes to the front after started jobs; every other job,
  // non-urgent VIP included, joins the end of the route so work already under way is not disturbed.
  place(P, j, B) {
    const cfg = this.st.cfg, J = this._J;
    let best = null;
    P.teams.forEach((ids, i) => {
      if (!P.home[i]) return;
      const fl = (P.role || [])[i] === 'floater', ring = this.ringK(P.home[i], j.cell.key);
      if (!fl && ring > Math.max(0, +cfg.ring || 0)) return;
      const s = this.state(ids.slice(), this.tbase(P, i), i, P), f = this.fit(s, j);
      if (!this.ok(f) || (ids.length && f.hop > (fl ? cfg.hop2 : cfg.maxHop))) return;
      const r = (fl ? (+cfg.ring || 0) + 1 : ring) * 1e4 + f.hop;
      if (!best || r < best.r) best = { ids, r };
    });
    if (best) {
      if (j.tier === 'VIP' && this.urgent(j)) {
        let n = 0;
        while (n < best.ids.length && (y => this.locked(y) || (y.tier === 'VIP' && this.urgent(y)))(J.by.get(best.ids[n]))) n++;
        best.ids.splice(n, 0, j.key);
      } else best.ids.push(j.key);
      return true;
    }
    const i = P.teams.findIndex((ids, n) => !P.home[n] && !ids.length);
    if (i >= 0 && this.ok(this.fit(this.fresh(i, P, this.tbase(P, i)), j))) {
      P.teams[i].push(j.key); P.home[i] = j.cell.key; P.tb[i] = this.hubOf(i); if (P.role) P.role[i] = 'floater'; return true;
    }
    return false;
  }
  // Route order: started (locked) jobs as they are, then urgent VIP (Wiredown / Power), then every other job by score, highest
  // first (equal scores: nearest next stop), then non-urgent VIP after the existing work, then customers who did not answer.
  tidy(ids, B, ret) {
    const J = this._J, by = k => J.by.get(k), nr = k => (this.st.meta[k] || {}).conf === 'noresp', R = ret || {};
    const lk = ids.filter(k => this.locked(by(k))), back = ids.filter(k => !this.locked(by(k)) && R[k]), free = ids.filter(k => !this.locked(by(k)) && !R[k]);
    const top = free.filter(k => !nr(k) && by(k).tier === 'VIP' && this.urgent(by(k)));
    const late = free.filter(k => !nr(k) && this.vipLate(by(k)));
    const mid = free.filter(k => !nr(k) && !top.includes(k) && !late.includes(k));
    const out = this.lockFirst(lk);
    let pos = out.length ? by(out[out.length - 1]) : B;
    const byScore = list => {
      const L = list.map(k => ({ k, s: this.score(by(k)) }));
      while (L.length) {
        const hi = Math.max(...L.map(x => x.s));
        let bi = -1, bt = Infinity;
        L.forEach((x, n) => { if (x.s !== hi) return; const t = this.travel(pos, by(x.k)); if (t < bt) { bt = t; bi = n; } });
        const k = L.splice(bi, 1)[0].k; out.push(k); pos = by(k);
      }
    };
    byScore(top); byScore(mid); byScore(late);
    const L = free.filter(nr);
    while (L.length) { L.sort((a, b) => this.travel(pos, by(a)) - this.travel(pos, by(b))); const k = L.shift(); out.push(k); pos = by(k); }
    return out.concat(back);
  }

  /* ---------- timeline ---------- */
  calc(P, B) {
    const cfg = this.st.cfg, J = this._J;
    let hops = 0, roadHops = 0;
    const T = P.teams.map((ids, ti) => {
      let t = this.tstart(ti), pos = this.tbase(P, ti), work = 0, trav = 0, dist = 0;
      const tEnd = this.tend(ti), tLast = this.tlast(ti);
      const E = this.evList(P, ti), kk = { i: 0 };
      const rows = ids.map((k, n) => {
        const j = J.by.get(k), hop = this.travel(pos, j), d = this.km(pos, j), road = this.isRoad(pos, j), sp = this.real(j, E, kk, this.step(E, kk, t, hop, this.dur(j))), arr = sp.arr, end = sp.end, f = [];
        const realHit = sp.hit.filter(x => !x.planned), lunch = sp.hit.find(x => x.planned);
        if (realHit.length) f.push(['warn', 'ETA +' + Math.round(realHit.reduce((a, x) => a + this.evDur(x), 0)) + ' min: ' + realHit.map(x => (x.type === 'break' ? 'break' : 'problem') + ' ' + hm(x.at)).join(', ')]);
        if (lunch) f.push(['info', 'Lunch ' + hm(lunch.at) + '–' + hm(lunch.end) + ' included']);
        const co = this.coOf(j), dv = Math.round(end - sp.proj);
        if (co != null) f.push(['good', 'Checked out ' + hm(co) + (Math.abs(dv) < 1 ? ', as projected' : ', ' + Math.abs(dv) + ' min ' + (dv < 0 ? 'earlier' : 'later') + ' than projected')]);
        else if (dv >= 1) f.push(['warn', 'Still working: ' + dv + ' min past the projected finish. Next ETAs moved.']);
        if (P.ret && P.ret[k]) f.push(['info', 'On the way back to base']);
        hops++; if (road) roadHops++;
        if (arr > tLast) f.push(['bad', 'Starts ' + hm(arr) + ', later than ' + cfg.lastBefore + ' min before shift end (' + hm(tLast) + ')']);
        if (end > tEnd) f.push(['info', 'Finishes ' + hm(end) + ', after the ' + hm(tEnd) + ' shift end']);
        if (n > 0 && hop > cfg.maxHop) f.push(['warn', hop + ' min drive, limit ' + cfg.maxHop]);
        if (j.tier === 'VIP' && this.urgent(j) && ids.slice(0, n).some(x => { const y = J.by.get(x); return !(y.tier === 'VIP' && this.urgent(y)) && !this.locked(y); })) f.push(['warn', 'Urgent VIP: move before the other jobs']);
        if (this.breached(j)) f.push(['warn', 'SLA overdue · booster +' + this.slaBoost(j)]);
        if (this.soon(j)) { const due = this.nowMin() + this.rem(j); if (end > due) f.push(['bad', 'Misses SLA: due ' + hm(due) + ', done ' + hm(end)]); }
        if ((this.st.meta[k] || {}).conf === 'noresp') f.push(['warn', 'No answer yet: consider the end of the route']);
        work += co != null || dv >= 1 ? Math.max(0, end - arr - (co != null ? 0 : sp.dl)) : this.dur(j); trav += hop; dist += d; t = end; pos = j;
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
  // Technician status. Checked out asks for the check-out time (prefilled with now); any change of a check-out time
  // recalculates the whole plan of the branch.
  setStat(P, j, v) {
    const mt = this.meta(j.key), was = this.coOf(j);
    mt.stat = v;
    if (v === 'checkout') { if (mt.co == null || mt.coDay !== this.today()) { mt.co = Math.floor(this.nowMin()); mt.coDay = this.today(); } }
    else { delete mt.co; delete mt.coDay; }
    const msg = j.wo + ': technician status ' + STAT[v] + (v === 'checkout' ? ' at ' + hm(mt.co) : '') + (v !== 'none' ? ' (locked)' : '') + '.';
    if (v === 'checkout' || was != null) return this.reflow(P, msg);
    this.changed(msg);
  }
  teamOf(P, key) { const i = P.teams.findIndex(t => t.includes(key)); return i < 0 ? null : i; }
  setCo(P, j, text) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(text || '').trim()), err = this.ui.coErr || (this.ui.coErr = {});
    if (!m) { err[j.key] = 'Use hh:mm, for example 14:35.'; return this.onChange(); }
    const v = +m[1] * 60 + +m[2], i = this.teamOf(P, j.key), mt = this.meta(j.key);
    if (+m[1] > 23 || +m[2] > 59) { err[j.key] = 'Not a time of day.'; return this.onChange(); }
    if (v > this.nowMin() + 5) { err[j.key] = 'Check-out cannot be later than now (' + hm(this.nowMin()) + ').'; return this.onChange(); }
    if (v < this.tstart(i)) { err[j.key] = 'Check-out cannot be before the shift start (' + hm(this.tstart(i)) + ').'; return this.onChange(); }
    delete err[j.key];
    if (mt.co === v && mt.coDay === this.today()) return this.onChange();
    const old = mt.co;
    mt.co = v; mt.coDay = this.today();
    this.reflow(P, j.wo + ': check-out ' + (old != null ? 'changed from ' + hm(old) + ' to ' : 'set at ') + hm(v) + '.');
  }
  coInput(e, P, j) {
    const mt = this.st.meta[j.key] || {}, err = (this.ui.coErr || {})[j.key], val = mt.co != null && mt.coDay === this.today() ? hm(mt.co) : '';
    const commit = ev => { if (ev.target.value !== val) this.setCo(P, j, ev.target.value); };
    return e('span', { key: 'co', style: { display: 'inline-flex', flexDirection: 'column', gap: 2 } },
      e('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, font: "500 11px 'IBM Plex Sans',system-ui,sans-serif", color: C.muted } }, 'Check-out',
        e('input', { key: 'co-' + val, type: 'text', inputMode: 'numeric', defaultValue: val, placeholder: 'hh:mm', maxLength: 5, 'aria-label': 'Check-out time',
          onMouseDown: ev => ev.stopPropagation(), onBlur: commit, onKeyDown: ev => { if (ev.key === 'Enter') ev.target.blur(); },
          style: { width: 52, padding: '3px 5px', border: '1px solid ' + (err ? C.bad : C.line), borderRadius: 3, font: "600 12px 'IBM Plex Mono',ui-monospace,monospace", color: C.ink, background: C.white } })),
      err ? e('span', { style: { font: "500 10.5px 'IBM Plex Sans',system-ui,sans-serif", color: C.bad } }, err) : null);
  }
  // Recalculate the plan after a check-out (or other real progress): every team's route is checked again against its
  // working day. Plans without manual changes are re-run in full, like the midday rebalance (started and checked-out jobs
  // stay). Plans with manual changes keep each team's order: jobs that no longer fit go to another team or H+1, and teams
  // that finish earlier take more work from H+1 (internal reason) on their own cell, neighbouring cells or as floater.
  reflow(P, msg) {
    const J = this._J, B = this._ctx && this._ctx.B;
    if (!J || !B) return this.changed(msg);
    const where = () => { const m = new Map(); P.teams.forEach((t, i) => t.forEach(k => m.set(k, i))); P.next.forEach(k => m.set(k, 'next')); return m; };
    const before = where();
    let how;
    if (!Object.keys(P.manual || {}).length) { this.autoPlan(P, J, B, true); how = 'full re-plan'; }
    else {
      const drop = [];
      P.teams = P.teams.map((ids, i) => { if (!ids.length) return ids; const r = this.fitRoute(P, i, this.lockFirst(ids)); drop.push(...r.drop); return r.keep; });
      const back = P.next.filter(k => (P.why[k] || 'internal') === 'internal' && !P.manual[k] && J.by.has(k));
      const pool = drop.concat(back.filter(k => !drop.includes(k))).map(k => J.by.get(k)).filter(Boolean).sort(this.cmp);
      const inPool = new Set(pool.map(j => j.key)), left = [];
      P.next = P.next.filter(k => !inPool.has(k));
      pool.forEach(j => { if (!this.place(P, j, B)) left.push(j.key); });
      left.forEach(k => { P.next.push(k); if (!P.why[k]) P.why[k] = 'internal'; });
      P.teams.forEach((t, i) => { if (!t.length) { P.home[i] = null; if (P.role) P.role[i] = null; } });
      how = 'routes rechecked, manual changes kept';
    }
    const after = where(), diff = {};
    const bump = (i, d) => { const n = i === 'next' ? 'H+1' : this.tn(i); diff[n] = (diff[n] || 0) + d; };
    after.forEach((i, k) => { const b = before.get(k); if (b !== i) { bump(i, 1); if (b != null) bump(b, -1); } });
    const ch = Object.entries(diff).filter(([, d]) => d).map(([n, d]) => n + ' ' + (d > 0 ? '+' : '') + d);
    this.changed(msg + ' Plan recalculated (' + how + ')' + (ch.length ? ': ' + ch.join(', ') + '.' : ', no job changed team; ETAs updated.'));
  }
  move(P, key, dest, idx, label) {
    const J = this._J, j = J.by.get(key);
    if (!j || this.locked(j)) return;
    // Remembered until the server has it, so it can be re-applied on top of someone else's simultaneous change.
    if (this.sh && this.sh.on) (this.sh.ops = this.sh.ops || []).push({ plan: this._ctx && this._ctx.name, key, dest, idx, before: this.neighbour(P, key, dest, idx) });
    const from = P.next.includes(key) ? 'H+1' : this.tn(P.teams.findIndex(t => t.includes(key)));
    P.teams = P.teams.map(t => t.filter(k => k !== key));
    P.next = P.next.filter(k => k !== key);
    const list = dest === 'next' ? P.next : P.teams[dest];
    list.splice(Math.max(0, Math.min(idx == null ? list.length : idx, list.length)), 0, key);
    if (dest !== 'next' && !P.home[dest]) { P.home[dest] = j.cell.key; P.tb[dest] = this.hubOf(dest); }
    P.teams.forEach((t, i) => { if (!t.length) P.home[i] = null; });
    if (dest === 'next') { if (!P.why[key]) P.why[key] = (this.meta(key).conf === 'resched') ? 'customer' : 'internal'; }
    else delete P.why[key];
    P.manual[key] = true;
    const to = dest === 'next' ? 'H+1' : this.tn(dest);
    this.changed(label || (j.wo + ' (' + (j.uid || j.cid) + ') ' + (from === to ? 'moved to position ' + (list.indexOf(key) + 1) + ' in ' + to : 'moved from ' + from + ' to ' + to) + (dest === 'next' ? ', reason ' + P.why[key] : '') + '.'));
  }
  // The job that will follow a moved job, so the move can be re-applied at the same spot in a changed route.
  neighbour(P, key, dest, idx) {
    const list = (dest === 'next' ? P.next : P.teams[dest] || []).filter(k => k !== key);
    const i = Math.max(0, Math.min(idx == null ? list.length : idx, list.length));
    return list[i] || null;
  }
  // Position right after the started (locked) jobs at the front of a team's route: the team's next stop.
  nextSlot(P, t, key) {
    const ids = (P.teams[t] || []).filter(k => k !== key);
    let n = 0; while (n < ids.length && (j => !!j && this.locked(j))(this._J.by.get(ids[n]))) n++;
    return n;
  }
  replan() {
    if (this.behind) return;
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
    const note = (title, text, tone) => ({ kpis: [], cards: [host.card(title, { span: 12, body: e('p', { style: { margin: 0, font: "400 13px/1.6 'IBM Plex Sans',system-ui,sans-serif", color: tone || C.text } }, text) })] });
    // Wait for the shared plan before showing (or changing) anything, so this screen never starts from an old plan.
    if (this.api && !this.sh.ready) { this.shPoll(true); return note('Shared plan', 'Loading the shared ' + this.type + ' plan…', C.muted); }
    // Work orders could not be read from the CSV files: show nothing rather than plan from partial data, which would
    // remove work orders from the shared plan for everyone.
    if (ctx.dataProblem) return note('Work orders not loaded', 'The work-order files could not be read on this screen, so the board is hidden to keep the shared plan safe. ' + ctx.dataProblem + ' Reload the page; if this stays, ask the dashboard admin.', C.bad || '#9B2C1F');
    const P = this.plan(m, bi, J, B);
    this._ctx.P = P;
    if (this.behind) {
      if (host.idsBehind) host.idsBehind();
      return note('Shared plan', 'Someone updated the plan with newer work orders than this screen has loaded. Loading the latest data, then the board appears…', C.muted);
    }
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
    const CX = this.clusterInfo(B), avail = this.dayMin(), flNeed = Math.ceil(CX.sparse.reduce((a, j) => a + this.dur(j), 0) / avail);
    const needAll = CX.list.reduce((a, c) => a + c.need, 0) + flNeed, hot = G.filter(g => g.jobs.length >= 8).length;
    const soonN = J.list.filter(j => this.soon(j)).length, brN = J.list.filter(j => this.breached(j)).length;
    const breaches = T.reduce((a, t) => a + t.rows.reduce((b, r) => b + r.f.filter(f => f[0] === 'bad').length, 0), 0);
    const kpis = [
      { label: 'Open ' + this.type + ' jobs', value: fmtN(J.list.length), sub: (m.branches[bi] || '') + ' · last ' + cfg.maxAge + ' days' },
      { label: 'Grid cells with work', value: fmtN(G.length), sub: hot + ' red or dark red (8+ WO)' },
      { label: 'Teams needed', value: fmtN(needAll), sub: CX.list.length + ' busy cells (>' + cfg.gridMin + ' WO) + ' + flNeed + ' floater · ' + cfg.teams + ' available' + (needAll > cfg.teams ? ' · short by ' + (needAll - cfg.teams) : '') },
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
        btn('td', 'Tidy all routes', () => { P.teams = P.teams.map((ids, i) => ids.length ? this.tidy(ids, this.tbase(P, i), P.ret) : ids); this.changed('All routes put in order: started jobs, urgent VIP, then highest score first (ties: nearest stop), non-urgent VIP after the existing work.'); }),
        btn('st', this.ui.settings ? (this.limited ? 'Hide teams & crew ▴' : 'Hide settings ▴') : (this.limited ? 'Teams & crew ▾' : 'Settings ▾'), () => { this.ui.settings = !this.ui.settings; if (this.ui.settings) this.ui.draft = JSON.parse(JSON.stringify(cfg)); this.onChange(); }, false, this.ui.settings ? { borderColor: C.ink, background: C.bg } : null),
      ]),
      ...(() => {
        const st = this.syncText(), msg = this.sh.msg && Date.now() - this.sh.msg.at < 120000 ? this.sh.msg : null;
        if (!st && !msg) return [];
        const tone = { good: C.good, bad: C.bad, warn: C.warn, muted: C.muted };
        return [row('Shared', [
          st ? e('span', { key: 'sy', style: { display: 'flex', alignItems: 'center', gap: 6, font: SANS, color: tone[st[0]] } }, st[0] === 'good' ? e('span', { style: { width: 7, height: 7, borderRadius: '50%', background: C.good, flex: 'none' } }) : null, st[1]) : null,
          msg ? e('span', { key: 'cf', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', border: '1px solid ' + C.warnLine, borderRadius: 3, background: C.warnBg, font: SANS, color: C.warn } }, msg.text,
            e('button', { type: 'button', onClick: () => { this.sh.msg = null; this.onChange(); }, style: { border: 'none', background: 'none', color: C.warn, cursor: 'pointer', font: MONO } }, '×')) : null,
        ], 'sync')];
      })(),
      ctx.trackLine ? row('Technicians', [e('span', { key: 'tk', style: { display: 'flex', alignItems: 'center', gap: 6, font: SANS, color: { good: C.good, warn: C.warn, bad: C.bad, muted: C.muted }[ctx.trackLine[0]] } },
        ctx.trackLine[0] === 'good' ? e('span', { style: { width: 7, height: 7, borderRadius: '50%', background: C.good, flex: 'none' } }) : null, ctx.trackLine[1])], 'trk') : null,
      row('Road', [e('span', { key: 'rs', style: { font: SANS, color: rd.err && !rd.m.size && cfg.roadOn ? C.bad : busy ? C.warn : C.muted } }, roadTxt + (P.prov ? ' · plan is provisional until road times load' : ''))]),
      this.ui.settings ? this.settings(e, row, chip, btn) : null,
      row('WO per cell', BANDS.map((b, n) => e('span', { key: 'b' + n, style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text } },
        e('span', { style: { width: 14, height: 10, background: b.color, opacity: 0.75, border: '1px solid ' + b.color } }), b.label)), 'bands'),
      row('Show on map', [
        ...T.map((t, n) => t.ids.length ? e('label', { key: 'lg' + n, title: 'Show or hide ' + this.tn(n) + ': route, jobs and live technician', style: { display: 'flex', alignItems: 'center', gap: 5, padding: '2px 7px', border: '1px solid ' + (this.ui.hidden.has(n) ? C.line : C.ink), borderRadius: 3, background: this.ui.hidden.has(n) ? C.bg : C.white, font: SANS, color: this.ui.hidden.has(n) ? '#8A8A85' : C.text, cursor: 'pointer' } },
          e('input', { type: 'checkbox', checked: !this.ui.hidden.has(n), onChange: () => this.toggleTeam(n), 'aria-label': 'Show ' + this.tn(n), style: { margin: 0, accentColor: col(n) } }), sw(col(n)), this.tn(n), e('span', { style: { font: MONO, color: C.muted } }, String(t.ids.length))) : null),
        btn('va', 'All', () => { this.ui.hidden.clear(); this.saveHidden(); }),
        btn('vn', 'None', () => { T.forEach((t, n) => this.ui.hidden.add(n)); this.saveHidden(); }),
        e('label', { key: 'vh', style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text, cursor: 'pointer' } },
          e('input', { type: 'checkbox', checked: !this.ui.hideNext, onChange: () => { this.ui.hideNext = !this.ui.hideNext; this.saveHidden(); }, style: { margin: 0 } }), 'H+1'),
        e('label', { key: 'vt', style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.text, cursor: 'pointer' } },
          e('input', { type: 'checkbox', checked: !this.ui.hideTech, onChange: () => { this.ui.hideTech = !this.ui.hideTech; this.saveHidden(); }, style: { margin: 0 } }), 'Live technicians'),
      ], 'vis'),
      row('Legend', [
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
        note: 'Jobs: the latest ' + this.type + ' work order per CID by timestamp, kept only while that order is open' + (cfg.prog ? ' or in progress' : '') + ', dated within the last ' + cfg.maxAge + ' days, on ' + (cfg.blocked ? 'Active and Blocked' : 'Active') + ' accounts' + (J.skipped.old ? ' (' + fmtN(J.skipped.old) + ' older open orders left out)' : '') + '. Job score = ticket priority (' + tierTxt + ') + job type + aging (' + AGING + ' per day carried over for an internal reason) + SLA overdue booster (+' + cfg.slaB0 + ' once breached, +' + cfg.slaBd + ' per working day past it). Cell colour and rank = number of open WO in the cell (density); VIP does not change the colour. Inside each team route the highest score goes first; urgent VIP (Wiredown, Power) at the front, non-urgent VIP after the existing work. Hover a cell for its numbers.' + (J.skipped.unknown ? ' ' + fmtN(J.skipped.unknown) + ' job' + (J.skipped.unknown > 1 ? 's have' : ' has') + ' an unrecognised category and count as Low/Unknown.' : '') + (J.skipped.noPrio ? ' ' + fmtN(J.skipped.noPrio) + ' job' + (J.skipped.noPrio > 1 ? 's have' : ' has') + ' no readable priority and count as Normal.' : ''),
      }),
      host.card('Priority by grid cell', {
        span: 12, meta: 'densest first (most WO) · ' + (this.ui.cellsAll || G.length <= 25 ? G.length : '25 of ' + G.length) + ' cells',
        body: this.cellTable(e, P, host, col, G),
        note: 'A busy cell holds more than ' + cfg.gridMin + ' open WO, or an urgent VIP (Wiredown, Power), and gets its own anchor team. Busy cells are staffed in order of the total score of their jobs, then topped up to Teams needed = the fewest teams that fit every job of the cell between ' + hm(cfg.start) + ' and ' + hm(cfg.end) + ' after lunch. ' + (cfg.floatPct ? cfg.floatPct + '% of the teams are kept as floaters for isolated jobs. ' : '') + 'Anchor teams with hours left take jobs from the 8 neighbouring cells only, highest score first; floaters take what is left anywhere, highest score first, and every team with hours left picks up WO on the way back to base (at most ' + cfg.homeDetour + ' min extra per stop). A WO may start up to ' + cfg.lastBefore + ' min before the team\u2019s own shift end and may finish after it. SLA ' + cfg.sla + ' h, VIP ' + cfg.slaVip + ' h, counted from WO Created inside ' + hm(cfg.start) + '–' + hm(cfg.end) + ' and paused while the customer asks to reschedule; overdue jobs get the booster. ' + (cfg.rebOn ? 'The plan is re-run once at ' + hm(cfg.rebAt) + ' unless it has manual changes. ' : '') + 'Remaining jobs go to H+1.',
      }),
      host.card('Dispatch board', {
        span: 12, meta: sched + ' scheduled · ' + P.next.length + ' deferred · ' + Object.keys(P.manual).length + ' manual changes',
        body: this.board(e, P, T, B, pill, col),
        note: 'Click a team name to rename it. Within a route: started jobs, urgent VIP, then highest score first (equal scores: nearest stop), non-urgent VIP, then customers who did not answer. A planned lunch of ' + cfg.lunchMin + ' min, ' + dh(cfg.lunchAt - cfg.start) + ' after each team\u2019s shift start, is included in every ETA. Setting a job to No answer moves it to the end of its team; Confirmed moves it back ahead of the unanswered jobs. Drag a card to reorder a route at any time. Drag a card to reorder a route, move it to another team or defer it to H+1; on touch screens use the arrows and the Move to list. Jobs on the way, checked in, checked out or In Progress in the data are locked. When a job is set to Checked out, type the real check-out time (hh:mm): the finish, the ETAs after it and the team\u2019s working time use the real time, and the plan is recalculated at once (jobs that no longer fit move to another team or H+1; a team that finishes early takes more work). A job checked in or on the way that runs past its projected finish pushes the next ETAs back automatically. Drive times marked "est." are straight-line estimates. The plan is shared: every screen that opens IDS shows the same board, and changes appear on the others within about 10 seconds.',
      }),
      host.card('Dispatcher change log', { span: 12, meta: this.type + ' · latest first', body: this.logView(e) }),
    ];
    // Dispatchers (non-admin): the map and the dispatch board only; team setup opens from the map controls.
    if (this.limited) return { kpis: [], cards: [cards[0], cards[2]] };
    return { kpis, cards };
  }

  board(e, P, T, B, pill, col) {
    const J = this._J, cols = [];
    T.forEach((t, n) => {
      const span = Math.max(60, this.tend(n) - this.tstart(n));
      const home = P.home[n] ? this.M.cellLabel(P.home[n]) : null;
      const est = t.rows.filter(r => !r.road).length;
      cols.push(this.column(e, n, this.nameInput(e, n), col(n), [this.baseRow(e, P, n, home), this.evRow(e, P, n)].concat(t.ids.length ? [
        e('div', { key: 'bar', style: { display: 'flex', height: 6, borderRadius: 2, overflow: 'hidden', background: C.soft }, title: 'Dark = on-site work, yellow = travel' },
          e('div', { style: { width: Math.min(100, t.work / span * 100) + '%', background: C.ink } }),
          e('div', { style: { width: Math.max(0, Math.min(100 - t.work / span * 100, t.trav / span * 100)) + '%', background: C.acc } })),
        e('div', { key: 'mt', style: { display: 'flex', flexWrap: 'wrap', gap: '2px 10px', font: MONO, color: C.muted } },
          e('span', null, nf1(t.work / 60) + ' h work'), e('span', null, t.trav + ' min · ' + nf1(t.dist) + ' km' + (est ? ' (' + est + ' est.)' : '')), e('span', { style: { color: t.finish > this.tend(n) ? C.warn : C.muted } }, 'done ' + hm(t.finish) + (t.finish > this.tend(n) ? ' (after shift end ' + hm(this.tend(n)) + ')' : ''))),
        e('div', { key: 'cl', style: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' } },
          e('button', { key: 'tidy', type: 'button', onClick: () => { P.teams[n] = this.tidy(P.teams[n], this.tbase(P, n)); this.changed(this.tn(n) + ' route tidied.'); }, style: { marginLeft: 'auto', padding: 0, border: 'none', background: 'none', color: C.ink, textDecoration: 'underline', textUnderlineOffset: 2, font: SANS, cursor: 'pointer' } }, 'Tidy route')),
      ] : [e('span', { key: 'idle', style: { font: SANS, color: C.muted } }, 'Standby')]),
      pill(t.ids.length ? t.ids.length + ' jobs' : 'Idle', t.ids.length ? 'good' : null),
      t.rows.map((r, i) => this.cardEl(e, P, r.j, r, n, i, pill)), P));
    });
    // H+1 sits first and stays in view while the board scrolls, so a deferred job can be dragged into any team.
    const q = String(this.ui.nextQ || '').trim().toLowerCase();
    const hit = k => { if (!q) return true; const j = J.by.get(k); return !!j && [j.wo, j.cid, j.uid, j.name, j.area, j.prob, j.cat, j.tier].some(v => String(v || '').toLowerCase().includes(q)); };
    const found = P.next.filter(hit), shown = this.ui.nextAll || q ? found : found.slice(0, 60);
    const search = e('input', { key: 'nq', type: 'search', value: this.ui.nextQ || '', placeholder: 'Find WO, CID, UID, name…', 'aria-label': 'Find a deferred job',
      onChange: ev => { this.ui.nextQ = ev.target.value; this.onChange(); },
      style: { width: '100%', boxSizing: 'border-box', padding: '5px 8px', border: '1px solid ' + C.warnLine, borderRadius: 3, background: C.white, color: C.ink, font: SANS, outline: 'none' } });
    const nextCol = this.column(e, 'next', 'Defer to H+1', '#D9480F', [
        e('span', { key: 'nx', style: { font: SANS, color: C.warn } }, 'Internal reasons add aging +' + AGING + ' tomorrow. Customer requests do not.'),
        e('span', { key: 'nx2', style: { font: SANS, color: C.muted } }, 'Drag a card into any team, or use Move to.'),
        search],
      pill((q ? found.length + ' of ' : '') + P.next.length + ' jobs', 'warn'),
      shown.map(k => this.cardEl(e, P, J.by.get(k), null, 'next', P.next.indexOf(k), pill)).concat(!q && P.next.length > shown.length ? [e('button', { key: 'more', type: 'button', onClick: () => { this.ui.nextAll = true; this.onChange(); }, style: { padding: '6px', border: '1px dashed ' + C.warnLine, borderRadius: 3, background: 'transparent', font: SANS, color: C.warn, cursor: 'pointer' } }, 'Show all ' + P.next.length)] : []), P, true);
    const edge = ev => {
      if (!this.ui.drag) return;
      const el = ev.currentTarget, r = el.getBoundingClientRect(), x = ev.clientX;
      if (x > r.right - 80) el.scrollLeft += 28;
      else if (x < r.left + 288 + 60 && el.scrollLeft > 0) el.scrollLeft -= 28;
    };
    return e('div', { onDragOverCapture: edge, style: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, alignItems: 'flex-start' } }, nextCol, ...cols);
  }

  baseRow(e, P, n, home) {
    const BS = this._BS || [], cur = this.crew(n).base || 0;
    return e('div', { key: 'hb', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, font: MONO, color: C.muted } },
      home ? e('span', { style: { color: (P.role || [])[n] === 'floater' ? C.warn : C.ink } }, ((P.role || [])[n] === 'floater' ? 'Floater · from ' : 'Anchor · ') + home) : null,
      BS.length > 1 ? e('select', { value: cur, 'aria-label': 'Start base', onChange: ev => { this.setCrew(n, { base: +ev.target.value }); this.changed(this.tn(n) + ' now departs from and returns to ' + BS[+ev.target.value].name + '. Press Re-plan to reassign its work.'); },
        style: { padding: '2px 5px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: SANS, fontSize: 11.5, maxWidth: 170 } },
        ...BS.map((b, i) => e('option', { key: i, value: i }, 'From ' + b.name + (i === 0 ? ' (default)' : ''))))
        : e('span', null, 'From ' + (BS[0] ? BS[0].name : 'base')),
      e('span', null, '· shift ' + hm(this.tstart(n)) + '–' + hm(this.tend(n))));
  }
  evRow(e, P, n) {
    const L = this.evList(P, n), br = this.activeEv(P, n, 'break'), pr = this.activeEv(P, n, 'problem');
    const b = (k, label, on, fn) => e('button', { key: k, type: 'button', onClick: fn, style: { padding: '2px 8px', border: '1px solid ' + (on ? C.bad : C.line), borderRadius: 3, background: on ? C.badBg : C.white, color: on ? C.bad : C.ink, font: SANS, fontSize: 11.5, cursor: 'pointer' } }, label);
    return e('div', { key: 'ev', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
        b('br', br ? 'End break' : 'Break', !!br, () => br ? this.endEv(P, n, 'break') : this.startEv(P, n, 'break')),
        b('pr', pr ? 'Problem solved' : 'Problem', !!pr, () => pr ? this.endEv(P, n, 'problem') : this.startEv(P, n, 'problem'))),
      ...L.map((x, k) => e('span', { key: 'e' + k, style: { font: "500 10.5px 'IBM Plex Mono',ui-monospace,monospace", color: x.end == null ? C.bad : C.muted } },
        x.planned ? 'Lunch ' + hm(x.at) + '–' + hm(x.end) + ' · ' + Math.round(this.evDur(x)) + ' min · planned'
          : (x.type === 'break' ? 'Break ' : 'Problem ') + hm(x.at) + '–' + (x.end != null ? hm(x.end) : 'now') + ' · ' + Math.round(this.evDur(x)) + ' min' + (x.end == null && this.evDur(x) <= (x.est || 0) ? ' (est.)' : '') + ' · ' + (x.src || 'dispatcher'))));
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
    return e('div', { key: 'col' + id, style: { flex: '0 0 288px', display: 'flex', flexDirection: 'column', background: warn ? C.warnBg : C.paper, border: '1px solid ' + (active ? C.ink : warn ? C.warnLine : C.line), borderRadius: 3, ...(warn ? { position: 'sticky', left: 0, zIndex: 3, boxShadow: '6px 0 10px -6px rgba(0,0,0,0.18)', maxHeight: 900, overflowY: 'auto' } : {}) } },
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
    const moveOpts = { '': 'Move to…' }; for (let n = 0; n < nT; n++) { const at = P.home[n] ? ' · ' + this.M.cellLabel(P.home[n]) : ''; moveOpts[n + ':next'] = this.tn(n) + at + ' · next stop'; moveOpts[n + ':last'] = this.tn(n) + at + ' · last stop'; } if (colId !== 'next') moveOpts.next = 'Defer H+1';
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
            e('span', { style: { font: MONO, color: this.coOf(j) != null ? C.good : C.muted } }, ' → ' + hm(r.end) + (this.coOf(j) != null ? ' ✓' : '')),
            e('div', { style: { font: "400 10.5px 'IBM Plex Mono',ui-monospace,monospace", color: C.muted } }, day(0) + (this.coOf(j) != null ? ' · actual finish' : ' · ETA'))),
          e('div', { style: { font: MONO, color: r.road ? C.muted : C.warn, textAlign: 'right' }, title: r.road ? 'Road drive time' : 'Straight-line estimate' }, (r.road ? '+' : '~') + r.hop + ' min' + (r.road ? '' : ' est.'), e('br'), nf1(r.d) + ' km'))
          : e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
            sel('why', P.why[j.key] || 'internal', { internal: 'Internal · aging +' + AGING, customer: 'Customer request · no aging' }, ev => { P.why[j.key] = ev.target.value; this.changed(j.wo + ': deferral reason set to ' + ev.target.value + '.'); }, 'Deferral reason'),
            e('span', { style: { font: "400 10.5px 'IBM Plex Mono',ui-monospace,monospace", color: C.muted } }, day(1))),
        r && r.f.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, ...r.f.map((f, n) => e('span', { key: n, style: { font: "600 11px 'IBM Plex Sans',system-ui,sans-serif", color: f[0] === 'bad' ? C.bad : f[0] === 'info' ? C.muted : f[0] === 'good' ? C.good : C.warn } }, f[1]))) : null,
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' } },
          sel('conf', mt.conf || 'none', CONF, ev => this.setConf(P, j, ev.target.value), 'Customer confirmation'),
          sel('stat', mt.stat || 'none', STAT, ev => this.setStat(P, j, ev.target.value), 'Technician status'),
          mt.stat === 'checkout' ? this.coInput(e, P, j) : null,
          lk ? null : mini('up', '↑', () => this.nudge(P, j.key, colId, -1), 'Move up'),
          lk ? null : mini('dn', '↓', () => this.nudge(P, j.key, colId, 1), 'Move down'),
          lk ? null : sel('mv', '', moveOpts, ev => { const v = ev.target.value; if (v === '') return; if (v === 'next') return this.move(P, j.key, 'next', null); const [t, w] = v.split(':'); this.move(P, j.key, +t, w === 'next' ? this.nextSlot(P, +t, j.key) : null); }, 'Move to'),
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
      g.ctr ? e('span', { style: { color: C.ink, fontWeight: 600, whiteSpace: 'nowrap' } }, 'Busy · own team')
        : e('span', { style: { color: C.warn, whiteSpace: 'nowrap' } }, 'Neighbour / floater'),
      g.ctr ? e('span', { style: { font: "600 13px 'IBM Plex Mono',ui-monospace,monospace", color: C.ink } }, String(g.need) + (g.left ? ' +' : '')) : '—',
      g.ctr ? e('span', { style: { whiteSpace: 'nowrap', color: g.finish > cfg.end ? C.bad : C.text } }, dh(g.finish - cfg.start) + ' · done ' + hm(g.finish)) : '—',
      g.tms.length ? e('span', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } }, ...g.tms.map(n => e('span', { key: n, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, e('span', { style: { width: 8, height: 8, borderRadius: 2, background: col(n) } }), this.tn(n))))
        : e('span', { style: { color: C.bad, fontWeight: 600 } }, 'none'),
      g.nx ? e('span', { style: { color: C.warn, fontWeight: 600 } }, String(g.nx)) : '0',
    ]);
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      host.table(['#', 'Cell', 'Area', 'WO', 'VIP', 'Work', 'Cell type', 'Teams needed', 'Est. duration', 'Assigned', 'H+1'], rows, { minWidth: 1000, maxHeight: 520 }),
      G.length > 25 ? e('button', { type: 'button', onClick: () => { this.ui.cellsAll = !this.ui.cellsAll; this.onChange(); }, style: { alignSelf: 'flex-start', padding: '5px 11px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: SANS, cursor: 'pointer' } }, this.ui.cellsAll ? 'Show top 25' : 'Show all ' + G.length + ' cells') : null);
  }
  logView(e) {
    const L = this.st.log;
    if (!L.length) return e('div', { style: { font: SANS, color: C.muted } }, 'No changes yet.');
    return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' } },
      ...L.slice(0, 80).map((l, n) => e('div', { key: n, style: { display: 'grid', gridTemplateColumns: '92px minmax(0,1fr)', gap: 8, font: "400 12.5px/1.5 'IBM Plex Sans',system-ui,sans-serif", color: C.text, paddingBottom: 6, borderBottom: '1px solid ' + C.soft } },
        e('span', { style: { font: "400 11px 'IBM Plex Mono',ui-monospace,monospace", color: C.muted } }, l.t), e('span', null, l.by ? e('strong', { style: { fontWeight: 600, color: C.ink } }, l.by + ': ') : null, l.msg))));
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
    const crewRows = Array.from({ length: Math.max(1, Math.round(+d.teams || 1)) }, (_, n) => {
        const cr = (d.crew || [])[n] || {}, upd = p => { const a = (d.crew || []).slice(); a[n] = { ...(a[n] || {}), ...p }; d.crew = a; this.onChange(); };
        const st = isFinite(cr.start) && cr.start !== '' ? +cr.start : d.start;
        const nm = (d.names || [])[n] || '';
        return row(n ? '' : 'Crew', [
          e('input', { key: 'cn', type: 'text', value: nm, placeholder: 'Team ' + (n + 1), 'aria-label': 'Team ' + (n + 1) + ' name', maxLength: 40,
            onChange: ev => { const a = (d.names || []).slice(); a[n] = ev.target.value; d.names = a; this.onChange(); },
            style: { ...tx, width: 170, font: "600 12px 'IBM Plex Sans',system-ui,sans-serif" } }),
          e('select', { key: 'cb', value: cr.base || 0, onChange: ev => upd({ base: +ev.target.value }), style: { padding: '4px 6px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: SANS, maxWidth: 260 } },
            ...bl.map((b, k) => e('option', { key: k, value: k }, 'From ' + (b.name || 'Hub ' + (k + 1)) + (k === 0 ? ' (default)' : '')))),
          lab('Shift start', 'cs' + n),
          e('input', { key: 'ct', type: 'time', value: hm(st), onChange: ev => { const [a, b] = String(ev.target.value).split(':').map(Number); if (isFinite(a) && isFinite(b)) upd({ start: a * 60 + b }); }, style: { padding: '4px 6px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO } }),
          lab('end', 'ce' + n),
          e('input', { key: 'cte', type: 'time', value: hm(isFinite(cr.end) && cr.end !== '' && cr.end !== null ? +cr.end : st + (d.end - d.start)), onChange: ev => { const [a, b] = String(ev.target.value).split(':').map(Number); if (isFinite(a) && isFinite(b)) upd({ end: a * 60 + b }); }, style: { padding: '4px 6px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO } }),
          lab('App ID', 'ca' + n),
          e('input', { key: 'cap', type: 'text', defaultValue: cr.app || '', placeholder: 'technician app / device ID', onBlur: ev => upd({ app: ev.target.value.trim() }), style: { ...tx, width: 190 } }),
        ], 'crew' + n);
      });
    const actions = row('', [btn('ap', 'Apply and re-plan', () => this.apply(), true), btn('cx', 'Cancel', () => { this.ui.settings = false; this.ui.draft = null; this.onChange(); }),
      this.limited ? null : btn('rs', 'Reset defaults', () => { const keep = { bases: d.bases, branch: d.branch, names: d.names, crew: d.crew }; this.ui.draft = { ...JSON.parse(JSON.stringify(DEF)), ...keep }; this.onChange(); })], 'act');
    const box = { key: 'set', style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid ' + C.line, borderRadius: 3, background: C.paper } };
    // Dispatchers: the number of available teams and the crew (names, hub, shift, app ID) only.
    if (this.limited) return e('div', box,
      row('Teams', [lab('Available', 'l3'), num('teams', 56), lab('teams today. Name each team, its hub and shift below.', 'l3b')]),
      ...crewRows, actions);
    return e('div', box,
      row('Scope', [lab('Open orders from the last', 'l1'), num('maxAge', 60), lab('days', 'l2'),
        chip('sb', d.blocked, 'Include Blocked accounts', null, null, () => set('blocked', !d.blocked)),
        chip('sp', d.prog, 'Include In Progress orders', null, null, () => set('prog', !d.prog))]),
      row('Teams', [lab('Available', 'l3'), num('teams', 56), lab('Cell size', 'l5'),
        ...[1, 2, 3, 5].map(v => chip('gk' + v, d.gridKm === v, v + ' km', null, null, () => set('gridKm', v)))]),
      ...crewRows,
      row('Lunch', [lab('Planned lunch from', 'lu1'), time('lunchAt'), lab('for', 'lu2'), num('lunchMin', 56, 5), lab('min in the default shift; other shifts take it the same time after their start (0 = none). Replaced by the real break once the technician app reports one.', 'lu3')]),
      row('Breaks', [lab('Break estimate', 'be'), num('breakEst', 56, 5), lab('min · Problem estimate', 'pe'), num('probEst', 56, 5),
        lab('min. Used until the technician app sends the end; after that the real duration counts.', 'bx')]),
      row('Road', [chip('ro', d.roadOn, 'Road drive times (OSRM)', null, null, () => set('roadOn', !d.roadOn)),
        e('input', { key: 'osrm', type: 'text', value: d.osrm, onChange: ev => set('osrm', ev.target.value), placeholder: 'https://router.project-osrm.org',
          style: { width: 260, padding: '5px 8px', border: '1px solid ' + C.line, borderRadius: 3, background: C.white, color: C.ink, font: MONO } }),
        lab('Car route times are free-flow; traffic is added by zone below.', 'l6')]),
      row('Traffic', [lab('Tourist centre ×', 'z1'), num('zTour', 60, 0.05), lab('within', 'z1b'), num('tR', 52, 0.5), lab('km · Dense ×', 'z2'), num('zDense', 60, 0.05),
        lab('· Medium ×', 'z3'), num('zMid', 60, 0.05), lab('· Open land ×', 'z4'), num('zOpen', 60, 0.05),
        lab('Dense / medium / open from customer density per cell. Assumed; calibrate with Traccar drive times.', 'z5')]),
      row('Fallback', [lab('If no road time: straight line ×', 'l7'), num('road', 60, 0.05), lab('at', 'l7b'), num('speed', 56), lab('km/h by car, before traffic', 'l7c')]),
      row('Reach', [lab('New jobs during the day join a team within', 'l8'), num('ring', 48), lab('cells and', 'l9'), num('maxHop', 56), lab('min', 'l10'),
        lab('· Anchor teams with hours left take jobs within', 'l11'), num('ring2', 48), lab('cells (1 = the 8 neighbours) · a floater drives at most', 'l12'), num('hop2', 56), lab('min between jobs', 'l13')]),
      row('Way back', [lab('Every team with hours left picks up WO on the way back to its base, at most', 'wb1'), num('homeDetour', 56, 5), lab('min extra drive per stop, highest score first', 'wb2')]),
      row('Anchor', [lab('A cell with more than', 'an1'), num('gridMin', 48), lab('WO, or an urgent VIP, gets its own team (highest total score first) ·', 'an2'), num('floatPct', 52, 5), lab('% of teams kept as floaters for isolated WO', 'an3')]),
      row('SLA', [lab('Normal', 's1'), num('sla', 56), lab('h · VIP', 's2'), num('slaVip', 56), lab('working h from WO Created (paused on reschedule) · near breach at', 's3'), num('nearH', 56, 0.5), lab('h or less left', 's4')]),
      row('Overdue', [lab('SLA booster +', 'ob1'), num('slaB0', 64, 50), lab('once breached, then +', 'ob2'), num('slaBd', 64, 50), lab('per working day past the SLA (added to the job score)', 'ob3')]),
      row('Rebalance', [chip('rb', d.rebOn, 'Re-plan once at', null, null, () => set('rebOn', !d.rebOn)), time('rebAt'), lab('skipped when the plan has manual changes', 'rb2')]),
      row('Hours', [lab('Default shift', 'l14'), time('start'), lab('to', 'l16'), time('end'),
        lab('· a WO may start up to', 'l15'), num('lastBefore', 56, 15), lab('min before the team\u2019s own shift end and may finish after it. Each team\u2019s shift is set under Crew.', 'l17')]),
      row('Duration', Object.keys(CATS).map(k => e('span', { key: 'd' + k, style: { display: 'flex', alignItems: 'center', gap: 5, font: SANS, color: C.muted } }, k, num(k, 60, 5, d.dur, 'dur' + k), 'min',
        e('span', { style: { font: "600 9.5px 'IBM Plex Mono',ui-monospace,monospace", letterSpacing: '0.08em', textTransform: 'uppercase', color: CATS[k].src === 'assumed' ? C.warn : C.good } }, CATS[k].src)))),
      ...bl.map((b, n) => row(n ? '' : 'Hubs', [
        e('input', { key: 'bn' + n + '|' + bl.length, type: 'text', defaultValue: b.name, placeholder: 'Base name', onBlur: ev => { bl[n] = { ...bl[n], name: ev.target.value.trim() || 'Base ' + (n + 1) }; setB(); }, style: { ...tx, width: 170, font: SANS } }),
        e('input', { key: 'bl' + n + '|' + bl.length, type: 'text', defaultValue: (+b.lat).toFixed(5) + ', ' + (+b.lng).toFixed(5), placeholder: 'lat, lng',
          onBlur: ev => { const p = String(ev.target.value).split(/[,;\s]+/).filter(Boolean).map(Number); if (p.length >= 2 && isFinite(p[0]) && isFinite(p[1])) { bl[n] = { ...bl[n], lat: p[0], lng: p[1] }; setB(); } }, style: { ...tx, width: 200 } }),
        n === 0 ? lab('default hub', 'bd' + n) : btn('rm' + n, 'Remove', () => {
          bl.splice(n, 1);
          d.crew = (d.crew || []).map(x => !x || x.base == null || x.base === '' ? x : +x.base === n ? { ...x, base: 0 } : +x.base > n ? { ...x, base: +x.base - 1 } : x);
          setB();
        }),
      ], 'base' + n)),
      row('', [btn('ab', '+ Add hub', () => { const l = bl[bl.length - 1] || { lat: -8.67, lng: 115.17 }; bl.push({ name: 'Hub ' + (bl.length + 1), lat: l.lat, lng: l.lng }); setB(); }),
        lab('Every team departs from and returns to the first (default) hub unless another hub is assigned to it under Crew or on the board. Way-back pick-ups head to the team\u2019s own hub. Removing a hub moves its teams back to the default hub. Paste coordinates from Google Maps as "lat, lng".', 'bh')], 'addb'),
      actions);
  }
  apply() {
    const d = this.ui.draft; if (!d) return;
    const clean = (v, lo, hi, def) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    const c = this.st.cfg, osrm = String(d.osrm || DEF.osrm).trim().replace(/\/+$/, '');
    if (osrm !== c.osrm) { this.road = new Road(fin => this.roadTick(fin)); this._tq.clear(); this._rq.clear(); }
    Object.assign(c, {
      teams: Math.round(clean(d.teams, 1, 60, DEF.teams)), gridKm: d.gridKm,
      speed: clean(d.speed, 5, 80, DEF.speed), road: clean(d.road, 1, 2.5, DEF.road), roadOn: !!d.roadOn, osrm,
      zTour: clean(d.zTour, 1, 4, DEF.zTour), zDense: clean(d.zDense, 1, 4, DEF.zDense), zMid: clean(d.zMid, 1, 4, DEF.zMid), zOpen: clean(d.zOpen, 1, 4, DEF.zOpen), tR: clean(d.tR, 0.5, 10, DEF.tR),
      maxHop: clean(d.maxHop, 5, 180, DEF.maxHop), ring: Math.round(clean(d.ring, 0, 5, DEF.ring)), ring2: Math.round(clean(d.ring2, 0, 8, DEF.ring2)), hop2: clean(d.hop2, 5, 240, DEF.hop2), homeDetour: clean(d.homeDetour, 0, 120, DEF.homeDetour),
      start: d.start, end: Math.max(d.start + 60, d.end), lastBefore: clean(d.lastBefore, 0, 480, DEF.lastBefore), maxAge: Math.round(clean(d.maxAge, 0, 3650, DEF.maxAge)),
      blocked: !!d.blocked, prog: !!d.prog, bases: { ...d.bases }, names: (d.names || c.names || []).map(x => String(x == null ? '' : x).trim().slice(0, 40)),
      crew: (d.crew || []).map(x => x ? { base: Math.max(0, Math.round(+x.base || 0)), start: isFinite(x.start) && x.start !== '' ? +x.start : undefined, end: isFinite(x.end) && x.end !== '' && x.end !== null ? +x.end : undefined, app: x.app || '' } : null),
      breakEst: clean(d.breakEst, 5, 240, DEF.breakEst), probEst: clean(d.probEst, 5, 480, DEF.probEst),
      gridMin: Math.round(clean(d.gridMin, 0, 50, DEF.gridMin)), floatPct: clean(d.floatPct, 0, 50, DEF.floatPct),
      lunchAt: clean(d.lunchAt, 0, 1439, DEF.lunchAt), lunchMin: clean(d.lunchMin, 0, 180, DEF.lunchMin), slaB0: clean(d.slaB0, 0, 5000, DEF.slaB0), slaBd: clean(d.slaBd, 0, 5000, DEF.slaBd),
      sla: clean(d.sla, 1, 240, DEF.sla), slaVip: clean(d.slaVip, 1, 240, DEF.slaVip), nearH: clean(d.nearH, 0.5, 24, DEF.nearH),
      rebOn: !!d.rebOn, rebAt: clean(d.rebAt, 0, 1439, DEF.rebAt),
      dur: Object.fromEntries(Object.keys(CATS).map(k => [k, clean(d.dur[k], 10, 720, CATS[k].d)])),
    });
    this.ui.settings = false; this.ui.draft = null; this._jobs = null; this._need = null; this._layer = null; this._zone = null; this._zf = null;
    const { m, bi } = this._ctx;
    try {
      const J = this._J = this.jobs(m, bi), BS = this._BS = this.bases(m, bi, J), B = BS[0], P = this.st.plans[m.branches[bi]];
      this.ensureRoad(J, B);
      if (P) { this.autoPlan(P, J, B, true); P.prov = c.roadOn && this.road.busy(); }
      this.changed('Settings changed and the plan was re-run (cell ' + c.gridKm + ' km, ' + c.teams + ' teams, busy cell >' + c.gridMin + ' WO, ' + c.floatPct + '% floaters).');
    } catch (err) {
      console.error('IDS re-plan failed', err);
      this.changed('Settings saved, but the re-plan failed: ' + (err && err.message || err) + '. Press Re-plan automatically or reload.');
    }
  }

  /* ---------- map layer ---------- */
  layer() {
    const x = this._ctx; if (!x || !this._J || !x.P || !this._cells) return null;
    const k = this.type + '|' + this.ver + '|' + this.road.ver + '|' + x.name + '|' + this._J.list.length + '|' + [...this.ui.hidden].join(',') + '|' + this.ui.hideNext;
    if (this._layer && this._layer.key === k) return this._layer;
    const J = this._J, P = x.P, cfg = this.st.cfg;
    const tip = j => j.wo + ' · ' + (j.uid || j.cid) + ' · ' + j.tier + ' · ' + j.cat;
    const fit = !this._layer || this._layer.name !== x.name;
    this._layer = {
      key: k, name: x.name, fit, size: cfg.gridKm * 1000, cellA: cfg.cellA ?? 0.36, routeA: cfg.routeA ?? 1,
      cells: this._cells.map(g => ({ key: g.key, color: g.band.color, rank: g.rank,
        tip: [this.M.cellLabel(g.key) + ' · priority #' + g.rank, fmtN(g.jobs.length) + ' WO' + (g.vip ? ' · ' + g.vip + ' VIP (worked first)' : ''),
          g.ctr ? 'Busy cell (>' + cfg.gridMin + ' WO) · ' + nf1(g.cl.load / 60) + ' h · ' + g.need + ' team' + (g.need === 1 ? '' : 's') + ' needed · ' + dh(g.finish - cfg.start) : 'Neighbouring anchor team or floater', g.tms.length ? 'Assigned: ' + g.tms.map(n => this.tn(n)).join(', ') : 'No team assigned today'] })),
      base: { lat: x.B.lat, lng: x.B.lng, title: x.B.name }, bases: (this._BS || [x.B]).map(b => ({ lat: b.lat, lng: b.lng, title: b.name })),
      teams: P.teams.map((ids, n) => this.ui.hidden.has(n) ? null : ({ color: this.pal[n % this.pal.length], label: this.tn(n), line: ids.length ? this.road.geo.get(this.routeKey(ids, this.tbase(P, n))) || null : null,
        pts: ids.map(k2 => J.by.get(k2)).filter(Boolean).map(j => ({ lat: j.lat, lng: j.lng, title: this.tn(n) + ' · ' + tip(j) })) })).filter(t => t && t.pts.length),
      next: this.ui.hideNext ? [] : P.next.map(k2 => J.by.get(k2)).filter(Boolean).map(j => ({ lat: j.lat, lng: j.lng, title: 'H+1 · ' + tip(j) })),
    };
    return this._layer;
  }
}
