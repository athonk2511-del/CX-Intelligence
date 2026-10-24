// GlobalXtreme BI — field technician tracking. Reads a Traccar server (REST + WebSocket)
// or, in demo mode, simulates technicians driving to real customer locations.
const KEY = 'gx.traccar.v1';
export const DEFAULTS = {
  mode: 'demo', server: '', deviceUrl: '', token: '', enabled: true,
  staleMin: 15, offlineMin: 60, arriveM: 150, maxDays: 31, retentionDays: 365,
  techCol: '', matchBy: 'name', origin: typeof location !== 'undefined' ? location.origin : '',
  android: 'https://play.google.com/store/apps/details?id=org.traccar.client',
  ios: 'https://apps.apple.com/app/traccar-client/id843156974',
  purpose: 'Location data of GlobalXtreme field technicians is collected for field-operations coordination (dispatch, travel time per work order, safety and proof of visit). It is visible to operations managers and administrators only, and is deleted automatically after 365 days.',
};
export function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}
export const STATE_COLORS = { online: '#2E7D4F', stale: '#D09A1C', offline: '#9A9A95' };
export const WO_TYPES = { WWR: 'Wiredown', WCM: 'Maintenance', WCA: 'Activation' };

const RAD = Math.PI / 180;
export function dist(a, b, c, d) {
  const x = (d - b) * RAD * Math.cos((a + c) / 2 * RAD), y = (c - a) * RAD;
  return Math.sqrt(x * x + y * y) * 6371000;
}
export function posAt(P, t) {
  if (!P || !P.length) return null;
  if (t <= P[0].t) return P[0];
  if (t >= P[P.length - 1].t) return P[P.length - 1];
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].t <= t) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], f = (t - a.t) / ((b.t - a.t) || 1);
  return { t, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, speed: a.speed + (b.speed - a.speed) * f };
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const dayStart = off => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - off); return d.getTime(); };

/* ---------- demo ---------- */
const NAMES = ['Made Suardana', 'Ketut Arya', 'Wayan Sudira', 'Komang Adi', 'Putu Gede', 'Nyoman Rai', 'Gede Wirawan', 'Kadek Dwi', 'Agus Pratama', 'Rizky Hidayat', 'Bayu Saputra', 'Dimas Prakoso', 'Andi Firmansyah', 'Fajar Nugroho'];

class Demo {
  constructor(m) {
    this.m = m; this.session = Date.now(); this.plans = new Map(); this.techs = [];
    const per = m.branches.map(() => []);
    for (let i = 0; i < m.count; i++) if (m.status[i] !== 2) per[m.branch[i]].push(i);
    const big = per.map((a, b) => ({ b, n: a.length })).filter(x => x.n > 300).sort((x, y) => y.n - x.n);
    const total = big.reduce((s, x) => s + x.n, 0) || 1;
    let k = 0;
    big.forEach(x => {
      const ids = per[x.b], med = arr => arr.sort((a, b) => a - b)[arr.length >> 1];
      const office = [med(ids.map(i => m.lat[i])), med(ids.map(i => m.lng[i]))];
      const r = rng(hash('pool' + x.b)), pool = [];
      for (let q = 0; q < Math.min(4000, ids.length); q++) pool.push(ids[Math.floor(r() * ids.length)]);
      const n = Math.max(1, Math.round(12 * x.n / total));
      for (let t = 0; t < n && k < NAMES.length; t++, k++) {
        this.techs.push({ id: 9000 + k, name: NAMES[k], uniqueId: '0812' + String(10000000 + hash(NAMES[k]) % 89999999), branch: m.branches[x.b], office, pool, fault: k === 3 ? 'stale' : k === 7 ? 'offline' : null });
      }
    });
  }
  plan(tech, off) {
    const key = tech.id + '|' + off + '|' + dayStart(off);
    if (this.plans.has(key)) return this.plans.get(key);
    const m = this.m, r = rng(hash(key));
    const start = off === 0 ? this.session - (4.5 + r() * 1.5) * 3600e3 : dayStart(off) + 8 * 3600e3 + r() * 40 * 60e3;
    const end = start + 9.5 * 3600e3;
    const pts = [], wos = [];
    let pos = tech.office.slice(), t = start;
    const park = until => { while (t < until) { pts.push({ t, lat: pos[0] + (r() - 0.5) * 0.00008, lng: pos[1] + (r() - 0.5) * 0.00008, speed: 0 }); t += 60e3 + r() * 30e3; } };
    const drive = to => {
      const dLa = to[0] - pos[0], dLo = to[1] - pos[1], n = 2 + Math.floor(r() * 2), way = [pos];
      for (let q = 1; q <= n; q++) { const f = q / (n + 1), o = (r() - 0.5) * 0.3; way.push([pos[0] + dLa * f - dLo * o, pos[1] + dLo * f + dLa * o]); }
      way.push(to);
      const path = [way[0]];
      for (let q = 1; q < way.length; q++) { if (r() < 0.5) path.push([way[q - 1][0], way[q][1]]); path.push(way[q]); }
      const v0 = 20 + r() * 12;
      for (let q = 1; q < path.length; q++) {
        const a = path[q - 1], b = path[q], L = dist(a[0], a[1], b[0], b[1]);
        let s = 0;
        while (s < L) {
          const v = Math.max(6, v0 + (r() - 0.5) * 18);
          s = Math.min(L, s + v / 3.6 * 15); t += 15e3;
          const f = s / (L || 1);
          pts.push({ t, lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, speed: v });
        }
      }
      pos = to.slice();
    };
    let dispatch = start + (10 + r() * 25) * 60e3;
    park(dispatch + (5 + r() * 12) * 60e3);
    while (t < end - 70 * 60e3) {
      let dest = tech.pool[0];
      for (let q = 0; q < 40; q++) { const i = tech.pool[Math.floor(r() * tech.pool.length)]; const d = dist(pos[0], pos[1], m.lat[i], m.lng[i]); dest = i; if (d > 600 && d < 9000) break; }
      const u = r(), type = u < 0.35 ? 'WWR' : u < 0.75 ? 'WCM' : 'WCA';
      wos.push({ wo: type + '-' + String(hash(key + wos.length)).padStart(10, '0').slice(0, 10), type, cid: m.cid[dest], name: m.name[dest], lat: m.lat[dest], lng: m.lng[dest], dispatch });
      drive([m.lat[dest], m.lng[dest]]);
      park(t + ((type === 'WCA' ? 55 : 25) + r() * 45) * 60e3);
      dispatch = t - r() * 15 * 60e3;
      if (r() < 0.25) park(t + (10 + r() * 25) * 60e3);
    }
    if (t < end) { drive(tech.office); park(end); }
    const p = { start, end, pts, wos };
    this.plans.set(key, p);
    return p;
  }
  cut(tech, off, now) {
    if (off > 0) return Infinity;
    return tech.fault === 'stale' ? now - 22 * 60e3 : tech.fault === 'offline' ? now - 2.6 * 3600e3 : now;
  }
  devices(now) {
    return this.techs.map(tech => {
      const p = this.plan(tech, 0), c = this.cut(tech, 0, now);
      let k = p.pts.length - 1; while (k > 0 && p.pts[k].t > c) k--;
      const last = p.pts[k];
      return { id: tech.id, name: tech.name, uniqueId: tech.uniqueId, branch: tech.branch, last: last.t, lat: last.lat, lng: last.lng, speed: last.speed, battery: Math.max(9, Math.round(100 - (last.t - p.start) / 3600e3 * 7 - (tech.id % 5) * 3)) };
    });
  }
  day(off, devices) {
    const now = Date.now();
    const techs = this.techs.map(tech => {
      const p = this.plan(tech, off), c = this.cut(tech, off, now);
      const points = p.pts.filter(x => x.t <= c && x.t <= now);
      const device = devices.find(d => d.id === tech.id) || { id: tech.id, name: tech.name };
      return { device, points, wos: p.wos.filter(w => w.dispatch <= Math.min(c, now)).map(w => ({ ...w, tech: tech.name })) };
    });
    return { from: dayStart(off), to: off ? dayStart(off) + 86400e3 - 1 : now, techs };
  }
}

/* ---------- store ---------- */
export class TrackStore {
  // opts.wait: hold off until applyShared() hands over the settings shared on the proxy.
  constructor(D, opts) {
    this.D = D; this.cfg = loadConfig(); this.waiting = !!(opts && opts.wait); this.subs = new Set(); this.devices = []; this.link = { state: 'idle', reconnects: 0 };
    this.cache = new Map(); this.pending = new Set(); this.map = null; this.rawDev = new Map(); this.rawPos = new Map();
  }
  subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); }
  emit() { this.subs.forEach(f => f()); }
  setMap(m) { if (!m || this.map === m) return; this.map = m; this.cidIdx = null; if (this.cfg.mode === 'demo' || !this.started) this.restart(); }
  saveConfig(c) { this.cfg = { ...DEFAULTS, ...c }; localStorage.setItem(KEY, JSON.stringify(this.cfg)); this.restart(); }
  restart() { this.stop(); this.cache.clear(); this.devices = []; this.start(); }
  // Settings shared by an admin for every screen. mode 'none' = no live tracking set up: no demo, no technicians.
  applyShared(c) { this.waiting = false; this.shared = true; this.cfg = { ...DEFAULTS, ...(c || { mode: 'none' }) }; this.restart(); }
  start() {
    this.started = true;
    const c = this.cfg;
    if (this.waiting) { this.link = { state: 'waiting', msg: 'Loading the shared tracking settings…', reconnects: 0 }; this.emit(); return; }
    if (c.mode === 'none') { this.link = { state: 'off', msg: 'Live technician tracking has not been set up by the admin yet.', reconnects: 0 }; this.emit(); return; }
    if (c.mode === 'demo') {
      if (!this.map) { this.link = { state: 'waiting', msg: 'Waiting for customer locations to build the demo' }; this.emit(); return; }
      this.demo = new Demo(this.map);
      this.link = { state: 'demo', msg: this.demo.techs.length + ' simulated technicians driving to real customer locations', since: Date.now(), reconnects: 0 };
      const tick = () => { this.devices = this.status(this.demo.devices(Date.now())); this.link.lastMsg = Date.now(); this.emit(); };
      tick(); this.timer = setInterval(tick, 5000);
      return;
    }
    if (!c.enabled) { this.link = { state: 'off', msg: 'Live link is switched off in Tracking setup' }; this.emit(); return; }
    if (!c.server || !c.token) { this.link = { state: 'error', msg: 'Server URL and service-user token are required — fill them in Tracking setup' }; this.emit(); return; }
    this.connect();
    this.timer = setInterval(() => { this.devices = this.status(this.devices); this.emit(); }, 30000);
  }
  stop() {
    clearInterval(this.timer); clearInterval(this.poll); clearTimeout(this.retry); clearTimeout(this.wsRetry);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.demo = null;
  }
  status(list) {
    const now = Date.now(), s = this.cfg.staleMin * 60e3, o = this.cfg.offlineMin * 60e3;
    return list.map(d => ({ ...d, state: !d.last ? 'offline' : now - d.last > o ? 'offline' : now - d.last > s ? 'stale' : 'online' }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  base(c = this.cfg) { return String(c.server || '').trim().replace(/\/+$/, ''); }
  async api(path, c = this.cfg) {
    const r = await fetch(this.base(c) + path, { headers: { Authorization: 'Bearer ' + String(c.token || '').trim(), Accept: 'application/json' }, credentials: 'include' });
    if (r.status === 401) throw new Error('Token rejected (401) — generate a new one for the service user');
    if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + path);
    return r.json();
  }
  netMsg(e) { return e.message === 'Failed to fetch' || e.name === 'TypeError' ? 'Server not reachable from ' + location.origin + '. Check the URL and HTTPS, and that web.origin in traccar.xml allows this origin.' : e.message; }
  async connect() {
    this.link = { ...this.link, state: 'connecting', msg: 'Connecting to ' + this.base() };
    this.emit();
    try {
      const [devs, pos] = await Promise.all([this.api('/api/devices'), this.api('/api/positions')]);
      this.rawDev = new Map(devs.map(d => [d.id, d])); this.rawPos = new Map(pos.map(p => [p.deviceId, p]));
      this.refreshDevices();
      this.link = { ...this.link, state: 'polling', msg: 'Connected · polling every 15 s', since: Date.now(), lastMsg: Date.now() };
      this.emit();
      this.openSocket();
      this.poll = setInterval(() => this.pollOnce(), 15000);
    } catch (e) {
      this.link = { ...this.link, state: 'error', msg: this.netMsg(e) };
      this.emit();
      this.retry = setTimeout(() => { this.link.reconnects++; this.connect(); }, 60000);
    }
  }
  async openSocket() {
    try {
      await fetch(this.base() + '/api/session?token=' + encodeURIComponent(this.cfg.token), { credentials: 'include' });
      const ws = new WebSocket(this.base().replace(/^http/, 'ws') + '/api/socket');
      this.ws = ws;
      ws.onopen = () => { this.link = { ...this.link, state: 'live', msg: 'Live socket open' }; this.emit(); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        (m.devices || []).forEach(d => this.rawDev.set(d.id, d));
        (m.positions || []).forEach(p => this.rawPos.set(p.deviceId, p));
        this.link.lastMsg = Date.now(); this.refreshDevices(); this.emit();
      };
      ws.onclose = () => {
        this.ws = null; this.link.reconnects++;
        if (this.link.state === 'live') this.link = { ...this.link, state: 'polling', msg: 'Socket closed · polling every 15 s' };
        this.emit(); this.wsRetry = setTimeout(() => this.openSocket(), 30000);
      };
    } catch (e) { /* polling continues */ }
  }
  async pollOnce() {
    if (this.link.state === 'live') return;
    try {
      const pos = await this.api('/api/positions');
      pos.forEach(p => this.rawPos.set(p.deviceId, p));
      this.link.lastMsg = Date.now(); this.refreshDevices(); this.emit();
    } catch (e) { this.link = { ...this.link, msg: 'Polling failed: ' + this.netMsg(e) }; this.emit(); }
  }
  refreshDevices() {
    this.devices = this.status([...this.rawDev.values()].map(d => {
      const p = this.rawPos.get(d.id), a = (p && p.attributes) || {};
      return { id: d.id, name: d.name, uniqueId: d.uniqueId, phone: d.phone, last: p ? Date.parse(p.fixTime) : d.lastUpdate ? Date.parse(d.lastUpdate) : null, lat: p ? p.latitude : null, lng: p ? p.longitude : null, speed: p ? p.speed * 1.852 : 0, battery: a.batteryLevel != null ? Math.round(a.batteryLevel) : null };
    }));
  }
  async test(c) {
    try {
      const sr = await fetch(this.base(c) + '/api/server');
      if (!sr.ok) throw new Error('HTTP ' + sr.status + ' on /api/server');
      const s = await sr.json();
      // GET /api/session ignores the Authorization header (cookie or ?token= only), so pass the token as a query parameter.
      const u = await this.api('/api/session?token=' + encodeURIComponent(String(c.token || '').trim()), c);
      const d = await this.api('/api/devices', c);
      return { ok: true, text: 'Connected as ' + (u.name || u.email) + (s.version ? ' · Traccar ' + s.version : '') + ' · ' + d.length + ' devices' };
    } catch (e) { return { ok: false, text: this.netMsg(e) }; }
  }
  cidIndex() {
    if (!this.cidIdx && this.map) { this.cidIdx = new Map(); for (let i = 0; i < this.map.count; i++) this.cidIdx.set(String(this.map.cid[i]).replace(/\D/g, ''), i); }
    return this.cidIdx || new Map();
  }
  async realDay(off) {
    const from = dayStart(off), to = off ? from + 86400e3 - 1 : Date.now();
    const iso = t => new Date(t).toISOString();
    const devs = [...this.rawDev.values()];
    const routes = await Promise.all(devs.map(d => this.api('/api/reports/route?deviceId=' + d.id + '&from=' + iso(from) + '&to=' + iso(to)).catch(() => [])));
    const wos = this.cfg.techCol && this.D.loadFieldWOs ? await this.D.loadFieldWOs(new Date(from), this.cfg.techCol) : [];
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const digits = s => String(s || '').replace(/\D/g, '').replace(/^62/, '0');
    const dk = d => this.cfg.matchBy === 'phone' ? digits(d.uniqueId || d.phone) : norm(d.name);
    const wk = w => this.cfg.matchBy === 'phone' ? digits(w.tech) : norm(w.tech);
    const idx = this.cidIndex(), m = this.map;
    const techs = devs.map((d, i) => ({
      device: this.devices.find(x => x.id === d.id) || { id: d.id, name: d.name },
      points: routes[i].map(p => ({ t: Date.parse(p.fixTime), lat: p.latitude, lng: p.longitude, speed: p.speed * 1.852 })).sort((a, b) => a.t - b.t),
      wos: wos.filter(w => wk(w) && wk(w) === dk(d)).map(w => {
        const j = idx.get(String(w.cid).replace(/\D/g, ''));
        return j == null || !m ? { ...w } : { ...w, lat: m.lat[j], lng: m.lng[j], name: m.name[j] };
      }),
    }));
    const matched = techs.reduce((s, t) => s + t.wos.length, 0);
    return { from, to, techs, woTotal: wos.length, unmatched: wos.length - matched };
  }
  analyze(v) {
    const R = this.cfg.arriveM;
    v.techs.forEach(t => {
      const P = t.points;
      let m = 0, mov = 0;
      for (let i = 1; i < P.length; i++) {
        const d = dist(P[i - 1].lat, P[i - 1].lng, P[i].lat, P[i].lng), dt = P[i].t - P[i - 1].t;
        if (d > 15 || P[i].speed > 4) m += d;
        if (P[i].speed > 4 && dt < 300e3) mov += dt;
      }
      t.km = m / 1000; t.movingMs = mov;
      let cur = 0, prevDep = null;
      t.wos.sort((a, b) => a.dispatch - b.dispatch).forEach(w => {
        w.techName = t.device.name; w.techId = t.device.id;
        if (w.lat == null) { w.state = 'no location'; return; }
        const t0 = Math.max(w.dispatch, prevDep || 0);
        let k = cur; while (k < P.length && P[k].t < w.dispatch) k++;
        let a = -1;
        for (; k < P.length; k++) if (dist(P[k].lat, P[k].lng, w.lat, w.lng) <= R) { a = k; break; }
        if (a < 0) {
          const L = P[P.length - 1];
          if (L && L.t >= w.dispatch) { w.state = 'en route'; w.remainKm = dist(L.lat, L.lng, w.lat, w.lng) / 1000; w.travelMs = L.t - t0; w.travelFrom = t0; }
          else w.state = 'no fix';
          return;
        }
        let e = a; while (e + 1 < P.length && dist(P[e + 1].lat, P[e + 1].lng, w.lat, w.lng) <= R * 1.5) e++;
        let s = 0, j = cur; while (j < P.length && P[j].t < t0) j++;
        for (let q = j + 1; q <= a; q++) s += dist(P[q - 1].lat, P[q - 1].lng, P[q].lat, P[q].lng);
        const open = e === P.length - 1;
        Object.assign(w, { arrive: P[a].t, travelFrom: t0, travelMs: Math.max(0, P[a].t - t0), km: s / 1000, depart: open ? null : P[e].t, onsiteMs: P[e].t - P[a].t, state: open ? 'on site' : 'done' });
        cur = e; prevDep = P[e].t;
      });
      t.current = t.wos.filter(w => w.state === 'en route' || w.state === 'on site').pop() || null;
      t.done = t.wos.filter(w => w.state === 'done').length;
    });
    v.wos = v.techs.flatMap(t => t.wos).sort((a, b) => b.dispatch - a.dispatch);
    return v;
  }
  dayData(off) {
    const c = this.cache.get(off), ttl = this.demo ? 4000 : 120000;
    const stale = !c || (off === 0 && Date.now() - c.at > ttl);
    if (stale && !this.pending.has(off) && (this.demo || this.rawDev.size)) {
      this.pending.add(off);
      (this.demo ? Promise.resolve().then(() => this.demo.day(off, this.devices)) : this.realDay(off))
        .then(v => { this.cache.set(off, { at: Date.now(), v: this.analyze(v) }); })
        .catch(e => { this.cache.set(off, { at: Date.now(), v: { error: this.netMsg(e) } }); })
        .finally(() => { this.pending.delete(off); this.emit(); });
    }
    return c ? c.v : null;
  }
}
