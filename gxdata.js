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
export function clearCache() { cache.clear(); setP = {}; fullP = {}; setsP = null; csvFailed = {}; csvInfo.sets = {}; csvSummary(); }

/* ---------- CSV files in Google Drive ----------
   Tickets, Customers and Work Orders are read from the CSV files in one Drive folder
   (subfolders "Tickets", "Customers", "Work Orders", or root files named by type; see
   gxcsv.js). Ticket and customer CSVs keep the column order of their sheet tab (A, B,
   C …) with one header row; files are stacked in name order. Work orders use the WO
   export layout (B WO Number, C Branch, F WO Status, H WO Created, L CID, T Priority,
   Y Date of Work). Files are cached in the browser and only downloaded again when they
   change. A dataset with no CSV files falls back to its sheet tab. */
const CSV_FOLDER = '1XPOvL9Tcqsq7JKKd76m_tKz7pNBPyv3g';
const DRIVE_API_KEY = '';
// Google sign-in (OAuth client ID). When set, users sign in with their Google account and
// the folder only needs to be shared with their emails (no public link). The API key is
// then not used for the CSV files.
const GOOGLE_CLIENT_ID = '591013784266-8p4uqdchkb4gk7gjcmfh4181g186d5fi.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_STORE = 'gx-google-token';
let gTok = null, gTokP = null, gClient = null;
try { const t = JSON.parse(sessionStorage.getItem(TOKEN_STORE) || 'null'); if (t && t.exp > Date.now() + 60000) gTok = t; } catch (e) {}
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.appendChild(sc); });
}
// The sign-in popup must open from a click, so show a button first.
function googleToken(renew) {
  if (!renew && gTok && gTok.exp > Date.now() + 60000) return Promise.resolve(gTok.t);
  if (gTokP) return gTokP;
  gTokP = (async () => {
    await loadGis();
    return await new Promise((resolve, reject) => {
      const done = (t, err) => { wrap.remove(); gTokP = null; err ? reject(err) : resolve(t); };
      gClient = google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE, prompt: '',
        callback: r => { if (r.error || !r.access_token) { msg.textContent = 'Sign-in failed (' + (r.error || 'no token') + '). Try again.'; return; }
          gTok = { t: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000 };
          try { sessionStorage.setItem(TOKEN_STORE, JSON.stringify(gTok)); } catch (e) {}
          done(gTok.t); },
        error_callback: e => { msg.textContent = e && e.type === 'popup_closed' ? 'Sign-in window closed. Try again.' : 'Sign-in could not open (' + ((e && e.type) || 'error') + ').'; } });
      const wrap = document.createElement('div');
      wrap.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif');
      wrap.innerHTML = `
        <div style="background:#fff;color:#0f172a;border-radius:16px;padding:28px 24px;width:100%;max-width:380px;box-shadow:0 20px 50px rgba(0,0,0,.25)">
          <div style="font-size:18px;font-weight:600;margin-bottom:6px">CX Intelligence</div>
          <div style="font-size:14px;color:#475569;margin-bottom:18px">${renew ? 'Your Google session has expired. Sign in again to keep loading data.' : 'Sign in with your office Google account to load the ticket, customer and work order files.'}</div>
          <button type="button" data-go style="width:100%;font-size:15px;font-weight:600;padding:11px;border:0;border-radius:10px;background:#0f172a;color:#fff;cursor:pointer">Sign in with Google</button>
          <button type="button" data-skip style="margin-top:8px;width:100%;font-size:13px;padding:8px;border:0;background:none;color:#475569;cursor:pointer">Skip \u2014 use Google Sheet data</button>
          <div data-msg style="margin-top:10px;font-size:13px;color:#b91c1c;min-height:1em"></div>
        </div>`;
      const msg = wrap.querySelector('[data-msg]');
      wrap.querySelector('[data-go]').addEventListener('click', () => { msg.textContent = ''; gClient.requestAccessToken(); });
      wrap.querySelector('[data-skip]').addEventListener('click', () => done(null, new Error('Google sign-in skipped')));
      document.body.appendChild(wrap);
    });
  })();
  return gTokP;
}
export function googleSignOut() {
  if (gTok && window.google && google.accounts) try { google.accounts.oauth2.revoke(gTok.t, () => {}); } catch (e) {}
  gTok = null; try { sessionStorage.removeItem(TOKEN_STORE); } catch (e) {}
}
try { if (/[?&]logout\b/.test(location.search)) googleSignOut(); } catch (e) {}
const DRIVE_AUTH = GOOGLE_CLIENT_ID ? { token: googleToken } : { key: DRIVE_API_KEY };
const SET_OF = { [TABS.tickets]: 'tickets', [TABS.customers]: 'customers', [TABS.csat]: 'csat', wo: 'wo' };
const SET_LABEL = { tickets: 'tickets', customers: 'customers', wo: 'work orders', csat: 'CSAT' };
let CSV = null, setsP = null, setP = {}, csvFailed = {};
export const csvInfo = { on: !!CSV_FOLDER, folder: CSV_FOLDER, files: 0, rows: 0, phase: '', error: null, sets: {}, text: '' };
function csvSummary() {
  const S = Object.entries(csvInfo.sets).filter(([, v]) => v.total);
  const parts = S.map(([k, v]) => SET_LABEL[k] + ' ' + (v.done ? v.files + ' files (' + v.rows.toLocaleString('en-US') + ' rows)' : v.files + '/' + v.total + ' files, ' + v.rows.toLocaleString('en-US') + ' rows so far'));
  csvInfo.text = parts.length ? 'Drive CSV: ' + parts.join(' \u00b7 ') : '';
  const tf = S.reduce((a, [, v]) => a + v.files, 0), tt = S.reduce((a, [, v]) => a + v.total, 0);
  csvInfo.pct = tt ? tf / tt : 1; csvInfo.loading = S.some(([, v]) => !v.done);
  const t = csvInfo.sets.tickets; if (t && t.done) { csvInfo.files = t.files; csvInfo.rows = t.rows; csvInfo.phase = 'ready'; }
}
// Batch events: { name, done, total, rows, complete } after every file, or { name, error }.
const csvListeners = new Set();
export function onCsvProgress(fn) { csvListeners.add(fn); return () => csvListeners.delete(fn); }
const csvEmit = x => csvListeners.forEach(f => { try { f(x); } catch (e) {} });
const GID_OF = { tickets: TABS.tickets, customers: TABS.customers, csat: TABS.csat };
// Partial-table answers go stale after every batch; full-table answers (key ends in |F) stay.
function dropPartial(name) {
  const pre = SHEET_ID + '|' + GID_OF[name] + '|';
  [...cache.keys()].forEach(k => { if (k.startsWith(pre) && !k.endsWith('|F')) cache.delete(k); });
}
function driveSets() {
  if (!setsP) setsP = (async () => { CSV = CSV || await import('./gxcsv.js?v=2026-10-19d'); const s = await CSV.listSets(CSV_FOLDER, DRIVE_AUTH); CSV.pruneCache([].concat(s.tickets, s.customers, s.wo, s.csat, s.churn || [])); return s; })()
    .catch(e => { setsP = null; csvInfo.error = e.message; throw e; });
  return setsP;
}
// Table for one dataset, or null when the folder has no files for it. Files load one at a time:
// the default promise resolves after the first file (the table keeps growing in place);
// full = true waits for every file.
let fullP = {};
function csvSet(name, full) {
  if (!setP[name]) {
    let first, fail;
    const fp = new Promise((a, b) => { first = a; fail = b; });
    fp.catch(() => {});
    const all = (async () => {
      const sets = await driveSets(), files = sets[name];
      if (!files.length) { first(null); return null; }
      csvInfo.sets[name] = { files: 0, total: files.length, rows: 0, done: false };
      csvSummary();
      csvEmit({ name, done: 0, total: files.length, rows: 0, complete: false });
      return CSV.loadSet(files, DRIVE_AUTH, null, T => {
        csvInfo.sets[name] = { files: T.done, total: T.total, rows: T.rows.length, done: T.complete };
        csvInfo.phase = 'loaded ' + T.done + '/' + T.total + ' ' + SET_LABEL[name];
        dropPartial(name); csvSummary();
        first(T);
        csvEmit({ name, done: T.done, total: T.total, rows: T.rows.length, complete: T.complete });
      });
    })();
    all.catch(e => { fail(e); if (setP[name] === fp) { delete setP[name]; delete fullP[name]; } csvInfo.error = e.message; csvEmit({ name, error: e.message }); });
    setP[name] = fp; fullP[name] = all;
  }
  return full ? fullP[name] : setP[name];
}
// Work-order CSV table, or null (no files / unreachable) so callers use ticket column AC.
// Churn Model outputs: the file list of the Drive set and a reader for one file (CSV text or JSON).
export async function churnFiles() {
  if (!CSV_FOLDER) return { files: [], error: 'No Drive CSV folder configured.' };
  try { const s = await driveSets(); return { files: s.churn || [] }; }
  catch (e) { return { files: [], error: e.message }; }
}
export async function driveFileText(f) { CSV = CSV || await import('./gxcsv.js?v=2026-10-19d'); return CSV.fileText(f, DRIVE_AUTH); }
export async function parseCsvText(text) { CSV = CSV || await import('./gxcsv.js?v=2026-10-19d'); return CSV.parseCSV(text); }
export async function woTable() {
  if (!CSV_FOLDER || csvFailed.wo) return null;
  try { return await csvSet('wo', true); } catch (e) { csvFailed.wo = true; console.warn('Work order CSV unavailable:', e.message); return null; }
}
export async function woQuery(tq) {
  const t = await woTable(); if (!t) return null;
  const key = 'wo|' + tq; if (cache.has(key)) return cache.get(key);
  stats.queries++;
  const out = CSV.runQuery(t, tq); cache.set(key, out); return out;
}
export const stats = { queries: 0, bytes: 0, lastSync: null };

/* ---------- secure access via Apps Script proxy ----------
   The sheet itself stays "Restricted". Queries go through a Google Apps Script
   web app that runs as the sheet owner and only answers requests carrying a
   valid access key. The key is checked on Google's side and is never stored
   in this public code — each viewer types it once and it is kept in their own
   browser. Open the dashboard with ?logout to forget the key on this browser.
   Leave PROXY_URL empty to fall back to reading a public sheet directly. */
const PROXY_URL = 'https://script.google.com/macros/s/AKfycbweJLkjh789z2UXN9kI1qOlhfL1Lyr2UZgcNoqi2toYCqHNcqCaUeSfK13IsDukv8df/exec';
const KEY_STORE = 'gx-access-key';
const useProxy = () => /^https:\/\/script\.google\.com\//.test(PROXY_URL);

function readKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return memKey; } }
function saveKey(k) { memKey = k; try { localStorage.setItem(KEY_STORE, k); } catch (e) {} }
export function forgetKey() { memKey = ''; try { localStorage.removeItem(KEY_STORE); } catch (e) {} }
let memKey = '';
let keyPrompt = null;
try { if (/[?&]logout\b/.test(location.search)) forgetKey(); } catch (e) {}

function askKey(message) {
  if (keyPrompt) return keyPrompt;
  keyPrompt = new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif');
    wrap.innerHTML = `
      <form style="background:#fff;color:#0f172a;border-radius:16px;padding:28px 24px;width:100%;max-width:380px;box-shadow:0 20px 50px rgba(0,0,0,.25)">
        <div style="font-size:18px;font-weight:600;margin-bottom:6px">CX Intelligence</div>
        <div style="font-size:14px;color:#475569;margin-bottom:18px">${message}</div>
        <input type="password" autocomplete="current-password" placeholder="Access key" required
          style="width:100%;box-sizing:border-box;font-size:15px;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;outline:none">
        <button type="submit" style="margin-top:14px;width:100%;font-size:15px;font-weight:600;padding:11px;border:0;border-radius:10px;background:#0f172a;color:#fff;cursor:pointer">Open dashboard</button>
      </form>`;
    const form = wrap.querySelector('form'), input = wrap.querySelector('input');
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const k = input.value.trim();
      if (!k) return;
      saveKey(k); wrap.remove(); keyPrompt = null; resolve(k);
    });
    document.body.appendChild(wrap);
    setTimeout(() => input.focus(), 0);
  });
  return keyPrompt;
}

async function fetchProxy(gid, tq, retry = true, tries = 0) {
  let k = readKey();
  if (!k) k = await askKey('Enter your access key to load the data.');
  const url = `${PROXY_URL}?gid=${encodeURIComponent(gid)}&tq=${encodeURIComponent(tq)}&key=${encodeURIComponent(k)}`;
  let res;
  // Apps Script drops some large requests ("Load failed" / HTTP 5xx): retry up to 3 times with a growing pause.
  try { res = await fetch(url); } catch (e) { if (tries < 3) { await new Promise(r => setTimeout(r, 1500 * (tries + 1))); return fetchProxy(gid, tq, retry, tries + 1); } throw e; }
  if (res.status >= 500 && tries < 3) { await new Promise(r => setTimeout(r, 1500 * (tries + 1))); return fetchProxy(gid, tq, retry, tries + 1); }
  if (!res.ok) throw new Error('Data request failed (HTTP ' + res.status + ')');
  const text = await res.text();
  if (text.indexOf('"UNAUTHORIZED"') !== -1) {
    forgetKey();
    if (!retry) throw new Error('Access key rejected');
    await askKey('That access key was not accepted. Please try again.');
    return fetchProxy(gid, tq, false);
  }
  return text;
}

// full = true answers from the complete dataset (waits for every CSV file); otherwise from what has loaded so far.
export async function gviz(gid, tq, full) {
  const key = SHEET_ID + '|' + gid + '|' + tq + (full ? '|F' : '');
  if (cache.has(key)) return cache.get(key);
  const setName = SET_OF[String(gid)];
  if (CSV_FOLDER && setName && setName !== 'wo' && !csvFailed[setName]) {
    let t = null;
    try { t = await csvSet(setName, full); }
    catch (e) { csvFailed[setName] = true; console.warn(setName + ' CSV unavailable, reading the sheet instead:', e.message); }
    if (t) {
      stats.queries++;
      const out = CSV.runQuery(t, tq);
      cache.set(key, out);
      return out;
    }
  }
  let text;
  if (useProxy()) {
    text = await fetchProxy(gid, tq);
  } else {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}&tq=${encodeURIComponent(tq)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Sheet request failed (HTTP ' + res.status + ')');
    text = await res.text();
  }
  stats.queries++; stats.bytes += text.length;
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  let json;
  try { json = JSON.parse(text.slice(s, e + 1)); }
  catch (err) { throw new Error('Could not read the data response — check the Apps Script deployment.'); }
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
  // Text dates are always dd/mm/yyyy (1–2 digit day/month, / - or . separator, optional time).
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const dt = new Date(+m[3], mo - 1, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return dt.getDate() === d ? dt : null;
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
    c.push(ticketDateTyped ? `year(D) = ${+yyyy} and month(D) = ${+mm - 1}` : `D matches '^[0-9]{1,2}[/.-]0?${+mm}[/.-]${yyyy}( .*)?$'`);
  }
  if (branch && branch !== 'all') c.push(`C = '${esc(branch)}'`);
  if (extra) c.push(extra);
  return c.length ? ' where ' + c.join(' and ') : '';
}
const W = (period, branch, extra) => ticketWhere(period, branch, extra);
// Work-order CSV filters: period by Date of Work (Y), or WO Created (H) when not yet worked.
const WO_LIVE = "F <> 'Cancelled' and F <> 'Canceled'";
function woWhere(period, branch, extra) {
  const c = [];
  if (period && period !== 'all') {
    const [mm, yyyy] = period.split('/'), re = `'^[0-9]{1,2}[/.-]0?${+mm}[/.-]${yyyy}( .*)?$'`;
    c.push(`(Y matches ${re} or ((Y is null or Y = '-') and H matches ${re}))`);
  }
  if (branch && branch !== 'all') c.push(`C = '${esc(branch)}'`);
  if (extra) c.push(extra);
  return c.length ? ' where ' + c.join(' and ') : '';
}
async function woCount(where) { const r = await woQuery('select count(B)' + where); return r ? num(r.rows[0] && r.rows[0][0]) : null; }

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
  const [days, , branches, csatMonths] = await Promise.all([
    gviz(TABS.tickets, 'select D, count(B) group by D'),
    detectTypedCols(),
    gviz(TABS.tickets, 'select C, count(B) group by C order by count(B) desc'),
    // Every dataset contributes its months, so a newly uploaded month shows up in the picker
    // as soon as any one source has it (CSAT survey date, customer start/termination, WO created).
    Promise.all([
      gviz(TABS.csat, 'select year(S), month(S), count(G) group by year(S), month(S)'),
      gviz(TABS.customers, 'select year(J), month(J), count(E) group by year(J), month(J)'),
      gviz(TABS.customers, "select year(L), month(L), count(E) where G = 'Termination' group by year(L), month(L)"),
      woQuery('select year(H), month(H), count(B) group by year(H), month(H)'),
    ].map(p => Promise.resolve(p).catch(() => null))).then(rs => ({ rows: rs.flatMap(r => (r && r.rows) || []) })),
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
  // Months that exist in other datasets but not (yet) in tickets still get a period.
  csatMonths.rows.forEach(([y, m]) => {
    if (y == null || m == null) return;
    const key = String(num(m) + 1).padStart(2, '0') + '/' + num(y);
    if (num(y) * 12 + num(m) + 1 <= nowKey && !byPeriod.has(key)) byPeriod.set(key, 0);
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

export async function loadComplaintTop(period, branch) {
  const w = W(period, branch, "O = 'Complaint'");
  const [total, category, problem] = await Promise.all([count(w), grouped('P', w, 5), grouped('Q', w, 5)]);
  return { total, category, problem };
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
  // WWR / WCM come from the work-order CSV files when present (more complete than ticket column AC).
  let woN = wo, woSrc = 'tickets';
  if (await woTable()) {
    woSrc = 'wo';
    for (let i = 0; i < WO_TYPES.length; i++) {
      const c = WO_TYPES[i].code; if (c !== 'WWR' && c !== 'WCM') continue;
      const [v, via] = await Promise.all([woCount(woWhere(period, branch, `B starts with '${c}' and ${WO_LIVE}`)), woCount(woWhere(period, branch, `B starts with '${c}' and ${WO_LIVE} and J is not null and J <> '-'`))]);
      woN += v - rest[i * 2]; rest[i * 2] = v; rest[i * 2 + 1] = via;
    }
  }
  const woTypes = WO_TYPES.map((t, i) => {
    const value = rest[i * 2], viaCtso = rest[i * 2 + 1];
    return { ...t, value, viaCtso, direct: value - viaCtso, share: pct(value, woN), src: woSrc === 'wo' && (t.code === 'WWR' || t.code === 'WCM') ? 'wo' : 'tickets' };
  });
  const [ctsoAgents, woByCategory] = await Promise.all([
    gviz(TABS.tickets, `select N, count(B)${W(period, branch, namedCtso)} group by N order by count(B) desc limit 15`),
    gviz(TABS.tickets, `select P, count(B)${W(period, branch, hasWO)} group by P order by count(B) desc limit 10`),
  ]);
  return {
    total, sent, named, unassigned: sent - named, wo: woN, woSrc,
    sentShare: pct(sent, total), namedShare: pct(named, total), woShare: pct(woN, total),
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
  // WWR / WCM from the work-order CSV files when present; WGM stays on ticket column AC.
  const fromWo = !!(await woTable());
  let liveRows = live.rows, killedRows = killed.rows;
  if (fromWo) {
    const isWo = "(B starts with 'WWR' or B starts with 'WCM') and L is not null";
    const [wl, wk] = await Promise.all([
      woQuery(`select L, B${woWhere(period, branch, isWo + ' and ' + WO_LIVE)}`),
      woQuery(`select B${woWhere(period, branch, isWo + " and (F = 'Cancelled' or F = 'Canceled')")}`),
    ]);
    const cidOf = v => String(v || '').replace(/\D/g, '');
    liveRows = live.rows.filter(r => code(r[1]) === 'WGM').concat(wl.rows.map(([l, b]) => [cidOf(l), b]));
    killedRows = killed.rows.filter(r => code(r[0]) === 'WGM').concat(wk.rows);
  }
  liveRows.forEach(([f, ac]) => {
    const c = code(ac);
    if (!REPEAT_WO.includes(c)) return;
    woTotal++;
    const cid = String(f);
    const e = byCid.get(cid) || { cid, value: 0, WWR: 0, WCM: 0, WGM: 0 };
    e.value++; e[c]++;
    byCid.set(cid, e);
  });
  const cancelled = killedRows.filter(r => REPEAT_WO.includes(code(r[0]))).length;
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
    byType, mixedFault, fromWo,
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

/* Customer segment. Accounts whose Price Plan (N) contains "Intracity" are not
   retail customers: they are reported on their own page and left out of retail. */
const SEG_WHERE = {
  retail: "(N is null or not lower(N) contains 'intracity')",
  intracity: "lower(N) contains 'intracity'",
};
const segW = (seg, extra) => {
  const parts = [SEG_WHERE[seg], extra].filter(Boolean);
  return parts.length ? ' where ' + parts.join(' and ') : '';
};
const inSeg = (seg, plan) => !SEG_WHERE[seg] ? true : (seg === 'intracity') === /intracity/i.test(String(plan || ''));

export async function loadGrowth(seg = 'retail') {
  const [status, starts, terms, product, area, price] = await Promise.all([
    gviz(TABS.customers, 'select C, G, count(E)' + segW(seg) + ' group by C, G'),
    gviz(TABS.customers, 'select J, C, count(E)' + segW(seg) + ' group by J, C'),
    gviz(TABS.customers, "select year(L), month(L), C, count(E)" + segW(seg, "G = 'Termination'") + " group by year(L), month(L), C"),
    gviz(TABS.customers, "select M, count(E)" + segW(seg, "G = 'Active'") + " group by M order by count(E) desc limit 10"),
    gviz(TABS.customers, "select H, count(E)" + segW(seg, "G = 'Active'") + " group by H order by count(E) desc limit 12"),
    gviz(TABS.customers, "select N, count(E)" + segW(seg, "G = 'Active'") + " group by N order by count(E) desc limit 10"),
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
  // Every month (not only the 18-month window), so the period picker can show new/terminated for any month.
  const byMonth = {};
  const put = (r, k) => { const key = String(r.m + 1).padStart(2, '0') + '/' + r.y; const e = byMonth[key] || (byMonth[key] = { added: 0, lost: 0, byBranch: {} });
    e[k] += r.n; const b = e.byBranch[r.branch] || (e.byBranch[r.branch] = { added: 0, lost: 0 }); b[k] += r.n; };
  startRows.forEach(r => put(r, 'added')); termRows.forEach(r => put(r, 'lost'));
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
    totalRecords, branches: perBranch, byMonth,
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
export async function loadBlocked(seg = 'retail') {
  const r = await gviz(TABS.customers, "select K, L, O, P, count(E), A, C" + segW(seg, "G = 'Blocked'") + " group by K, L, O, P, A, C");
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
    byMonth: Object.fromEntries([...monthly.values()].map(x => [x.mk, x.accounts])),
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

export async function runSwapAnalysis(onProgress, seg = 'retail') {
  const CHUNK = 20000;
  const rows = [];
  let scanned = 0;
  for (let offset = 0; ; offset += CHUNK) {
    const r = await gviz(TABS.customers, `select I, G, A, W, C, J, L, N, K limit ${CHUNK} offset ${offset}`, true);
    rows.push(...r.rows.filter(x => inSeg(seg, x[7])));
    scanned += r.rows.length;
    if (onProgress) onProgress(scanned);
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
  rows.forEach(([coord, status, name, phone, branch, start], idx) => {
    if (!isLive(status)) return;
    const ck = coordKey(coord);
    const rec = { idx, name: norm(name), phone: phoneKey(phone), branch: String(branch || ''), coord: ck, start: parseAnyDate(start) };
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
  const realByMonth = {};
  const cls = [];
  const replacementIdx = new Set();

  rows.forEach(([coord, status, name, phone, branch, , term], idx) => {
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
        swaps++; cls[idx] = 'swap'; replacementIdx.add(match.idx);
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
      relocations++; cls[idx] = 'reloc'; replacementIdx.add(moved.idx);
      relocByBranch.set(bk, (relocByBranch.get(bk) || 0) + 1);
      if (relocSamples.length < 8) relocSamples.push({
        name: String(name || ''), branch: bk.replace(/^GlobalXtreme\s*/, ''),
        from: ck || '—', to: moved.coord,
        gap: termDate && moved.start ? Math.round((moved.start - termDate) / DAY) : null,
      });
      return;
    }
    cls[idx] = 'other';
    if (!termDate) undatedTerm++;
    if (ck && liveAtCoord.get(ck)) sameCoordDiffId++;
  });

  /* 12-month cohort. Opening base is counted directly: every account started
     before the window and not terminated before it. Terminations inside the
     window are bridged to true churn: − swaps − relocations − backlog (grace
     ended before the window, so the customer was already lost earlier). New
     accounts are split into replacements (the live side of a swap or
     relocation) and reactivations (same name/phone had an account terminated
     more than RELOCATION_WINDOW days before this start). */
  const mkOf = dt => dt ? dt.getFullYear() * 12 + dt.getMonth() : null;
  const nowMk = mkOf(new Date());
  let latest = -Infinity;
  rows.forEach(r => { const m = mkOf(parseAnyDate(r[5])); if (m != null && m <= nowMk && m > latest) latest = m; });
  if (!isFinite(latest)) latest = nowMk;
  const ws = latest - 11;
  const isTerm = st => /^termination$/i.test(String(st || ''));
  const isEnded = st => isTerm(st) || /^change\s*(of\s*)?ownership$/i.test(String(st || ''));
  const termsById = new Map();
  rows.forEach(r => {
    if (!isTerm(r[1])) return;
    const dt = parseAnyDate(r[6]); if (!dt) return;
    [norm(r[2]) && 'n:' + norm(r[2]), phoneKey(r[3]) && 'p:' + phoneKey(r[3])].filter(Boolean).forEach(k => {
      if (!termsById.has(k)) termsById.set(k, []);
      termsById.get(k).push(dt);
    });
  });
  const blank = () => ({ opening: 0, added: 0, replacement: 0, reactivated: 0, terminated: 0, swaps: 0, relocations: 0, backlog: 0, churn: 0 });
  const tot = blank(), perB = new Map();
  const add = (bk, k) => {
    tot[k]++;
    const lb = bk.replace(/^GlobalXtreme\s*/, '');
    if (!perB.has(lb)) perB.set(lb, blank());
    perB.get(lb)[k]++;
  };
  rows.forEach((r, idx) => {
    const [, status, name, phone, branch, start, term, , grace] = r;
    const bk = String(branch || 'Unknown');
    const sd = parseAnyDate(start), smk = mkOf(sd);
    const td = parseAnyDate(term), tmk = mkOf(td);
    if (smk != null && smk < ws && !(isEnded(status) && (tmk == null || tmk < ws))) add(bk, 'opening');
    if (smk != null && smk >= ws && smk <= latest) {
      add(bk, 'added');
      if (replacementIdx.has(idx)) add(bk, 'replacement');
      else {
        const prev = [norm(name) && 'n:' + norm(name), phoneKey(phone) && 'p:' + phoneKey(phone)].filter(Boolean)
          .flatMap(k => termsById.get(k) || []);
        if (prev.some(p => p < sd - RELOCATION_WINDOW * DAY)) add(bk, 'reactivated');
      }
    }
    if (!isTerm(status) || tmk == null) return;
    const inWin = tmk >= ws && tmk <= latest;
    const gd = parseAnyDate(grace);
    const backlog = cls[idx] === 'other' && inWin && gd && mkOf(gd) < ws;
    if (cls[idx] === 'other' && !backlog) realByMonth[tmk] = (realByMonth[tmk] || 0) + 1;
    if (!inWin) return;
    add(bk, 'terminated');
    if (cls[idx] === 'swap') add(bk, 'swaps');
    else if (cls[idx] === 'reloc') add(bk, 'relocations');
    else if (backlog) add(bk, 'backlog');
    else add(bk, 'churn');
  });
  const cohort = {
    windowStart: ws, latest,
    startLabel: MON3[ws % 12] + ' ' + Math.floor(ws / 12),
    windowLabel: MON3[ws % 12] + " '" + String(Math.floor(ws / 12)).slice(2) + ' – ' + MON3[latest % 12] + " '" + String(Math.floor(latest / 12)).slice(2),
    total: tot,
    branches: [...perB.entries()].map(([label, v]) => ({ label, ...v })),
  };

  const realChurn = terminations - swaps - relocations;
  return {
    cohort,
    scanned: rows.length, terminations, swaps, relocations, changeOwnership, undatedTerm,
    realChurn, realByMonth,
    relocationShare: pct(relocations, terminations),
    realChurnShare: pct(realChurn, terminations),
    relocByBranch: [...relocByBranch.entries()].map(([key, value]) => ({ key: key.replace(/^GlobalXtreme\s*/, ''), value })).sort((a, b) => b.value - a.value),
    relocSamples, window: RELOCATION_WINDOW,
    swapShare: pct(swaps, terminations), sameCoordDiffId, invalid,
    byBranch: [...byBranch.entries()].map(([key, value]) => ({ key: key.replace(/^GlobalXtreme\s*/, ''), value })).sort((a, b) => b.value - a.value),
    samples,
  };
}

/* ---------- period comparison ----------
   Week = last 7 complete days vs the 7 before. Month and year compare the same
   calendar days (month-to-date, year-to-date) so a partial month is never set
   against a full one. Today is excluded because it is still being logged. */
export async function loadTrends(branch) {
  const [daily, mass, wo, csat] = await Promise.all([
    gviz(TABS.tickets, `select D, O, count(B)${W('all', branch)} group by D, O`),
    gviz(TABS.tickets, `select D, count(B)${W('all', branch, "Q = 'Mass-Problem'")} group by D`),
    gviz(TABS.tickets, `select D, count(B)${W('all', branch, "AC is not null and AC <> '-'")} group by D`),
    gviz(TABS.csat, 'select year(S), month(S), day(S), C, count(G) group by year(S), month(S), day(S), C'),
  ]);
  const F = ['tickets', 'complaints', 'mass', 'wo', 'csatN', 'csatTop2', 'csatScore'];
  const day = new Map();
  const at = k => { let e = day.get(k); if (!e) { e = {}; F.forEach(f => { e[f] = 0; }); day.set(k, e); } return e; };
  const dk = v => { const d = parseDMY(v); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null; };
  daily.rows.forEach(([d, o, n]) => { const k = dk(d); if (k == null) return; const e = at(k); e.tickets += num(n); if (o === 'Complaint') e.complaints += num(n); });
  mass.rows.forEach(([d, n]) => { const k = dk(d); if (k != null) at(k).mass += num(n); });
  wo.rows.forEach(([d, n]) => { const k = dk(d); if (k != null) at(k).wo += num(n); });
  csat.rows.forEach(([y, m, d, r, n]) => {
    if (y == null || r == null) return;
    const e = at(new Date(num(y), num(m), num(d)).getTime()), c = num(n);
    e.csatN += c; e.csatScore += c * num(r); if (num(r) >= 4) e.csatTop2 += c;
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tDays = [...day.entries()].filter(([k, e]) => e.tickets && k < today.getTime()).map(([k]) => k);
  if (!tDays.length) return { empty: true };
  const first = Math.min(...tDays);
  const ref = new Date(Math.max(...tDays));
  const y = ref.getFullYear(), m = ref.getMonth(), d = ref.getDate();
  const clamp = (yy, mm, dd) => new Date(yy, mm, Math.min(dd, new Date(yy, mm + 1, 0).getDate()));
  const win = (from, to) => {
    const s = { from, to, covered: from.getTime() >= first };
    F.forEach(f => { s[f] = 0; });
    day.forEach((e, k) => { if (k >= from.getTime() && k <= to.getTime()) F.forEach(f => { s[f] += e[f]; }); });
    return s;
  };
  return {
    ref, first: new Date(first),
    week: win(new Date(y, m, d - 6), ref), prevWeek: win(new Date(y, m, d - 13), new Date(y, m, d - 7)),
    mtd: win(new Date(y, m, 1), ref), prevMtd: win(new Date(y, m - 1, 1), clamp(y, m - 1, d)), lyMtd: win(new Date(y - 1, m, 1), clamp(y - 1, m, d)),
    ytd: win(new Date(y, 0, 1), ref), lyYtd: win(new Date(y - 1, 0, 1), clamp(y - 1, m, d)),
  };
}

/* ---------- customer map ----------
   Coordinates (I) are "lat, lng" text. Only Active, Blocked and Terminated
   accounts are plotted; other statuses are transitional. Rows are pulled in
   parallel 20k chunks to keep each gviz response small. */
export const MAP_STATUS = [
  { key: 'Active', color: '#2E7D4F' },
  { key: 'Blocked', color: '#D09A1C' },
  { key: 'Terminated', color: '#B23A2E' },
];
const PRODUCT_COLORS = { 'Lite': '#2F5D8A', 'Lite+': '#7A5AA6', 'Signature': '#C2410C', 'Dedicated Internet Access': '#1F1F1D', 'Intracity': '#138A8A' };
const PRODUCT_EXTRA = ['#8A6D3B', '#5F7F2E', '#A03E6E', '#6B6B66'];

export async function loadMap() {
  const where = " where G = 'Active' or G = 'Blocked' or G = 'Termination' or G = 'Termination in Progress'";
  const STEP = 20000;
  const get = k => gviz(TABS.customers, `select F, G, I, M, C, E, A, H, N, J, K, L, O, P${where} limit ${STEP} offset ${k * STEP}`, true).then(r => r.rows);
  const wdP = loadWiredown();
  const chunks = [];
  for (let k = 0; k < 6; k += 2) chunks.push(...await Promise.all([k, k + 1].map(get)));
  for (let k = chunks.length; chunks[k - 1].length === STEP; k++) chunks.push(await get(k));
  const rows = chunks.flat();
  const stIdx = g => g === 'Active' ? 0 : g === 'Blocked' ? 1 : 2;
  const prodMap = new Map(), brMap = new Map();
  const idx = (map, v) => { if (!map.has(v)) map.set(v, map.size); return map.get(v); };
  const n = rows.length;
  const lat = new Float64Array(n), lng = new Float64Array(n), st = new Uint8Array(n), pr = new Uint16Array(n), br = new Uint16Array(n), cid = new Array(n), uid = new Array(n), name = new Array(n), area = new Array(n), variant = new Array(n);
  const start = new Float64Array(n), blockAt = new Float64Array(n), endAt = new Float64Array(n), mrc = new Float64Array(n);
  const ms = v => { const d = parseAnyDate(v) || parseDMY(v); return d ? d.getTime() : NaN; };
  const noCoord = [];
  let j = 0;
  rows.forEach(([f, g, coord, m, c, u, nm, ar, va, sj, gk, el, fo, dp]) => {
    const p = idx(prodMap, String(m || 'Unknown').trim() || 'Unknown');
    const b = idx(brMap, String(c || 'Unknown').replace(/^GlobalXtreme\s*/i, '').trim() || 'Unknown');
    const sIx = stIdx(String(g));
    const mm = String(coord || '').match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
    let a = mm ? parseFloat(mm[1]) : NaN, o = mm ? parseFloat(mm[2]) : NaN;
    if (Math.abs(a) > 20 && Math.abs(o) <= 20) { const t = a; a = o; o = t; }
    if (!(a > -12 && a < 7 && o > 94 && o < 142)) { noCoord.push([sIx, p, b]); return; }
    lat[j] = a; lng[j] = o; st[j] = sIx; pr[j] = p; br[j] = b; cid[j] = f; uid[j] = u; name[j] = nm; area[j] = ar; variant[j] = va;
    start[j] = ms(sj); endAt[j] = ms(el); const bk = ms(gk); blockAt[j] = isNaN(bk) ? endAt[j] : bk; mrc[j] = Math.max(0, rp(fo) - rp(dp)); j++;
  });
  // Latest non-cancelled WWR work order per CID → 0 open, 1 in progress, 2 closed.
  // Same for WCM (maintenance) → cm / cmInfo.
  const woAll = await wdP.catch(() => ({ WWR: new Map(), WCM: new Map() }));
  const wdBy = woAll.WWR, cmBy = woAll.WCM;
  const wd = new Int8Array(j).fill(-1), wdInfo = new Array(j), cm = new Int8Array(j).fill(-1), cmInfo = new Array(j);
  let wdMatched = 0, cmMatched = 0;
  for (let i = 0; i < j; i++) {
    const k = String(cid[i]).replace(/\D/g, '');
    const w = wdBy.get(k); if (w) { wd[i] = w.state; wdInfo[i] = w; wdMatched++; }
    const c = cmBy.get(k); if (c) { cm[i] = c.state; cmInfo[i] = c; cmMatched++; }
  }
  // Every WWR / WCM work order with its date, tied to a plotted point (for period counts by area).
  const ptOf = new Map(); for (let i = 0; i < j; i++) ptOf.set(String(cid[i]).replace(/\D/g, ''), i);
  const evs = (woAll.events || []).filter(e => ptOf.has(e[0]));
  const wo = { n: evs.length, pt: Int32Array.from(evs, e => ptOf.get(e[0])), type: Uint8Array.from(evs, e => e[1]), t: Float64Array.from(evs, e => e[2]) };
  const products = [...prodMap.keys()].map((key, i) => ({ key, color: PRODUCT_COLORS[key] || PRODUCT_EXTRA[i % PRODUCT_EXTRA.length] }));
  return {
    start: start.subarray(0, j), blockAt: blockAt.subarray(0, j), endAt: endAt.subarray(0, j), mrc: mrc.subarray(0, j), wo,
    count: j, lat: lat.subarray(0, j), lng: lng.subarray(0, j), status: st.subarray(0, j), product: pr.subarray(0, j), branch: br.subarray(0, j), cid: cid.slice(0, j), uid: uid.slice(0, j), name: name.slice(0, j), area: area.slice(0, j), variant: variant.slice(0, j),
    wd, wdInfo, wdStatuses: WD_STATUS, wdTotal: wdBy.size, wdMatched, cm, cmInfo, cmTotal: cmBy.size, cmMatched,
    noCoord, products, branches: [...brMap.keys()], statuses: MAP_STATUS,
  };
}

export async function loadCustomerDetail(cid) {
  const r = await gviz(TABS.customers, `select A, H, N, J, L, G, C where F = ${Number(cid)} limit 1`);
  const x = r.rows[0];
  return x ? { name: x[0], area: x[1], variant: x[2], start: x[3], expiry: x[4], status: x[5], branch: x[6] } : null;
}

/* Look up one account by CID or UID, for accounts the map could not plot. */
export async function findCustomer(q) {
  const s = String(q).trim().replace(/'/g, '');
  const w = /^\d+$/.test(s) ? `F = ${s}` : `lower(E) = '${s.toLowerCase()}'`;
  const r = await gviz(TABS.customers, `select A, F, E, G, I where ${w} limit 1`);
  const x = r.rows[0];
  return x ? { name: x[0], cid: x[1], uid: x[2], status: x[3], coord: x[4] } : null;
}

export const WD_STATUS = [
  { key: 'Open', color: '#D9480F' },
  { key: 'In progress', color: '#1C64B4' },
  { key: 'Closed', color: '#6B6B66' },
];
async function loadWiredown() {
  if (await woTable()) return loadWiredownCsv();
  const r = await gviz(TABS.tickets, "select F, AC, AD, D, G, P, Q where (AC starts with 'WWR' or AC starts with 'WCM') and AD <> 'Canceled' and F is not null limit 240000");
  const state = s => { const v = String(s || '').toLowerCase(); return /closed/.test(v) ? 2 : /progress/.test(v) ? 1 : 0; };
  const out = { WWR: new Map(), WCM: new Map(), events: [] };
  r.rows.forEach(([f, wo, st, dt, pr, ca, pb]) => {
    const k = String(f).replace(/\D/g, ''); if (!k) return;
    const ty = String(wo || '').slice(0, 3).toUpperCase(), by = out[ty]; if (!by) return;
    const t = (parseDMY(dt) || new Date(0)).getTime(), s = state(st);
    out.events.push([k, ty === 'WWR' ? 0 : 1, t]);
    const e = by.get(k);
    // prio / cat / prob: ticket priority (G), category (P) and problem (Q) of that work order, for the dispatch planner.
    if (!e) { by.set(k, { state: s, wo, raw: st, t, n: 1, prio: pr || '', cat: ca || '', prob: pb || '' }); return; }
    e.n++;
    if (t > e.t || (t === e.t && s < e.state)) Object.assign(e, { state: s, wo, raw: st, t, prio: pr || '', cat: ca || '', prob: pb || '' });
  });
  return out;
}

// Same shape as loadWiredown, from the work-order CSV files. t = WO Created (H) for
// aging; events use Date of Work (Y), falling back to WO Created.
async function loadWiredownCsv() {
  const r = await woQuery("select L, B, F, H, T, R, S, Y where (B starts with 'WWR' or B starts with 'WCM') and " + WO_LIVE + " and L is not null");
  const state = s => { const v = String(s || '').toLowerCase(); return /closed/.test(v) ? 2 : /progress|started|checked|pending/.test(v) ? 1 : 0; };
  const out = { WWR: new Map(), WCM: new Map(), events: [], src: 'wo' };
  r.rows.forEach(([l, wo, st, cr, pr, an, so, dw]) => {
    const k = String(l).replace(/\D/g, ''); if (!k) return;
    const ty = String(wo || '').slice(0, 3).toUpperCase(), by = out[ty]; if (!by) return;
    const t = (parseDMY(cr) || new Date(0)).getTime(), s = state(st);
    const ev = parseDMY(dw); out.events.push([k, ty === 'WWR' ? 0 : 1, ev ? ev.getTime() : t]);
    const e = by.get(k);
    if (!e) { by.set(k, { state: s, wo, raw: st, t, n: 1, prio: pr || '', cat: an || '', prob: so || '' }); return; }
    e.n++;
    if (t > e.t || (t === e.t && s < e.state)) Object.assign(e, { state: s, wo, raw: st, t, prio: pr || '', cat: an || '', prob: so || '' });
  });
  return out;
}

/* Work orders for one day with a technician column, for travel-time analysis. */
export async function loadFieldWOs(day, techCol) {
  const col = String(techCol).trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!col) return [];
  const p = n => String(n).padStart(2, '0');
  const dmy = p(day.getDate()) + '/' + p(day.getMonth() + 1) + '/' + day.getFullYear();
  const ymd = (x) => x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
  const sel = `select D, F, AC, AD, ${col} where AC is not null and AC <> '-' and AD <> 'Canceled' and ${col} is not null and `;
  let r;
  try { r = await gviz(TABS.tickets, sel + `D contains '${dmy}'`); }
  catch (e) { r = await gviz(TABS.tickets, sel + `D >= date '${ymd(day)}' and D < date '${ymd(new Date(day.getTime() + 86400e3))}'`); }
  return r.rows.map(([dt, cid, wo, st, tech]) => {
    const t = parseDMY(dt);
    return { wo, type: String(wo).slice(0, 3), cid, status: st, tech, dispatch: t ? t.getTime() : day.getTime() };
  });
}


/* ---------- executive summary ---------- */

const blankCol = col => typedCols.has(col) ? `${col} is null` : `(${col} is null or ${col} = '-')`;

// Ticket routing: resolved by CSO (no CTSO, no WO), work order straight from CSO, escalated to CTSO (± WO).
export async function loadFlow(period, branch) {
  const ctso = filled('T'), noCtso = blankCol('T'), wo = "AC is not null and AC <> '-'", noWo = "(AC is null or AC = '-')";
  const [total, sent, cso, direct, viaCtso] = await Promise.all([
    count(W(period, branch)),
    count(W(period, branch, ctso)),
    count(W(period, branch, noCtso + ' and ' + noWo)),
    count(W(period, branch, noCtso + ' and ' + wo)),
    count(W(period, branch, ctso + ' and ' + wo)),
  ]);
  return { total, sent, cso, direct, viaCtso, ctsoClosed: sent - viaCtso, woFromTickets: direct + viaCtso };
}

export async function loadInquiryTop(period, branch) {
  const w = W(period, branch, "O <> 'Complaint'");
  const [total, category, problem] = await Promise.all([count(w), grouped('P', w, 5), grouped('Q', w, 5)]);
  return { total, category, problem };
}

// Blocked-account payments handled by CS: reactivation / post-payment confirmation tickets.
export async function loadCollected(period, branch) {
  const w = W(period, branch, "(lower(Q) contains 'reactivat' or lower(Q) contains 'post payment' or lower(Q) contains 'payment confirm')");
  const [total, byProblem, cids] = await Promise.all([count(w), grouped('Q', w, 6), gviz(TABS.tickets, 'select F, count(B)' + w + ' group by F')]);
  return { total, byProblem, accounts: cids.rows.filter(r => r[0] != null).length };
}

// CIDs with more than one field work order (WCA excluded) in the 30 days up to the latest work order.
export async function loadRepeat30(branch) {
  const code = v => String(v || '').trim().slice(0, 3).toUpperCase();
  const cidOf = v => String(v || '').replace(/\D/g, '');
  const fromWo = !!(await woTable());
  const items = new Map();
  if (fromWo) {
    const bw = branch && branch !== 'all' ? ` and C = '${esc(branch)}'` : '';
    const r = await woQuery(`select L, B, H, Y, R, S where ${WO_LIVE} and L is not null${bw}`);
    (r ? r.rows : []).forEach(([l, b, h, y, cat, prob]) => {
      const wo = String(b || '').trim(), c = code(wo);
      if (!wo || c === 'WCA') return;
      items.set(wo, { cid: cidOf(l), wo, code: c, date: parseAnyDate(y) || parseAnyDate(h), cat: String(cat || '').trim(), prob: String(prob || '').trim() });
    });
  }
  const t = await gviz(TABS.tickets, `select F, AC, D, P, Q${W('all', branch, "F is not null and AC is not null and AC <> '-' and AD <> 'Canceled'")} limit 240000`);
  t.rows.forEach(([f, ac, d, p, q]) => {
    const wo = String(ac || '').trim(), c = code(wo);
    if (!wo || c === 'WCA' || items.has(wo) || (fromWo && (c === 'WWR' || c === 'WCM'))) return;
    items.set(wo, { cid: cidOf(f), wo, code: c, date: parseAnyDate(d), cat: String(p || '').trim(), prob: String(q || '').trim() });
  });
  const now = Date.now();
  const all = [...items.values()].filter(x => x.cid && x.date && x.date.getTime() <= now);
  const end = all.reduce((m, x) => Math.max(m, x.date.getTime()), 0);
  const start = end - 30 * DAY;
  const byCid = new Map();
  all.filter(x => x.date.getTime() > start).forEach(x => { if (!byCid.has(x.cid)) byCid.set(x.cid, []); byCid.get(x.cid).push(x); });
  const list = [...byCid.entries()].filter(([, v]) => v.length > 1).map(([cid, v]) => {
    v.sort((a, b) => a.date - b.date);
    const mix = {}; v.forEach(x => { mix[x.code] = (mix[x.code] || 0) + 1; });
    const cats = [...new Set(v.map(x => [x.cat, x.prob].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(' · ')).filter(Boolean))];
    return { cid, n: v.length, wos: v, mix: Object.entries(mix).map(([k, n]) => k + '×' + n).join('  '), cats, last: v[v.length - 1].date };
  }).sort((a, b) => b.n - a.n || b.last - a.last);
  return { list, cids: byCid.size, start: end ? new Date(start + DAY) : null, end: end ? new Date(end) : null, fromWo,
    woInWindow: all.filter(x => x.date.getTime() > start).length };
}

export const PKG_GROUPS = ['Lite', 'Signature', 'Dedicated'];
export const BILLING = ['Monthly', 'Quarterly', 'Semester', 'Annual'];
export const PRIORITIES = ['Low', 'Normal', 'High', 'Highest', 'VIP'];
export function pkgGroup(product, plan) {
  const s = String(product || '') + ' ' + String(plan || '');
  if (/dedicated|\bdia\b/i.test(s)) return 'Dedicated';
  if (/signature/i.test(s)) return 'Signature';
  if (/lite/i.test(s)) return 'Lite';
  return 'Other';
}
export function billingOf(plan) {
  const v = String(plan || '').toLowerCase();
  if (/annual|yearly|tahun|12 ?(bulan|month)/.test(v)) return 'Annual';
  if (/semest|6 ?(bulan|month)/.test(v)) return 'Semester';
  if (/quart|qurt|quat|qtr|3 ?(bulan|month)/.test(v)) return 'Quarterly';
  return 'Monthly';
}
export function speedOf(plan) {
  const m = String(plan || '').match(/(\d+(?:[.,]\d+)?)\s*(gbps|gb|g|mbps|mb|m)?(?![a-z])/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return /^g/i.test(m[2] || '') ? v * 1000 : v;
}
export const fmtSpeed = v => v == null ? '—' : v >= 1000 ? (v / 1000) + ' Gbps' : v + ' Mbps';
function wMedian(pairs) {
  const a = pairs.filter(p => p[1] > 0).sort((x, y) => x[0] - y[0]);
  const tot = a.reduce((s, p) => s + p[1], 0); let run = 0;
  for (const [v, n] of a) { run += n; if (run >= tot / 2) return v; }
  return null;
}

// Retail book (Intracity excluded): packages, billing, priority, ARPU by month, lifetime and per-branch stock.
export async function loadRetailBook() {
  const ret = SEG_WHERE.retail;
  const [act, life] = await Promise.all([
    gviz(TABS.customers, `select B, M, N, O, P, count(E) where G = 'Active' and ${ret} group by B, M, N, O, P`),
    gviz(TABS.customers, `select C, M, N, G, J, year(L), month(L), O, P, count(E) where ${ret} group by C, M, N, G, J, year(L), month(L), O, P`),
  ]);
  const pk = {}, pr = {};
  const pkg = k => pk[k] || (pk[k] = { key: k, n: 0, sum: 0, fees: [], speeds: {}, billing: Object.fromEntries(BILLING.map(b => [b, 0])) });
  let activeN = 0;
  act.rows.forEach(([prio, m, plan, fee, disc, cnt]) => {
    const n = num(cnt); if (!n) return;
    const net = Math.max(0, rp(fee) - rp(disc)), gk = pkgGroup(m, plan), e = pkg(gk);
    activeN += n; e.n += n; e.sum += net * n; e.fees.push([net, n]);
    const sp = speedOf(plan); if (sp != null) e.speeds[sp] = (e.speeds[sp] || 0) + n;
    e.billing[billingOf(plan)] += n;
    const pkk = String(prio || 'Unknown').trim() || 'Unknown';
    const p = pr[pkk] || (pr[pkk] = { key: pkk, n: 0, groups: {}, plans: {} });
    p.n += n; p.groups[gk] = (p.groups[gk] || 0) + n;
    const pl = String(plan || m || '—').trim(); p.plans[pl] = (p.plans[pl] || 0) + n;
  });
  const packages = Object.values(pk).sort((a, b) => (PKG_GROUPS.indexOf(a.key) + 1 || 9) - (PKG_GROUPS.indexOf(b.key) + 1 || 9)).map(e => {
    const sp = Object.entries(e.speeds).map(([k, v]) => ({ speed: +k, n: v })).sort((a, b) => b.n - a.n);
    return { key: e.key, n: e.n, share: pct(e.n, activeN), avg: e.n ? e.sum / e.n : 0, median: wMedian(e.fees), mrc: e.sum,
      speeds: sp.slice(0, 3).map(s => ({ ...s, label: fmtSpeed(s.speed), share: pct(s.n, e.n) })),
      billing: BILLING.map(b => ({ key: b, value: e.billing[b], share: pct(e.billing[b], e.n) })) };
  });
  const order = k => { const i = PRIORITIES.findIndex(p => p.toLowerCase() === k.toLowerCase()); return i < 0 ? 99 : i; };
  const priority = Object.values(pr).sort((a, b) => order(a.key) - order(b.key) || b.n - a.n).map(p => ({
    key: p.key, n: p.n, groups: p.groups,
    plans: Object.entries(p.plans).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ key: k, value: v, share: pct(v, p.n) })),
  }));

  const today = new Date(), nowMk = today.getFullYear() * 12 + today.getMonth();
  const ws = nowMk - 11;
  const skip = st => /pending|cancel|change\s*(of\s*)?ownership/i.test(String(st || ''));
  const isTerm = st => /^termination$/i.test(String(st || '').trim());
  const arpu = new Map();
  for (let mk = nowMk - 12; mk <= nowMk; mk++) arpu.set(mk, { mk, n: 0, sum: 0 });
  const br = new Map(), tot = { active: 0, blocked: 0, mrcHold: 0, lifeN: 0, lifeSum: 0, tenN: 0, tenSum: 0 };
  const bOf = k => { const l = String(k || 'Unknown').replace(/^GlobalXtreme\s*/, ''); if (!br.has(l)) br.set(l, { label: l, active: 0, blocked: 0, mrcHold: 0, lifeN: 0, lifeSum: 0, tenN: 0, tenSum: 0 }); return br.get(l); };
  life.rows.forEach(([b, m, plan, st, j, ly, lm, fee, disc, cnt]) => {
    const n = num(cnt); if (!n || skip(st)) return;
    const jd = parseAnyDate(j), smk = jd ? jd.getFullYear() * 12 + jd.getMonth() : null, tmk = ly == null ? null : num(ly) * 12 + num(lm);
    const net = Math.max(0, rp(fee) - rp(disc)), B = bOf(b), s = String(st || '').trim();
    const both = (k, v) => { B[k] += v; tot[k] += v; };
    if (/^active$/i.test(s)) { both('active', n); if (smk != null && smk <= nowMk) { both('tenN', n); both('tenSum', (nowMk - smk) * n); } }
    if (/^blocked$/i.test(s)) { both('blocked', n); both('mrcHold', net * n); }
    if (isTerm(s) && smk != null && tmk != null && tmk >= ws && tmk <= nowMk && tmk >= smk) { both('lifeN', n); both('lifeSum', (tmk - smk) * n); }
    if (pkgGroup(m, plan) === 'Dedicated' || smk == null) return;
    if (isTerm(s) && tmk == null) return;
    arpu.forEach(e => { if (smk <= e.mk && !(isTerm(s) && tmk <= e.mk)) { e.n += n; e.sum += net * n; } });
  });
  const arpuSeries = [...arpu.values()].map(e => ({ mk: e.mk, label: MON3[e.mk % 12] + " '" + String(Math.floor(e.mk / 12)).slice(2), accounts: e.n, arpu: e.n ? e.sum / e.n : 0, partial: e.mk === nowMk }));
  const fin = x => ({ ...x, lifetime: x.lifeN ? x.lifeSum / x.lifeN : null, tenure: x.tenN ? x.tenSum / x.tenN : null });
  const nonDed = packages.filter(p => p.key !== 'Dedicated');
  const nd = nonDed.reduce((s, p) => ({ n: s.n + p.n, mrc: s.mrc + p.mrc }), { n: 0, mrc: 0 });
  return { activeN, packages, priority, arpuSeries, arpuNow: nd.n ? nd.mrc / nd.n : 0, arpuNowN: nd.n,
    total: fin(tot), branches: [...br.values()].map(fin).sort((a, b) => b.active - a.active) };
}


/* AI notes through the Apps Script proxy (POST action "ai"); the Anthropic key stays in Script Properties. */
export async function aiComplete(body) {
  if (!useProxy()) throw new Error('AI notes need the Apps Script proxy.');
  let k = readKey();
  if (!k) k = await askKey('Enter your access key to load the data.');
  let res;
  try { res = await fetch(PROXY_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'ai', key: k, body }) }); }
  catch (e) { throw new Error('The Apps Script proxy did not answer the AI request. Add doPost from AI_SETUP.md, then Deploy → Manage deployments → edit → New version (keep "Who has access: Anyone").'); }
  if (!res.ok) throw new Error('AI request failed (HTTP ' + res.status + ')');
  const text = await res.text();
  let out; try { out = JSON.parse(text); } catch (e) { throw new Error('The proxy has no AI endpoint yet. Add doPost from AI_SETUP.md to the Apps Script and redeploy.'); }
  if (out.error) throw new Error(out.error === 'UNAUTHORIZED' ? 'Access key rejected' : out.error);
  return out.text || '';
}
