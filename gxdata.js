// GlobalXtreme BI — Google Sheets data layer.
// Pushes aggregation into Google's Visualization Query API so the dashboard
// stays fast as the source sheet grows to a full year of rows.

let SHEET_ID = '16_wxt9NtC61vaww_7HIW15PNrY6E-iPQDfBbllM-jg4';

export const TABS = {
  tickets: '262501258',
  csat: '634063468',
  frt: '2105608606',
  rt: '750980381',
  dotai: '1364058646',
  human: '1567034438',
  customers: '1605668070',
};

export function setSheetUrl(url) {
  if (!url) return SHEET_ID;
  const m = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) SHEET_ID = m[1];
  return SHEET_ID;
}
export function sheetId() { return SHEET_ID; }

const cache = new Map();
export function clearCache() { cache.clear(); }
export const stats = { queries: 0, bytes: 0, lastSync: null };

export async function gviz(gid, tq) {
  const key = SHEET_ID + '|' + gid + '|' + tq;
  if (cache.has(key)) return cache.get(key);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}&tq=${encodeURIComponent(tq)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Sheet request failed (HTTP ' + res.status + ')');
  const text = await res.text();
  stats.queries++; stats.bytes += text.length;
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  let json;
  try { json = JSON.parse(text.slice(s, e + 1)); }
  catch (err) { throw new Error('Could not parse sheet response — is the sheet shared as "anyone with the link"?'); }
  if (json.status === 'error') {
    throw new Error((json.errors || []).map(x => x.detailed_message || x.message).join('; ') || 'Query error');
  }
  const out = {
    cols: json.table.cols.map(c => c.label || c.id),
    rows: json.table.rows.map(r => r.c.map(c => (c && c.v !== undefined ? c.v : null))),
  };
  cache.set(key, out);
  return out;
}

const esc = v => String(v).replace(/'/g, "\\'");
const num = v => (typeof v === 'number' ? v : Number(v) || 0);

/* ---------- shared helpers ---------- */

export function parseDMY(s) {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  s = String(s).trim();
  const g = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d{1,2}),(\d{1,2}),(\d{1,2}))?\)$/);
  if (g) return new Date(+g[1], +g[2], +g[3], +(g[4] || 0), +(g[5] || 0), +(g[6] || 0));
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

// Accepts every shape a sheet cell arrives in: a real Date, a gviz date cell
// serialised as "Date(2019,0,5)", or a plain dd/mm/yyyy string.
export function parseAnyDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  const g = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d{1,2}),(\d{1,2}),(\d{1,2}))?\)$/);
  if (g) return new Date(+g[1], +g[2], +g[3], +(g[4] || 0), +(g[5] || 0), +(g[6] || 0));
  return parseDMY(s);
}
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function fmtInt(n) { return (Math.round(n) || 0).toLocaleString('en-US'); }
export function fmtRp(n) { return 'Rp ' + (Math.round(n) || 0).toLocaleString('id-ID'); }
export function fmtPct(n, d = 1) { return (n * 100).toFixed(d) + '%'; }
export function fmtDur(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const s = Math.round(sec);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm ' + String(r).padStart(2, '0') + 's';
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 48) return h + 'h ' + String(rm).padStart(2, '0') + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}
function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
function pct(part, total) { return total ? part / total : 0; }

/* ---------- ticket filters ---------- */

// The sheet's Date column may arrive as text ("09/01/2026") or as a real date
// cell; the month filter must match whichever the sheet currently uses.
let ticketDateTyped = false;
// Timestamp columns that the sheet now stores as real dates reject a text
// comparison with '-', so "has a value" is tested per column type.
const typedCols = new Set();
const filled = col => typedCols.has(col) ? `${col} is not null` : `${col} is not null and ${col} <> '-'`;
async function detectTypedCols() {
  typedCols.clear();
  await Promise.all(['T', 'X', 'Z'].map(async col => {
    try { await gviz(TABS.tickets, `select count(B) where ${col} <> '-'`); }
    catch (e) { typedCols.add(col); }
  }));
}
export function ticketWhere(period, branch, extra) {
  const c = [];
  if (period && period !== 'all') {
    const [mm, yyyy] = period.split('/');
    c.push(ticketDateTyped ? `year(D) = ${+yyyy} and month(D) = ${+mm - 1}` : `D ends with '/${period}'`);
  }
  if (branch && branch !== 'all') c.push(`C = '${esc(branch)}'`);
  if (extra) c.push(extra);
  return c.length ? ' where ' + c.join(' and ') : '';
}
const W = (period, branch, extra) => ticketWhere(period, branch, extra);

async function count(where) {
  const r = await gviz(TABS.tickets, 'select count(B)' + where);
  return num(r.rows[0] && r.rows[0][0]);
}
async function grouped(col, where, limit) {
  const tq = `select ${col}, count(B)${where} group by ${col} order by count(B) desc` + (limit ? ` limit ${limit}` : '');
  const r = await gviz(TABS.tickets, tq);
  return r.rows.filter(x => x[0] !== null).map(x => ({ key: String(x[0]), value: num(x[1]) }));
}

/* ---------- bootstrap: available periods ---------- */

export async function loadIndex() {
  const [days, , branches] = await Promise.all([
    gviz(TABS.tickets, 'select D, count(B) group by D'),
    detectTypedCols(),
    gviz(TABS.tickets, 'select C, count(B) group by C order by count(B) desc'),
  ]);
  const byPeriod = new Map();
  ticketDateTyped = days.rows.some(([d]) => d instanceof Date || /^Date\(/.test(String(d || '')));
  const unreadable = days.rows.filter(([d]) => !parseDMY(d)).reduce((s, r) => s + num(r[1]), 0);
  const now = new Date();
  const nowKey = now.getFullYear() * 12 + now.getMonth() + 1;
  let future = 0;
  days.rows.forEach(([d, n]) => {
    const dt = parseDMY(d);
    if (!dt) return;
    const key = String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear();
    if (dt.getFullYear() * 12 + dt.getMonth() + 1 > nowKey) future += num(n);
    byPeriod.set(key, (byPeriod.get(key) || 0) + num(n));
  });
  const periods = [...byPeriod.entries()]
    .map(([key, total]) => {
      const [mm, yyyy] = key.split('/');
      return { key, label: MONTHS[+mm - 1] + ' ' + yyyy, short: MON3[+mm - 1] + ' ' + yyyy, total, sort: +yyyy * 12 + +mm };
    })
    .sort((a, b) => b.sort - a.sort);
  stats.lastSync = new Date();
  return {
    periods, unreadable, future, nowKey,
    branches: branches.rows.filter(r => r[0]).map(r => ({ key: String(r[0]), label: String(r[0]).replace(/^GlobalXtreme\s*/, ''), value: num(r[1]) })),
    totalAllTime: days.rows.reduce((s, r) => s + num(r[1]), 0),
  };
}

/* ---------- 1. tickets ---------- */

export async function loadTickets(period, branch) {
  const w = W(period, branch);
  const [total, daily, mass, type, priority, prioType, category, problem, channel, branchSplit, product] = await Promise.all([
    count(w),
    gviz(TABS.tickets, `select D, count(B)${w} group by D`),
    gviz(TABS.tickets, `select D, count(B)${W(period, branch, "Q = 'Mass-Problem'")} group by D`),
    grouped('O', w),
    grouped('G', w),
    gviz(TABS.tickets, `select G, O, count(B)${w} group by G, O`),
    grouped('P', w),
    grouped('Q', w, 15),
    grouped('R', w),
    grouped('C', w),
    grouped('H', w, 8),
  ]);
  const massBy = new Map(mass.rows.map(r => [r[0], num(r[1])]));
  const dmy = dt => String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear();
  const series = daily.rows
    .map(([d, n]) => { const date = parseDMY(d); return { date, raw: date ? dmy(date) : String(d), value: num(n), mass: massBy.get(d) || 0 }; })
    .filter(x => x.date)
    .sort((a, b) => a.date - b.date);
  const vals = series.map(s => s.value);
  const peak = series.reduce((a, b) => (b.value > (a ? a.value : -1) ? b : a), null);
  const low = series.reduce((a, b) => (b.value < (a ? a.value : 1e9) ? b : a), null);
  const critical = priority.filter(p => /vip|highest/i.test(p.key)).reduce((s, p) => s + p.value, 0);
  const prioComplaint = {};
  prioType.rows.forEach(([g, o, n]) => {
    if (!g) return;
    prioComplaint[g] = prioComplaint[g] || { Complaint: 0, Info: 0 };
    prioComplaint[g][o === 'Complaint' ? 'Complaint' : 'Info'] += num(n);
  });
  const massTop = series.filter(s => s.mass > 0).sort((a, b) => b.mass - a.mass).slice(0, 8);
  const massBaseline = median(series.map(s => s.mass));
  return {
    total, series, peak, low,
    avgDaily: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
    type, priority, prioComplaint, category, problem, channel, branchSplit, product,
    critical, criticalShare: pct(critical, total),
    massTotal: series.reduce((s, x) => s + x.mass, 0), massTop, massBaseline,
  };
}

/* ---------- 2. escalation ---------- */

const WO_TYPES = [
  { code: 'WCA', name: 'Activation', desc: 'New customer installation — acquisition signal' },
  { code: 'WCM', name: 'Maintenance', desc: 'Repair of the customer local network' },
  { code: 'WWR', name: 'Wiredown', desc: 'Connection cut — fiber break' },
  { code: 'WGM', name: 'Mass Outage', desc: 'Mass-outage work order code' },
];

export async function loadEscalation(period, branch) {
  const w = W(period, branch);
  const hasWO = "AC is not null and AC <> '-'";
  const sentCtso = filled('T');
  const namedCtso = "N is not null and N <> '-'";
  const [total, sent, named, wo, ...rest] = await Promise.all([
    count(w),
    count(W(period, branch, sentCtso)),
    count(W(period, branch, namedCtso)),
    count(W(period, branch, hasWO)),
    ...WO_TYPES.flatMap(t => [
      count(W(period, branch, `AC starts with '${t.code}'`)),
      count(W(period, branch, `AC starts with '${t.code}' and ${sentCtso}`)),
    ]),
  ]);
  const woTypes = WO_TYPES.map((t, i) => {
    const value = rest[i * 2], viaCtso = rest[i * 2 + 1];
    return { ...t, value, viaCtso, direct: value - viaCtso, share: pct(value, wo) };
  });
  const [ctsoAgents, woByCategory] = await Promise.all([
    gviz(TABS.tickets, `select N, count(B)${W(period, branch, namedCtso)} group by N order by count(B) desc limit 15`),
    gviz(TABS.tickets, `select P, count(B)${W(period, branch, hasWO)} group by P order by count(B) desc limit 10`),
  ]);
  return {
    total, sent, named, unassigned: sent - named, wo,
    sentShare: pct(sent, total), namedShare: pct(named, total), woShare: pct(wo, total),
    woTypes,
    ctsoAgents: ctsoAgents.rows.map(r => ({ key: String(r[0]), value: num(r[1]) })),
    woByCategory: woByCategory.rows.filter(r => r[0]).map(r => ({ key: String(r[0]), value: num(r[1]) })),
  };
}

/* ---------- 3. resolution & FCR ---------- */

const BUCKETS = [
  { label: '≤ 15 min', max: 15 },
  { label: '15–60 min', max: 60 },
  { label: '1–4 h', max: 240 },
  { label: '4–24 h', max: 1440 },
  { label: '> 24 h', max: Infinity },
];

export async function loadResolution(period, branch) {
  const w = W(period, branch);
  const [cso, ctso, reports, total] = await Promise.all([
    gviz(TABS.tickets, `select S, Z${W(period, branch, filled('Z'))} limit 120000`),
    gviz(TABS.tickets, `select T, X${W(period, branch, filled('T') + ' and ' + filled('X'))} limit 120000`),
    gviz(TABS.tickets, `select AE, count(B)${w} group by AE order by AE`),
    count(w),
  ]);
  const durations = rows => {
    const out = [];
    rows.forEach(([a, b]) => {
      const s = parseDMY(a), e = parseDMY(b);
      if (s && e) { const d = (e - s) / 60000; if (d >= 0 && d < 60 * 24 * 90) out.push(d); }
    });
    return out;
  };
  const csoD = durations(cso.rows), ctsoD = durations(ctso.rows);
  const bucket = arr => {
    const counts = BUCKETS.map(() => 0);
    arr.forEach(d => { for (let i = 0; i < BUCKETS.length; i++) if (d <= BUCKETS[i].max) { counts[i]++; break; } });
    let run = 0;
    return BUCKETS.map((b, i) => {
      run += counts[i];
      return { label: b.label, value: counts[i], share: pct(counts[i], arr.length), cumulative: pct(run, arr.length) };
    });
  };
  const rep = reports.rows.filter(r => r[0] !== null).map(r => ({ key: num(r[0]), value: num(r[1]) }));
  const repTotal = rep.reduce((s, r) => s + r.value, 0);
  const fcr = rep.find(r => r.key === 1);
  const heavy = rep.filter(r => r.key >= 5).reduce((s, r) => s + r.value, 0);
  return {
    total,
    csoCount: csoD.length,
    csoMedian: median(csoD), csoMean: csoD.length ? csoD.reduce((a, b) => a + b, 0) / csoD.length : null,
    csoMax: csoD.length ? Math.max(...csoD) : null,
    csoBuckets: bucket(csoD),
    ctsoCount: ctsoD.length,
    ctsoMedian: median(ctsoD), ctsoMean: ctsoD.length ? ctsoD.reduce((a, b) => a + b, 0) / ctsoD.length : null,
    ctsoBuckets: bucket(ctsoD),
    reports: rep, repTotal,
    fcr: fcr ? fcr.value : 0, fcrRate: pct(fcr ? fcr.value : 0, repTotal),
    heavy, heavyRate: pct(heavy, repTotal),
  };
}

/* ---------- 4. CSO workload ---------- */

export async function loadAgents(period, branch) {
  const w = W(period, branch);
  const notBlank = "M is not null and M <> '-'";
  const [agents, total, byType] = await Promise.all([
    gviz(TABS.tickets, `select M, count(B)${W(period, branch, notBlank)} group by M order by count(B) desc`),
    count(W(period, branch, notBlank)),
    gviz(TABS.tickets, `select M, O, count(B)${W(period, branch, notBlank)} group by M, O`),
  ]);
  const mix = {};
  byType.rows.forEach(([m, o, n]) => {
    if (!m) return;
    mix[m] = mix[m] || { Complaint: 0, Info: 0 };
    mix[m][o === 'Complaint' ? 'Complaint' : 'Info'] += num(n);
  });
  const list = agents.rows.filter(r => r[0]).map(r => {
    const key = String(r[0]), value = num(r[1]), m = mix[key] || { Complaint: 0, Info: 0 };
    return { key, value, complaint: m.Complaint, info: m.Info, complaintShare: pct(m.Complaint, value) };
  });
  const vals = list.map(l => l.value);
  return {
    list, total, headcount: list.length,
    avg: vals.length ? total / vals.length : 0,
    max: vals.length ? Math.max(...vals) : 0,
    min: vals.length ? Math.min(...vals) : 0,
  };
}

/* ---------- 5. repeat field work ----------
   Repeat contact is measured from executed field work, not reported tickets:
   how many WWR / WGM / WCM work orders a single CID required. Cancelled work
   orders (Status = "Canceled") never reached the customer, so they are dropped.
   WCA (new activation) is excluded — it is acquisition, not a repeat fault. */

export const REPEAT_WO = ['WWR', 'WCM', 'WGM'];
const WO_NAME = { WWR: 'Wiredown', WCM: 'Maintenance', WGM: 'Mass outage' };

export async function loadRepeat(period, branch) {
  const hasWo = "F is not null and AC is not null and AC <> '-'";
  const [live, killed] = await Promise.all([
    gviz(TABS.tickets, `select F, AC, AD${W(period, branch, hasWo + " and AD <> 'Canceled'")} limit 120000`),
    gviz(TABS.tickets, `select AC${W(period, branch, hasWo + " and AD = 'Canceled'")} limit 120000`),
  ]);
  const code = v => String(v || '').trim().slice(0, 3).toUpperCase();
  const byCid = new Map();
  let woTotal = 0;
  live.rows.forEach(([f, ac]) => {
    const c = code(ac);
    if (!REPEAT_WO.includes(c)) return;
    woTotal++;
    const cid = String(f);
    const e = byCid.get(cid) || { cid, value: 0, WWR: 0, WCM: 0, WGM: 0 };
    e.value++; e[c]++;
    byCid.set(cid, e);
  });
  const cancelled = killed.rows.filter(r => REPEAT_WO.includes(code(r[0]))).length;
  const list = [...byCid.values()]
    .map(e => ({ ...e, mix: REPEAT_WO.filter(c => e[c]).map(c => c + '×' + e[c]).join('  ') }))
    .sort((a, b) => b.value - a.value);
  const uniq = list.length;
  const multi = list.filter(x => x.value > 1).length;
  const three = list.filter(x => x.value >= 3).length;
  const five = list.filter(x => x.value >= 5).length;
  const bands = [
    { label: '1 work order', test: v => v === 1 },
    { label: '2 work orders', test: v => v === 2 },
    { label: '3–4 work orders', test: v => v >= 3 && v <= 4 },
    { label: '5+ work orders', test: v => v >= 5 },
  ].map(b => ({ label: b.label, value: list.filter(x => b.test(x.value)).length }));
  const repeatList = list.filter(x => x.value > 1);
  const repeatWo = repeatList.reduce((s, x) => s + x.value, 0);
  const byType = REPEAT_WO.map(c => ({
    code: c, name: WO_NAME[c],
    value: list.reduce((s, x) => s + x[c], 0),
    repeat: repeatList.reduce((s, x) => s + x[c], 0),
  })).filter(t => t.value);
  const mixedFault = repeatList.filter(x => REPEAT_WO.filter(c => x[c]).length > 1).length;
  return {
    uniq, multi, multiShare: pct(multi, uniq), three, threeShare: pct(three, uniq),
    five, fiveShare: pct(five, uniq),
    woTotal, cancelled, repeatWo, repeatWoShare: pct(repeatWo, woTotal),
    byType, mixedFault,
    top: list.slice(0, 12), bands,
  };
}

/* ---------- 6. chat omnichannel ---------- */

const SYSTEM_RE = /dispatcher|lobby|ctso-|helpdesk|administrator|dotai|bot|queue/i;

export async function loadChat(frtSla = 5, rtSla = 2) {
  const [frt, rt, dot, human] = await Promise.all([
    gviz(TABS.frt, 'select A, B, C'),
    gviz(TABS.rt, 'select A, B, C'),
    gviz(TABS.dotai, 'select A, B'),
    gviz(TABS.human, 'select A, B'),
  ]);
  const frtMap = new Map(frt.rows.filter(r => r[0]).map(r => [String(r[0]).trim(), num(r[1])]));
  const rtMap = new Map(rt.rows.filter(r => r[0]).map(r => [String(r[0]).trim(), num(r[1])]));
  const volMap = new Map(human.rows.filter(r => r[0]).map(r => [String(r[0]).trim(), num(r[1])]));
  const names = new Set([...frtMap.keys(), ...rtMap.keys(), ...volMap.keys()]);
  const all = [...names].map(name => {
    const volume = volMap.get(name) || 0;
    const f = frtMap.has(name) ? frtMap.get(name) : null;
    const r = rtMap.has(name) ? rtMap.get(name) : null;
    return {
      name, volume, frt: f, rt: r,
      system: SYSTEM_RE.test(name),
      excessFrt: f != null ? Math.max(0, (f - frtSla * 60) / 60) * volume : 0,
      excessRt: r != null ? Math.max(0, (r - rtSla * 60) / 60) * volume : 0,
    };
  });
  const humans = all.filter(a => !a.system).sort((a, b) => b.volume - a.volume);
  const system = all.filter(a => a.system).sort((a, b) => b.volume - a.volume);
  const measured = humans.filter(h => h.frt != null && h.volume > 0);
  const volSum = measured.reduce((s, h) => s + h.volume, 0);
  const weighted = volSum ? measured.reduce((s, h) => s + h.frt * h.volume, 0) / volSum : null;
  const simple = measured.length ? measured.reduce((s, h) => s + h.frt, 0) / measured.length : null;
  const medVol = median(measured.map(h => h.volume)) || 0;
  const medFrt = median(measured.map(h => h.frt)) || 0;
  // Average (ongoing) response time — used for the volume-versus-speed scatter.
  const measuredRt = humans.filter(h => h.rt != null && h.volume > 0);
  const medVolRt = median(measuredRt.map(h => h.volume)) || 0;
  const medRt = median(measuredRt.map(h => h.rt)) || 0;
  const rtVolSum = measuredRt.reduce((s, h) => s + h.volume, 0);
  const weightedRt = rtVolSum ? measuredRt.reduce((s, h) => s + h.rt * h.volume, 0) / rtVolSum : null;
  const simpleRt = measuredRt.length ? measuredRt.reduce((s, h) => s + h.rt, 0) / measuredRt.length : null;
  const quad = q => measuredRt.filter(h =>
    (q.hiVol ? h.volume >= medVolRt : h.volume < medVolRt) && (q.slow ? h.rt >= medRt : h.rt < medRt));
  const bands = [
    { label: '< 5 min', test: s => s < 300 },
    { label: '5–10 min', test: s => s >= 300 && s < 600 },
    { label: '10–15 min', test: s => s >= 600 && s < 900 },
    { label: '15–30 min', test: s => s >= 900 && s < 1800 },
    { label: '> 30 min', test: s => s >= 1800 },
  ].map(b => {
    const v = measured.filter(h => b.test(h.frt)).length;
    return { label: b.label, value: v, share: pct(v, measured.length) };
  });
  const totalConv = num(dot.rows[0] && dot.rows[0][0]);
  const byAi = num(dot.rows[0] && dot.rows[0][1]);
  return {
    totalConv, byAi, aiShare: pct(byAi, totalConv), byHuman: totalConv - byAi,
    humans, system, measured, medVol, medFrt,
    measuredRt, medVolRt, medRt, weightedRt, simpleRt,
    weighted, simple,
    unmeasured: humans.filter(h => h.frt == null).map(h => h.name),
    bands,
    quadrants: [
      { id: 'hv-slow', label: 'High volume · Slow average RT', note: 'Highest coaching priority', members: quad({ hiVol: true, slow: true }) },
      { id: 'hv-fast', label: 'High volume · Fast average RT', note: 'Role models', members: quad({ hiVol: true, slow: false }) },
      { id: 'lv-fast', label: 'Low volume · Fast average RT', note: 'Capacity headroom', members: quad({ hiVol: false, slow: false }) },
      { id: 'lv-slow', label: 'Low volume · Slow average RT', note: 'Individual follow-up', members: quad({ hiVol: false, slow: true }) },
    ],
    excessHuman: humans.reduce((s, h) => s + h.excessFrt, 0),
    excessSystem: system.reduce((s, h) => s + h.excessRt, 0),
    topExcess: humans.filter(h => h.excessFrt > 0).sort((a, b) => b.excessFrt - a.excessFrt).slice(0, 12),
    fastest: measured.slice().sort((a, b) => a.frt - b.frt).slice(0, 5),
    slowest: measured.slice().sort((a, b) => b.frt - a.frt).slice(0, 5),
    humanVolume: humans.reduce((s, h) => s + h.volume, 0),
  };
}

/* ---------- 7. CSAT ---------- */

export async function loadCsat(period) {
  const [daily, device, browser, comments] = await Promise.all([
    gviz(TABS.csat, 'select year(S), month(S), day(S), C, count(G) group by year(S), month(S), day(S), C'),
    gviz(TABS.csat, 'select J, count(G) group by J order by count(G) desc'),
    gviz(TABS.csat, 'select K, count(G) group by K order by count(G) desc limit 8'),
    gviz(TABS.csat, 'select S, C, D, E, F where D is not null order by S desc limit 400'),
  ]);
  const inPeriod = (y, m) => period === 'all' || (String(m + 1).padStart(2, '0') + '/' + y) === period;
  const dist = new Map(), byDay = new Map();
  let total = 0, score = 0;
  daily.rows.forEach(([y, m, d, rating, n]) => {
    if (y == null || rating == null) return;
    if (!inPeriod(num(y), num(m))) return;
    const c = num(n), r = num(rating);
    dist.set(r, (dist.get(r) || 0) + c);
    const key = new Date(num(y), num(m), num(d)).getTime();
    const cur = byDay.get(key) || { date: new Date(key), value: 0, score: 0 };
    cur.value += c; cur.score += c * r;
    byDay.set(key, cur);
    total += c; score += c * r;
  });
  const series = [...byDay.values()].sort((a, b) => a.date - b.date)
    .map(d => ({ ...d, avg: d.value ? d.score / d.value : 0 }));
  const ratings = [5, 4, 3, 2, 1].map(r => ({
    rating: r, value: dist.get(r) || 0, share: pct(dist.get(r) || 0, total),
    label: ({ 5: 'Excellent', 4: 'Good', 3: 'Fair', 2: 'Poor', 1: 'Very poor' })[r],
  }));
  const top2 = (dist.get(5) || 0) + (dist.get(4) || 0);
  const bottom2 = (dist.get(1) || 0) + (dist.get(2) || 0);
  const cmt = comments.rows.map(([s, c, d, e, f]) => {
    const dt = s && typeof s === 'string' && s.startsWith('Date(')
      ? new Date(...s.slice(5, -1).split(',').map(Number)) : (s instanceof Date ? s : null);
    return { date: dt, rating: num(c), text: String(d || ''), who: e ? String(e) : '', extra: f ? String(f) : '' };
  }).filter(c => c.text && (period === 'all' || !c.date ||
    (String(c.date.getMonth() + 1).padStart(2, '0') + '/' + c.date.getFullYear()) === period));
  return {
    total, avg: total ? score / total : 0,
    ratings, top2, top2Share: pct(top2, total), bottom2, bottom2Share: pct(bottom2, total),
    series,
    device: device.rows.filter(r => r[0]).map(r => ({ key: String(r[0]), value: num(r[1]) })),
    browser: browser.rows.filter(r => r[0]).map(r => ({ key: String(r[0]), value: num(r[1]) })),
    comments: cmt,
    commentShare: pct(cmt.length, total),
    detractors: cmt.filter(c => c.rating <= 3),
    promoters: cmt.filter(c => c.rating >= 4),
  };
}

/* ---------- 8. growth & churn ---------- */

export async function loadGrowth() {
  const [status, starts, terms, product, area, price] = await Promise.all([
    gviz(TABS.customers, 'select C, G, count(E) group by C, G'),
    gviz(TABS.customers, 'select J, C, count(E) group by J, C'),
    gviz(TABS.customers, "select year(L), month(L), C, count(E) where G = 'Termination' group by year(L), month(L), C"),
    gviz(TABS.customers, "select M, count(E) where G = 'Active' group by M order by count(E) desc limit 10"),
    gviz(TABS.customers, "select H, count(E) where G = 'Active' group by H order by count(E) desc limit 12"),
    gviz(TABS.customers, "select N, count(E) where G = 'Active' group by N order by count(E) desc limit 10"),
  ]);
  const branches = new Map();
  const statuses = new Map();
  let totalRecords = 0;
  status.rows.forEach(([b, s, n]) => {
    if (!b) return;
    const c = num(n), bk = String(b), sk = String(s || 'Unknown');
    totalRecords += c;
    statuses.set(sk, (statuses.get(sk) || 0) + c);
    const e = branches.get(bk) || { key: bk, label: bk.replace(/^GlobalXtreme\s*/, ''), total: 0, byStatus: {} };
    e.total += c; e.byStatus[sk] = (e.byStatus[sk] || 0) + c;
    branches.set(bk, e);
  });

  // month index of latest activity → 12-month window
  const monthKey = (y, m) => y * 12 + m;
  const today = new Date();
  const nowMk = monthKey(today.getFullYear(), today.getMonth());
  let maxStart = -Infinity;
  const startRows = [];
  starts.rows.forEach(([d, b, n]) => {
    const dt = parseDMY(d);
    if (!dt || !b) return;
    const mk = monthKey(dt.getFullYear(), dt.getMonth());
    if (mk <= nowMk) maxStart = Math.max(maxStart, mk);
    startRows.push({ mk, branch: String(b), n: num(n), y: dt.getFullYear(), m: dt.getMonth() });
  });
  const latest = Math.min(isFinite(maxStart) ? maxStart : nowMk, nowMk);
  const termRows = terms.rows.filter(r => r[0] != null && r[2]).map(([y, m, b, n]) => ({
    mk: monthKey(num(y), num(m)), branch: String(b), n: num(n), y: num(y), m: num(m),
  }));
  const windowStart = latest - 11;

  const monthly = new Map();
  const bump = (mk, y, m, key, n) => {
    const e = monthly.get(mk) || { mk, y, m, label: MON3[m] + " '" + String(y).slice(2), added: 0, lost: 0, byBranch: {} };
    e[key] += n;
    e.byBranch[key] = e.byBranch[key] || {};
    monthly.set(mk, e);
  };
  startRows.forEach(r => { if (r.mk >= latest - 17 && r.mk <= latest) bump(r.mk, r.y, r.m, 'added', r.n); });
  termRows.forEach(r => { if (r.mk >= latest - 17 && r.mk <= latest) bump(r.mk, r.y, r.m, 'lost', r.n); });
  const monthlySeries = [...monthly.values()].sort((a, b) => a.mk - b.mk).map(x => ({ ...x, net: x.added - x.lost }));

  const perBranch = [...branches.values()].map(b => {
    const added = startRows.filter(r => r.branch === b.key && r.mk >= windowStart && r.mk <= latest).reduce((s, r) => s + r.n, 0);
    const lost = termRows.filter(r => r.branch === b.key && r.mk >= windowStart && r.mk <= latest).reduce((s, r) => s + r.n, 0);
    const active = b.byStatus['Active'] || 0;
    const base = Math.max(1, active - added + lost);
    return {
      ...b, added, lost, net: added - lost, active,
      terminated: b.byStatus['Termination'] || 0,
      growthRate: added / base, churnRate: lost / base, base,
      activeShare: pct(active, b.total),
    };
  }).sort((a, b) => b.total - a.total);

  return {
    totalRecords, branches: perBranch,
    statuses: [...statuses.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value),
    active: statuses.get('Active') || 0,
    terminated: statuses.get('Termination') || 0,
    changeOwnership: statuses.get('Change Ownership') || 0,
    added12: perBranch.reduce((s, b) => s + b.added, 0),
    lost12: perBranch.reduce((s, b) => s + b.lost, 0),
    monthlySeries,
    windowLabel: monthlySeries.length ? monthlySeries[Math.max(0, monthlySeries.length - 12)].label + ' – ' + monthlySeries[monthlySeries.length - 1].label : '',
    product: product.rows.filter(r => r[0]).map(r => ({ key: String(r[0]), value: num(r[1]) })),
    variant: price.rows.filter(r => r[0]).map(r => ({ key: String(r[0]), value: num(r[1]) })),
    area: area.rows.filter(r => r[0]).map(r => ({ key: String(r[0]), value: num(r[1]) })),
  };
}

// Loaded separately so a slow sheet can't hold up the growth page.
// Grouped server-side on the distinct (grace, expiry, fee, discount) combos,
// so only a few hundred rows travel instead of every blocked account.
export async function loadBlocked() {
  const r = await gviz(TABS.customers, "select K, L, O, P, count(E), A, C where G = 'Blocked' group by K, L, O, P, A, C");
  const out = summariseBlocked(r.rows);
  // customers blocked for more than 3 months, grouped by holder name
  const today = new Date();
  const byName = new Map();
  let accounts = 0;
  r.rows.forEach(([grace, exp, fee, disc, cnt, name, branch]) => {
    const dt = parseAnyDate(grace) || parseAnyDate(exp);
    if (!dt || (today - dt) / 86400000 <= 90) return;
    const n = num(cnt) || 1;
    const label = String(name || '').replace(/\s+/g, ' ').trim() || '(no name)';
    const k = label.toLowerCase();
    const e = byName.get(k) || { name: label, accounts: 0, mrc: 0, since: dt, branches: new Set() };
    e.accounts += n; e.mrc += Math.max(0, rp(fee) - rp(disc)) * n;
    if (dt < e.since) e.since = dt;
    if (branch) e.branches.add(String(branch).replace(/^GlobalXtreme\s*/, ''));
    byName.set(k, e);
    accounts += n;
  });
  const list = [...byName.values()]
    .map(e => ({ ...e, branches: [...e.branches].join(', '), months: Math.floor((today - e.since) / (86400000 * 30.44)) }))
    .sort((a, b) => b.accounts - a.accounts || b.mrc - a.mrc);
  const multi = list.filter(x => x.accounts > 1);
  out.over3Customers = {
    accounts, names: list.length, list,
    multiNames: multi.length, multiAccounts: multi.reduce((s, x) => s + x.accounts, 0),
    multiMrc: multi.reduce((s, x) => s + x.mrc, 0),
  };
  return out;
}

/* Blocked accounts — the churn pipeline.
   Blocked date = end of grace period (K); falls back to expiration (L) when no
   grace was granted. MRC = Monthly Fee (O) − Discount (P), before PPN. */
const rp = v => typeof v === 'number' ? v : (+String(v || '').replace(/[^\d-]/g, '') || 0);
function summariseBlocked(rows) {
  const today = new Date();
  const DAY = 86400000;
  const buckets = [
    { key: 'Up to 1 month', test: d => d <= 30 },
    { key: '1–2 months', test: d => d > 30 && d <= 60 },
    { key: '2–3 months', test: d => d > 60 && d <= 90 },
    { key: 'More than 3 months', test: d => d > 90 },
  ].map(b => ({ ...b, value: 0, mrc: 0 }));
  const undated = { value: 0, mrc: 0 };
  const monthly = new Map();
  let total = 0, mrcTotal = 0;
  rows.forEach(([grace, exp, fee, disc, cnt]) => {
    const n = num(cnt) || 1;
    const mrc = Math.max(0, rp(fee) - rp(disc)) * n;
    total += n; mrcTotal += mrc;
    const dt = parseAnyDate(grace) || parseAnyDate(exp);
    if (!dt) { undated.value += n; undated.mrc += mrc; return; }
    const days = Math.max(0, (today - dt) / DAY);
    const b = buckets.find(x => x.test(days));
    b.value += n; b.mrc += mrc;
    const mk = dt.getFullYear() * 12 + dt.getMonth();
    const e = monthly.get(mk) || { mk, label: MON3[dt.getMonth()] + " '" + String(dt.getFullYear()).slice(2), accounts: 0, mrc: 0 };
    e.accounts += n; e.mrc += mrc;
    monthly.set(mk, e);
  });
  const nowMk = today.getFullYear() * 12 + today.getMonth();
  const all = [...monthly.values()].filter(x => x.mk <= nowMk).sort((a, b) => a.mk - b.mk);
  const series = [];
  for (let mk = nowMk - 11; mk <= nowMk; mk++) {
    const y = Math.floor(mk / 12), m = mk % 12;
    const e = monthly.get(mk) || { mk, label: MON3[m] + " '" + String(y).slice(2), accounts: 0, mrc: 0 };
    series.push({ ...e, mrcM: Math.round(e.mrc / 1e5) / 10 });
  }
  const earlier = all.filter(x => x.mk < nowMk - 11).reduce((s, x) => ({ accounts: s.accounts + x.accounts, mrc: s.mrc + x.mrc }), { accounts: 0, mrc: 0 });
  return {
    total, mrcTotal, undated, earlier, series,
    buckets: buckets.map(({ key, value, mrc }) => ({ key, value, mrc })),
    over3: buckets[3].value, over3Mrc: buckets[3].mrc,
    recent: buckets[0].value, recentMrc: buckets[0].mrc,
  };
}

/* ---------- 9. churn quality analysis (opt-in, row level) ----------
   A termination row is only genuine churn if the customer actually left the
   network. Two cases are not churn:
     • account swap  — a live account at the SAME coordinate under the same
       name or phone: the line never stopped, only the account record changed.
     • relocation    — the same name or phone starts a new account at a
       DIFFERENT coordinate within ±RELOCATION_WINDOW days of the termination:
       the customer moved house and took the service with them.
   Formal Change Ownership records are a separate status and were never in the
   churn figure; they are reported here so the exclusion is visible. */

export const RELOCATION_WINDOW = 14;
const DAY = 86400000;

export async function runSwapAnalysis(onProgress) {
  const CHUNK = 20000;
  const rows = [];
  for (let offset = 0; ; offset += CHUNK) {
    const r = await gviz(TABS.customers, `select I, G, A, W, C, J, L limit ${CHUNK} offset ${offset}`);
    rows.push(...r.rows);
    if (onProgress) onProgress(rows.length);
    if (r.rows.length < CHUNK) break;
    if (offset > 400000) break;
  }
  const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const phoneKey = v => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : ''; };
  const coordKey = v => (!v || /0\.000000,\s*0\.000000/.test(v)) ? '' : String(v).trim();
  const isLive = s => /^(Active|Pending|Graced|Blocked)$/i.test(String(s || ''));

  // live accounts indexed by coordinate, and by customer identity for relocation tracing
  const liveAtCoord = new Map();
  const liveByIdentity = new Map();
  rows.forEach(([coord, status, name, phone, branch, start]) => {
    if (!isLive(status)) return;
    const ck = coordKey(coord);
    const rec = { name: norm(name), phone: phoneKey(phone), branch: String(branch || ''), coord: ck, start: parseAnyDate(start) };
    if (ck) {
      if (!liveAtCoord.has(ck)) liveAtCoord.set(ck, []);
      liveAtCoord.get(ck).push(rec);
    }
    [rec.name && 'n:' + rec.name, rec.phone && 'p:' + rec.phone].filter(Boolean).forEach(k => {
      if (!liveByIdentity.has(k)) liveByIdentity.set(k, []);
      liveByIdentity.get(k).push(rec);
    });
  });

  let swaps = 0, relocations = 0, sameCoordDiffId = 0, invalid = 0, terminations = 0,
      changeOwnership = 0, undatedTerm = 0;
  const byBranch = new Map();
  const relocByBranch = new Map();
  const samples = [];
  const relocSamples = [];

  rows.forEach(([coord, status, name, phone, branch, , term]) => {
    if (/^change\s*(of\s*)?ownership$/i.test(String(status || ''))) { changeOwnership++; return; }
    if (!/^termination$/i.test(String(status || ''))) return;
    terminations++;
    const bk = String(branch || 'Unknown');
    const nm = norm(name), ph = phoneKey(phone);
    const ck = coordKey(coord);

    // 1. account swap at the same address
    if (ck) {
      const hits = liveAtCoord.get(ck);
      const match = hits && hits.find(h => (nm && h.name === nm) || (ph && h.phone === ph));
      if (match) {
        swaps++;
        byBranch.set(bk, (byBranch.get(bk) || 0) + 1);
        if (samples.length < 8) samples.push({ name: String(name || ''), branch: bk.replace(/^GlobalXtreme\s*/, ''), coord: ck });
        return;
      }
    } else invalid++;

    // 2. relocation — same identity live again at a different address, dates close together
    const termDate = parseAnyDate(term);
    const pool = [];
    if (nm) pool.push(...(liveByIdentity.get('n:' + nm) || []));
    if (ph) pool.push(...(liveByIdentity.get('p:' + ph) || []));
    const moved = pool.find(h => {
      if (ck && h.coord === ck) return false;
      if (!h.coord) return false;
      if (!termDate || !h.start) return false;
      return Math.abs(h.start - termDate) <= RELOCATION_WINDOW * DAY;
    });
    if (moved) {
      relocations++;
      relocByBranch.set(bk, (relocByBranch.get(bk) || 0) + 1);
      if (relocSamples.length < 8) relocSamples.push({
        name: String(name || ''), branch: bk.replace(/^GlobalXtreme\s*/, ''),
        from: ck || '—', to: moved.coord,
        gap: termDate && moved.start ? Math.round((moved.start - termDate) / DAY) : null,
      });
      return;
    }
    if (!termDate) undatedTerm++;
    if (ck && liveAtCoord.get(ck)) sameCoordDiffId++;
  });

  const realChurn = terminations - swaps - relocations;
  return {
    scanned: rows.length, terminations, swaps, relocations, changeOwnership, undatedTerm,
    realChurn,
    relocationShare: pct(relocations, terminations),
    realChurnShare: pct(realChurn, terminations),
    relocByBranch: [...relocByBranch.entries()].map(([key, value]) => ({ key: key.replace(/^GlobalXtreme\s*/, ''), value })).sort((a, b) => b.value - a.value),
    relocSamples, window: RELOCATION_WINDOW,
    swapShare: pct(swaps, terminations), sameCoordDiffId, invalid,
    byBranch: [...byBranch.entries()].map(([key, value]) => ({ key: key.replace(/^GlobalXtreme\s*/, ''), value })).sort((a, b) => b.value - a.value),
    samples,
  };
}
