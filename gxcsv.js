// CSV source for the Tickets tab: loads every .csv in a Google Drive folder (through
// the Apps Script proxy), keeps rows in memory, and answers the same Visualization
// Query strings the dashboard already sends to the sheet.

/* ---------- CSV parsing ---------- */
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const nl = text.indexOf('\n'), head = text.slice(0, nl < 0 ? text.length : nl);
  const cnt = ch => head.split(ch).length;
  const sep = cnt(';') > cnt(',') ? (cnt(';') > cnt('\t') ? ';' : '\t') : (cnt('\t') > cnt(',') ? '\t' : ',');
  const rows = []; let row = [], f = '', q = false, i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '') { q = true; i++; continue; }
    if (c === sep) { row.push(f); f = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* ---------- query engine (subset of the Google Visualization Query language) ---------- */
const colIdx = s => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') { let v = ''; i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\' && i + 1 < s.length) { v += s[i + 1]; i += 2; continue; } v += s[i++]; } i++; out.push({ t: 'str', v }); continue; }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(s[i + 1]) && (!out.length || out[out.length - 1].t === 'op'))) { let v = c; i++; while (i < s.length && /[0-9.]/.test(s[i])) v += s[i++]; out.push({ t: 'num', v: +v }); continue; }
    if (/[A-Za-z_]/.test(c)) { let v = ''; while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) v += s[i++]; out.push({ t: 'id', v }); continue; }
    const two = s.slice(i, i + 2);
    if (two === '<>' || two === '!=' || two === '<=' || two === '>=') { out.push({ t: 'op', v: two === '!=' ? '<>' : two }); i += 2; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  return out;
}
const KW = new Set(['select', 'where', 'group', 'by', 'order', 'limit', 'offset', 'and', 'or', 'not', 'is', 'null', 'asc', 'desc', 'starts', 'ends', 'with', 'contains', 'matches', 'like', 'date', 'count', 'year', 'month', 'day', 'label', 'format', 'pivot', 'sum', 'min', 'max', 'avg']);

function parseDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return null;
}

function compile(tq) {
  const T = tokenize(tq); let p = 0;
  const peek = (k = 0) => T[p + k], isKw = (w, k = 0) => peek(k) && peek(k).t === 'id' && peek(k).v.toLowerCase() === w;
  const eat = w => { if (!isKw(w)) throw new Error('Expected ' + w + ' in query: ' + tq); p++; };
  const op = v => peek() && peek().t === 'op' && peek().v === v;
  function operand() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of query: ' + tq);
    if (t.t === 'str') { p++; return { k: 'lit', v: t.v }; }
    if (t.t === 'num') { p++; return { k: 'lit', v: t.v }; }
    if (t.t === 'op' && t.v === '(') { p++; const e = operand(); if (op(')')) p++; return e; }
    if (t.t === 'id') {
      const w = t.v.toLowerCase();
      if (w === 'date' && peek(1) && peek(1).t === 'str') { p += 2; return { k: 'date', v: parseDate(T[p - 1].v) }; }
      if (['count', 'year', 'month', 'day', 'sum', 'min', 'max', 'avg'].includes(w) && peek(1) && peek(1).t === 'op' && peek(1).v === '(') {
        p += 2; const a = operand(); if (op(')')) p++;
        return ['year', 'month', 'day'].includes(w) ? { k: 'fn', f: w, a } : { k: 'agg', f: w, a };
      }
      if (/^[A-Z]{1,3}$/i.test(t.v) && !KW.has(w)) { p++; return { k: 'col', i: colIdx(t.v), name: t.v.toUpperCase() }; }
      if (w === 'true' || w === 'false') { p++; return { k: 'lit', v: w === 'true' }; }
    }
    throw new Error('Unsupported query token "' + (t.v) + '" in: ' + tq);
  }
  function cond() {
    if (isKw('not')) { p++; const c = cond(); return { k: 'not', c }; }
    if (op('(')) {
      // Parenthesised boolean expression vs parenthesised operand: try boolean first.
      const save = p; p++;
      try { const e = orExpr(); if (op(')')) { p++; return e; } } catch (err) {}
      p = save;
    }
    const a = operand();
    if (isKw('is')) { p++; let neg = false; if (isKw('not')) { p++; neg = true; } eat('null'); return { k: 'null', a, neg }; }
    for (const w of ['contains', 'matches', 'like']) if (isKw(w)) { p++; return { k: w, a, b: operand() }; }
    if (isKw('starts') || isKw('ends')) { const w = peek().v.toLowerCase(); p++; eat('with'); return { k: w, a, b: operand() }; }
    const t = peek();
    if (t && t.t === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(t.v)) { p++; return { k: 'cmp', o: t.v, a, b: operand() }; }
    throw new Error('Unsupported condition in query: ' + tq);
  }
  function andExpr() { const l = [cond()]; while (isKw('and')) { p++; l.push(cond()); } return l.length === 1 ? l[0] : { k: 'and', l }; }
  function orExpr() { const l = [andExpr()]; while (isKw('or')) { p++; l.push(andExpr()); } return l.length === 1 ? l[0] : { k: 'or', l }; }
  const q = { sel: [], where: null, group: [], order: [], limit: Infinity, offset: 0 };
  if (isKw('select')) {
    p++;
    if (op('*')) { p++; q.sel = null; }
    else { do { if (op(',')) p++; q.sel.push(operand()); } while (op(',')); }
  }
  while (p < T.length) {
    if (isKw('where')) { p++; q.where = orExpr(); }
    else if (isKw('group')) { p++; eat('by'); do { if (op(',')) p++; q.group.push(operand()); } while (op(',')); }
    else if (isKw('order')) { p++; eat('by'); do { if (op(',')) p++; const x = operand(); let d = 1; if (isKw('desc')) { p++; d = -1; } else if (isKw('asc')) p++; q.order.push({ x, d }); } while (op(',')); }
    else if (isKw('limit')) { p++; q.limit = peek().v; p++; }
    else if (isKw('offset')) { p++; q.offset = peek().v; p++; }
    else if (isKw('label') || isKw('format')) break;
    else throw new Error('Unsupported query clause near "' + peek().v + '": ' + tq);
  }
  return q;
}

const cell = (r, i) => { const v = r[i]; return v === undefined || v === '' ? null : v; };
function val(e, r) {
  if (e.k === 'lit' || e.k === 'date') return e.v;
  if (e.k === 'col') return cell(r, e.i);
  if (e.k === 'fn') { const d = parseDate(val(e.a, r)); if (!d) return null; return e.f === 'year' ? d.getFullYear() : e.f === 'month' ? d.getMonth() : d.getDate(); }
  return null;
}
function cmpVals(x, y) {
  if (y instanceof Date || x instanceof Date) { const a = x instanceof Date ? x : parseDate(x), b = y instanceof Date ? y : parseDate(y); if (!a || !b) return NaN; return a - b; }
  if (typeof y === 'number' || typeof x === 'number') { const a = +x, b = +y; if (isNaN(a) || isNaN(b)) return NaN; return a - b; }
  const a = x == null ? '' : String(x), b = y == null ? '' : String(y);
  return a < b ? -1 : a > b ? 1 : 0;
}
const reCache = new Map();
const re = (s, f) => { const k = f + s; if (!reCache.has(k)) reCache.set(k, new RegExp(s, f)); return reCache.get(k); };
function test(c, r) {
  switch (c.k) {
    case 'and': for (const x of c.l) if (!test(x, r)) return false; return true;
    case 'or': for (const x of c.l) if (test(x, r)) return true; return false;
    case 'not': return !test(c.c, r);
    case 'null': { const v = val(c.a, r); return c.neg ? v != null : v == null; }
    case 'contains': { const v = val(c.a, r); return v != null && String(v).includes(String(val(c.b, r))); }
    case 'starts': { const v = val(c.a, r); return v != null && String(v).startsWith(String(val(c.b, r))); }
    case 'ends': { const v = val(c.a, r); return v != null && String(v).endsWith(String(val(c.b, r))); }
    case 'matches': { const v = val(c.a, r); return v != null && re('^(?:' + val(c.b, r) + ')$', '').test(String(v)); }
    case 'like': { const v = val(c.a, r); if (v == null) return false; const pat = String(val(c.b, r)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.'); return re('^' + pat + '$', 's').test(String(v)); }
    case 'cmp': {
      const a = val(c.a, r), b = val(c.b, r);
      if (c.o === '<>' && a == null) return b != null;
      if (c.o === '=' && a == null) return b == null || b === '';
      const d = cmpVals(a, b); if (isNaN(d)) return false;
      return c.o === '=' ? d === 0 : c.o === '<>' ? d !== 0 : c.o === '<' ? d < 0 : c.o === '<=' ? d <= 0 : c.o === '>' ? d > 0 : d >= 0;
    }
  }
  return false;
}
const label = e => e.k === 'col' ? e.name : e.k === 'agg' || e.k === 'fn' ? e.f + '(' + label(e.a) + ')' : String(e.v);
const sameExpr = (a, b) => label(a) === label(b);
const numish = v => v != null && v !== '' && !isNaN(+String(v).replace(/,/g, ''));

export function runQuery(table, tq) {
  const q = compile(tq), rows = table.rows;
  const hits = [];
  for (let i = 0; i < rows.length; i++) if (!q.where || test(q.where, rows[i])) hits.push(rows[i]);
  let sel = q.sel || Array.from({ length: table.width }, (x, i) => ({ k: 'col', i, name: String(i) }));
  const hasAgg = sel.some(e => e.k === 'agg');
  let out;
  if (hasAgg || q.group.length) {
    const groups = new Map();
    for (const r of hits) {
      const kv = q.group.map(g => val(g, r)), k = kv.map(v => v == null ? '\u0000' : String(v)).join('\u0001');
      let g = groups.get(k); if (!g) { g = { kv, rows: [] }; groups.set(k, g); }
      g.rows.push(r);
    }
    if (!q.group.length && !groups.size) groups.set('', { kv: [], rows: [] });
    out = [...groups.values()].map(g => sel.map(e => {
      if (e.k !== 'agg') { const gi = q.group.findIndex(x => sameExpr(x, e)); return gi >= 0 ? g.kv[gi] : (g.rows[0] ? val(e, g.rows[0]) : null); }
      const vs = g.rows.map(r => val(e.a, r)).filter(v => v != null);
      if (e.f === 'count') return vs.length;
      const ns = vs.map(v => +String(v).replace(/,/g, '')).filter(v => !isNaN(v));
      if (e.f === 'sum') return ns.reduce((a, b) => a + b, 0);
      if (e.f === 'avg') return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
      if (e.f === 'min') return ns.length ? Math.min(...ns) : null;
      if (e.f === 'max') return ns.length ? Math.max(...ns) : null;
      return null;
    }));
    if (!q.order.length) {
      const ks = q.group.map(g => sel.findIndex(e => sameExpr(e, g)));
      out.sort((a, b) => { for (const k of ks) { if (k < 0) continue; const x = a[k], y = b[k]; if (x === y) continue; if (x == null) return -1; if (y == null) return 1; const d = numish(x) && numish(y) ? +x - +y : String(x) < String(y) ? -1 : 1; if (d) return d; } return 0; });
    }
  } else out = hits.map(r => sel.map(e => val(e, r)));
  if (q.order.length) {
    const ks = q.order.map(o => ({ i: sel.findIndex(e => sameExpr(e, o.x)), d: o.d, x: o.x }));
    out.sort((a, b) => { for (const k of ks) { const x = k.i >= 0 ? a[k.i] : null, y = k.i >= 0 ? b[k.i] : null; if (x === y) continue; if (x == null) return -k.d; if (y == null) return k.d; const d = typeof x === 'number' && typeof y === 'number' ? x - y : numish(x) && numish(y) ? +x - +y : String(x) < String(y) ? -1 : 1; if (d) return d * k.d; } return 0; });
  }
  if (q.offset || q.limit !== Infinity) out = out.slice(q.offset, q.offset + q.limit);
  return { cols: sel.map(label), rows: out };
}

/* ---------- Drive folder loader with browser cache ---------- */
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('gx-csv', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function cacheGet(k) { try { const db = await idb(); return await new Promise(res => { const r = db.transaction('files').objectStore('files').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch (e) { return null; } }
async function cachePut(k, v) { try { const db = await idb(); await new Promise(res => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) {} }
async function cachePrune(keep) { try { const db = await idb(); const st = db.transaction('files', 'readwrite').objectStore('files'); const r = st.getAllKeys(); r.onsuccess = () => r.result.forEach(k => { if (!keep.has(k)) st.delete(k); }); } catch (e) {} }

/* Datasets in the Drive folder. Subfolders are matched by name (Tickets, Customers,
   Work Orders); CSVs in the root folder are matched by file name (WWR / WCM / WO →
   work orders, "customer" → customers, anything else → tickets). */
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export function kindOf(name, inFolder) {
  const n = String(name || '').toLowerCase();
  if (inFolder) return /work ?order|^wo\b|wwr|wcm/.test(n) ? 'wo' : /customer|pelanggan/.test(n) ? 'customers' : /ticket|tiket/.test(n) ? 'tickets' : null;
  return /^(wwr|wcm|wo)\b|work ?order/.test(n) ? 'wo' : /customer|pelanggan/.test(n) ? 'customers' : 'tickets';
}
// auth: { key } for an API key, or { token: async (renew) => accessToken } for Google sign-in.
async function driveFetch(url, auth, retry = true) {
  if (auth.key) return fetch(url + (url.includes('?') ? '&' : '?') + 'key=' + auth.key);
  const t = await auth.token(false);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 401 && retry) { await auth.token(true); return driveFetch(url, auth, false); }
  return r;
}
async function listDrive(folderId, apiKey) {
  const out = []; let tok = '';
  do {
    const u = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent("'" + folderId + "' in parents and trashed = false") + '&fields=nextPageToken,files(id,name,size,modifiedTime,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' + (tok ? '&pageToken=' + tok : '');
    const r = await driveFetch(u, apiKey); const j = await r.json();
    if (j.error) throw new Error('Google Drive: ' + (j.error.message || j.error.status) + (r.status === 403 || r.status === 404 ? (apiKey.key ? ' (is the folder shared as "Anyone with the link"?)' : ' (has this Google account been given access to the folder?)') : ''));
    (j.files || []).forEach(f => out.push({ id: f.id, name: f.name, size: +f.size || 0, updated: Date.parse(f.modifiedTime) || 0, folder: f.mimeType === FOLDER_MIME }));
    tok = j.nextPageToken || '';
  } while (tok);
  return out;
}
export async function listSets(rootId, apiKey) {
  const sets = { tickets: [], customers: [], wo: [] };
  const root = await listDrive(rootId, apiKey);
  const isCsv = f => !f.folder && /\.csv$/i.test(f.name);
  root.filter(isCsv).forEach(f => sets[kindOf(f.name, false)].push(f));
  for (const d of root.filter(f => f.folder)) {
    const k = kindOf(d.name, true); if (!k) continue;
    (await listDrive(d.id, apiKey)).filter(isCsv).forEach(f => sets[k].push(f));
  }
  Object.values(sets).forEach(l => l.sort((a, b) => a.name.localeCompare(b.name)));
  return sets;
}
// Download (or read from the browser cache) and stack the files of one dataset.
export async function loadSet(files, apiKey, onProgress) {
  let done = 0;
  const getText = async f => {
    const ck = f.id + '|' + f.updated + '|' + f.size;
    let text = await cacheGet(ck);
    if (text == null) {
      const r = await driveFetch('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media&supportsAllDrives=true', apiKey);
      if (!r.ok) throw new Error(f.name + ': Google Drive HTTP ' + r.status);
      text = await r.text();
      cachePut(ck, text);
    }
    done++; onProgress && onProgress(done, files.length);
    return text;
  };
  const texts = new Array(files.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => { while (next < files.length) { const i = next++; texts[i] = await getText(files[i]); } }));
  const rows = []; let width = 0, header = null;
  for (let i = 0; i < files.length; i++) {
    const r = parseCSV(texts[i]); texts[i] = null;
    if (!r.length) continue;
    if (!header) header = r[0];
    for (let k = 1; k < r.length; k++) { const x = r[k]; if (x.length === 1 && x[0] === '') continue; rows.push(x); if (x.length > width) width = x.length; }
  }
  return { header, rows, width, files };
}
export function pruneCache(allFiles) { cachePrune(new Set(allFiles.map(f => f.id + '|' + f.updated + '|' + f.size))); }
