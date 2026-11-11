/* CX Intelligence — users and roles for the Apps Script proxy.
 *
 * Add this file to the proxy project (Apps Script editor → + → Script, name it "roles").
 * Then rename your existing doGet to doGetData_ and your existing doPost (if any) to doPostData_.
 * Nothing inside those functions changes. See ROLE_SETUP.md for the full steps.
 *
 * Script properties used:
 *   GX_USERS     JSON list of users, written by the dashboard's Role management page. Do not edit by hand.
 *   GX_TRACK     Live tracking (Traccar) settings saved by an admin on the Tracking setup page.
 *   GX_IDS_*     The shared IDS plan (WWR and WCM), written by the dashboard. Do not edit by hand.
 *   GX_ETA_*     ETA snapshot of today's IDS plan, sent by every open IDS screen. Do not edit by hand.
 *   GX_DOTAI_KEY Secret key DotAI uses to read the ETA API (GET ?action=eta&key=...&cid=...). Set it by hand.
 *   GX_DATA_KEY  One of your existing (owner) access keys. After the role check, requests made with a
 *                user's key are passed to doGetData_ / doPostData_ with this key, so your original key
 *                check keeps working unchanged.
 */

const GX_PROP_USERS = 'GX_USERS';
const GX_PROP_DATA_KEY = 'GX_DATA_KEY';

// Sheet tabs (gid) each dashboard menu reads. A non-admin user may read only the tabs of the menus given
// to them. Tickets is always allowed: every page reads it for the period list.
const GX_GID = { tickets: '262501258', csat: '634063468', frt: '2105608606', rt: '750980381', dotai: '1364058646', human: '1567034438', customers: '1605668070' };
const GX_MENU_GIDS = {
  overview: ['tickets', 'csat', 'customers'],
  tickets: ['tickets'],
  chat: ['tickets', 'frt', 'rt', 'dotai', 'human'],
  csat: ['csat'],
  growth: ['customers'],
  intracity: ['customers'],
  churnRisk: ['customers'],
  map: ['customers', 'tickets'],
  dispatch: ['customers', 'tickets'],
  dispatchWcm: ['customers', 'tickets'],
  settings: [],
};
const GX_MENUS = Object.keys(GX_MENU_GIDS);

function gxProps_() { return PropertiesService.getScriptProperties(); }
function gxJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function gxUsers_() { try { return JSON.parse(gxProps_().getProperty(GX_PROP_USERS) || '{}') || {}; } catch (e) { return {}; } }
function gxSaveUsers_(u) { gxProps_().setProperty(GX_PROP_USERS, JSON.stringify(u)); }
function gxNewKey_() { return 'gx-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24); }
function gxFindByKey_(key) {
  const all = gxUsers_();
  for (const id in all) if (all[id] && all[id].key === key) return { id: id, u: all[id] };
  return null;
}

// Is this one of the original owner keys? Asks the original doGetData_ once with a tiny query and remembers
// the answer for 10 minutes, so it works whatever your original key check looks like.
function gxIsOwnerKey_(key) {
  const cache = CacheService.getScriptCache();
  const ck = 'gxown_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key)).slice(0, 40);
  const hit = cache.get(ck);
  if (hit) return hit === '1';
  let ok = false;
  try {
    const out = doGetData_({ parameter: { key: key, gid: GX_GID.tickets, tq: 'select B limit 1' }, parameters: { key: [key], gid: [GX_GID.tickets], tq: ['select B limit 1'] } });
    ok = String(out.getContent()).indexOf('"UNAUTHORIZED"') === -1;
  } catch (e) { ok = false; }
  cache.put(ck, ok ? '1' : '0', 600);
  return ok;
}

// Who a key belongs to: { name, role, menus } or null. Role-managed users first; any other key that the
// original proxy accepts is the owner, with full admin rights.
function gxUser_(key) {
  key = String(key || '');
  if (!key) return null;
  const hit = gxFindByKey_(key);
  if (hit) {
    const u = hit.u;
    if (u.disabled) return null;
    const admin = u.role === 'admin';
    return { name: u.name || 'User', role: admin ? 'admin' : u.role === 'viewer' ? 'viewer' : 'dispatcher', menus: admin ? '*' : (u.menus || []).filter(m => GX_MENUS.indexOf(m) !== -1), managed: true };
  }
  if (gxIsOwnerKey_(key)) return { name: 'Owner', role: 'admin', menus: '*', managed: false };
  return null;
}

function gxCanReadGid_(user, gid) {
  if (user.role === 'admin') return true;
  const allowed = { tickets: true };
  (user.menus || []).forEach(m => (GX_MENU_GIDS[m] || []).forEach(t => { allowed[t] = true; }));
  return Object.keys(allowed).some(t => GX_GID[t] === String(gid));
}

function gxDataKey_() { return gxProps_().getProperty(GX_PROP_DATA_KEY) || ''; }

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'eta') return gxEtaApi_(p);
  const user = gxUser_(p.key);
  if (p.action === 'whoami') {
    if (!user) return gxJson_({ error: 'UNAUTHORIZED' });
    return gxJson_({ gxUser: { name: user.name, role: user.role, menus: user.menus } });
  }
  if (!user) return gxJson_({ error: 'UNAUTHORIZED' });
  if (p.action === 'ids') return gxIdsGet_(user, p);
  if (p.action === 'track') return gxTrackGet_(user);
  if (p.action === 'csvls') return gxCsvList_(user, p);
  if (p.action === 'csvget') return gxCsvGet_(user, p);
  if (!gxCanReadGid_(user, p.gid)) return gxJson_({ status: 'error', errors: [{ message: 'Your account has no access to this data. Ask the dashboard admin.' }] });
  if (user.managed) {
    const dk = gxDataKey_();
    if (!dk) return gxJson_({ status: 'error', errors: [{ message: 'The proxy is missing GX_DATA_KEY. See ROLE_SETUP.md.' }] });
    e.parameter.key = dk;
    if (e.parameters) e.parameters.key = [dk];
  }
  return doGetData_(e);
}

function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { return gxJson_({ error: 'Bad request' }); }
  if (req.action === 'users') return gxUsersApi_(req);
  const user = gxUser_(req.key);
  if (!user) return gxJson_({ error: 'UNAUTHORIZED' });
  // Viewers read the IDS board and tracking; they change nothing.
  if (user.role === 'viewer' && (req.action === 'ids' || req.action === 'track' || req.action === 'ai')) return gxJson_({ error: 'View only: this account cannot change the plan.' });
  if (req.action === 'ids') return gxIdsPost_(user, req);
  if (req.action === 'eta') return gxEtaPost_(user, req);
  if (req.action === 'track') return gxTrackPost_(user, req);
  if (req.action === 'ai' && user.role !== 'admin') return gxJson_({ error: 'AI notes are available to admins only.' });
  if (typeof doPostData_ !== 'function') return gxJson_({ error: 'Unknown action' });
  if (user.managed) {
    const dk = gxDataKey_();
    if (!dk) return gxJson_({ error: 'The proxy is missing GX_DATA_KEY. See ROLE_SETUP.md.' });
    req.key = dk;
    e = { parameter: e.parameter, parameters: e.parameters, postData: { contents: JSON.stringify(req), type: e.postData.type, length: 0, name: 'postData' } };
  }
  return doPostData_(e);
}

// Role management, admin only. op: list | save | rekey | delete.
function gxUsersApi_(req) {
  const me = gxUser_(req.key);
  if (!me || me.role !== 'admin') return gxJson_({ error: 'UNAUTHORIZED' });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const all = gxUsers_(), d = req.data || {};
    const view = (id, u) => ({ id: id, name: u.name, role: u.role, menus: u.menus || [], disabled: !!u.disabled, created: u.created || '', updated: u.updated || '', keyHint: '…' + String(u.key || '').slice(-4) });
    const list = () => Object.keys(all).map(id => view(id, all[id])).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const clean = () => ({
      name: String(d.name || '').trim().slice(0, 60),
      role: d.role === 'admin' ? 'admin' : d.role === 'viewer' ? 'viewer' : 'dispatcher',
      menus: (Array.isArray(d.menus) ? d.menus : []).map(String).filter(m => GX_MENUS.indexOf(m) !== -1),
      disabled: !!d.disabled,
    });
    const now = new Date().toISOString();
    if (req.op === 'list') return gxJson_({ users: list(), menus: GX_MENUS, dataKey: !!gxDataKey_() });
    if (req.op === 'save') {
      const c = clean();
      if (!c.name) return gxJson_({ error: 'Name is required.' });
      if (d.id && all[d.id]) {
        all[d.id] = Object.assign(all[d.id], c, { updated: now });
        gxSaveUsers_(all);
        return gxJson_({ users: list() });
      }
      const id = Utilities.getUuid().slice(0, 8), key = gxNewKey_();
      all[id] = Object.assign(c, { key: key, created: now, updated: now });
      gxSaveUsers_(all);
      return gxJson_({ users: list(), newKey: key, id: id });
    }
    if (req.op === 'rekey') {
      if (!all[d.id]) return gxJson_({ error: 'User not found.' });
      const key = gxNewKey_();
      all[d.id].key = key; all[d.id].updated = now;
      gxSaveUsers_(all);
      return gxJson_({ users: list(), newKey: key, id: d.id });
    }
    if (req.op === 'delete') {
      delete all[d.id];
      gxSaveUsers_(all);
      return gxJson_({ users: list() });
    }
    return gxJson_({ error: 'Unknown operation.' });
  } finally { lock.releaseLock(); }
}

/* ---------- shared IDS plan ----------
 * One plan per work-order type (WWR, WCM) for everyone who opens IDS. Stored in Script properties in small chunks
 * (a property holds at most 9 KB), with a copy in the script cache for fast reads.
 * Each part has its own revision: settings ('cfg'), the plan of each branch ('plan:<branch>') and the status of each
 * work order ('meta:<WO>'). A change is accepted only when it was made on the latest revision of that part; otherwise
 * the part is reported as a conflict and the sender gets the latest version. So two people never overwrite each other
 * silently, and edits to different work orders never clash.
 */
const GX_IDS_CHUNK = 2800;           // characters per property (worst case under 9 KB in UTF-8)
const GX_IDS_LOG = 150;              // change-log entries kept
const GX_IDS_TEAM_KEYS = ['teams', 'crew', 'names'];   // settings a dispatcher may change

function gxIdsType_(t) { return t === 'WCM' ? 'WCM' : 'WWR'; }
function gxIdsCanUse_(user, type) {
  if (user.role === 'admin') return true;
  return (user.menus || []).indexOf(type === 'WCM' ? 'dispatchWcm' : 'dispatch') !== -1;
}
function gxIdsEmpty_() { return { rev: 0, at: 0, by: '', cfg: null, revs: {}, plans: {}, meta: {}, log: [] }; }
function gxIdsLoad_(type) {
  const cache = CacheService.getScriptCache(), hit = cache.get('gxids_' + type);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const P = gxProps_(), n = +(P.getProperty('GX_IDS_' + type + '_N') || 0);
  let s = '';
  for (let i = 0; i < n; i++) s += P.getProperty('GX_IDS_' + type + '_' + i) || '';
  let st = gxIdsEmpty_();
  if (s) { try { st = JSON.parse(s); } catch (e) {} }
  try { cache.put('gxids_' + type, JSON.stringify(st), 21600); } catch (e) {}
  return st;
}
function gxIdsSave_(type, st) {
  const s = JSON.stringify(st), P = gxProps_();
  const n = Math.ceil(s.length / GX_IDS_CHUNK), old = +(P.getProperty('GX_IDS_' + type + '_N') || 0), m = {};
  for (let i = 0; i < n; i++) m['GX_IDS_' + type + '_' + i] = s.slice(i * GX_IDS_CHUNK, (i + 1) * GX_IDS_CHUNK);
  m['GX_IDS_' + type + '_N'] = String(n);
  P.setProperties(m);
  for (let i = n; i < old; i++) P.deleteProperty('GX_IDS_' + type + '_' + i);
  try { CacheService.getScriptCache().put('gxids_' + type, s, 21600); } catch (e) { CacheService.getScriptCache().remove('gxids_' + type); }
}

// GET action=ids&type=WWR&since=<rev>: the whole shared plan, or { same: true } when nothing changed since <rev>.
function gxIdsGet_(user, p) {
  const type = gxIdsType_(p.type);
  if (!gxIdsCanUse_(user, type)) return gxJson_({ error: 'UNAUTHORIZED' });
  const st = gxIdsLoad_(type);
  if (p.since !== undefined && p.since !== '' && +p.since === (st.rev || 0)) return gxJson_({ ids: { rev: st.rev || 0, same: true } });
  return gxJson_({ ids: st });
}

// POST { action: 'ids', type, base: { <part>: rev }, parts: { <part>: value or null }, log: [entries] }
function gxIdsPost_(user, req) {
  const type = gxIdsType_(req.type);
  if (!gxIdsCanUse_(user, type)) return gxJson_({ error: 'UNAUTHORIZED' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const st = gxIdsLoad_(type), base = req.base || {}, parts = req.parts || {}, conflicts = [];
    st.revs = st.revs || {}; st.plans = st.plans || {}; st.meta = st.meta || {}; st.log = st.log || [];
    let changed = false;
    Object.keys(parts).forEach(id => {
      const cur = st.revs[id] || 0, b = +base[id] || 0;
      // A work order nobody has touched yet (no revision) can always be written.
      if (b !== cur && !(cur === 0 && id.indexOf('meta:') === 0)) { conflicts.push(id); return; }
      let v = parts[id];
      if (id === 'cfg') {
        if (!v) return;
        if (user.role !== 'admin' && st.cfg) {           // dispatchers change team setup only
          const c = Object.assign({}, st.cfg);
          if (st.cfg.dispPlan) GX_IDS_TEAM_KEYS.forEach(k => { if (k in v) c[k] = v[k]; });
          else {                                         // planning setup locked by the admin: names and trackers only
            if (Array.isArray(v.names)) c.names = v.names;
            if (Array.isArray(v.crew)) c.crew = Array.from({ length: Math.max(v.crew.length, (st.cfg.crew || []).length) }, (_, i) => v.crew[i]).map((x, i) => {
              const old = (st.cfg.crew || [])[i] || null;
              const app = x && x.app != null ? String(x.app) : old && old.app;
              return old ? Object.assign({}, old, { app: app }) : (app ? { app: app } : null);
            });
          }
          v = c;
        }
        st.cfg = v;
      } else if (id.indexOf('plan:') === 0) {
        const name = id.slice(5);
        if (v) st.plans[name] = v; else delete st.plans[name];
      } else if (id.indexOf('meta:') === 0) {
        const k = id.slice(5);
        if (v) st.meta[k] = v; else delete st.meta[k];
      } else return;
      if (id.indexOf('meta:') === 0 && !v) delete st.revs[id]; else st.revs[id] = cur + 1;
      changed = true;
    });
    (req.log || []).forEach(e => {
      if (!e || !e.id || st.log.some(x => x.id === e.id)) return;
      st.log.push({ id: String(e.id), at: +e.at || Date.now(), t: String(e.t || ''), msg: String(e.msg || '').slice(0, 500), by: user.name });
      changed = true;
    });
    if (changed) {
      st.log.sort((a, b) => (b.at || 0) - (a.at || 0));
      st.log = st.log.slice(0, GX_IDS_LOG);
      st.rev = (st.rev || 0) + 1; st.at = Date.now(); st.by = user.name;
      gxIdsSave_(type, st);
    }
    return gxJson_({ ids: st, conflicts: conflicts });
  } finally { lock.releaseLock(); }
}

/* ---------- shared live-tracking settings ----------
 * The Traccar connection an admin sets on the Tracking setup page, so every screen that shows technicians
 * (Customer map, IDS) uses the same live server. Readable by users with those menus; only admins can change it.
 */
const GX_TRACK_MENUS = ['map', 'dispatch', 'dispatchWcm', 'settings'];
function gxTrackGet_(user) {
  if (user.role !== 'admin' && !(user.menus || []).some(m => GX_TRACK_MENUS.indexOf(m) !== -1)) return gxJson_({ error: 'UNAUTHORIZED' });
  let t = null;
  try { t = JSON.parse(gxProps_().getProperty('GX_TRACK') || 'null'); } catch (e) {}
  return gxJson_({ track: t });
}
function gxTrackPost_(user, req) {
  if (user.role !== 'admin') return gxJson_({ error: 'UNAUTHORIZED' });
  const s = JSON.stringify(req.cfg || null);
  if (s.length > 8000) return gxJson_({ error: 'Tracking settings are too large.' });
  gxProps_().setProperty('GX_TRACK', s);
  return gxJson_({ track: req.cfg || null });
}

/* ---------- Drive CSV files for users without Drive access ----------
 * The dashboard reads tickets, customers and work orders from CSV files in one Drive folder. Admins read them with
 * their own Google sign-in. Other users get the same files through this proxy (which runs as the owner), limited to
 * the datasets their menus need, so every screen plans from the same work-order data.
 */
const GX_CSV_FOLDER = '1XPOvL9Tcqsq7JKKd76m_tKz7pNBPyv3g';
const GX_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GX_MENU_SETS = {
  overview: ['tickets', 'csat', 'customers', 'wo'], tickets: ['tickets', 'wo'], chat: ['tickets'], csat: ['csat'],
  growth: ['customers', 'wo'], intracity: ['customers', 'wo'], churnRisk: ['customers', 'churn'],
  map: ['customers', 'wo'], dispatch: ['customers', 'wo'], dispatchWcm: ['customers', 'wo'], settings: [],
};
// Same rules as kindOf() in gxcsv.js.
function gxKindOf_(name, inFolder) {
  const n = String(name || '').toLowerCase();
  if (inFolder) return /churn ?model/.test(n) ? 'churn' : /csat/.test(n) ? 'csat' : /work ?order|^wo\b|wwr|wcm/.test(n) ? 'wo' : /customer|pelanggan/.test(n) ? 'customers' : /ticket|tiket/.test(n) ? 'tickets' : null;
  return /csat/.test(n) ? 'csat' : /^(wwr|wcm|wo)\b|work ?order/.test(n) ? 'wo' : /customer|pelanggan/.test(n) ? 'customers' : 'tickets';
}
function gxCsvKinds_(user) {
  if (user.role === 'admin') return null;            // everything
  const k = {};
  (user.menus || []).forEach(m => (GX_MENU_SETS[m] || []).forEach(x => { k[x] = true; }));
  return k;
}
function gxCsvAllowed_(kinds, kind) { return !!kind && (kinds === null || !!kinds[kind]); }
function gxDriveJson_(o) { return gxJson_(o); }
function gxCsvErr_(msg) { return gxJson_({ error: { message: msg } }); }

// Drive-API-shaped folder listing: the CSV root, or one of its direct subfolders.
function gxCsvList_(user, p) {
  const kinds = gxCsvKinds_(user);
  if (kinds !== null && !Object.keys(kinds).length) return gxCsvErr_('No data sets for this account');
  const root = DriveApp.getFolderById(GX_CSV_FOLDER), fid = String(p.folder || GX_CSV_FOLDER), out = [];
  const add = (f, folder) => out.push({ id: f.getId(), name: f.getName(), size: folder ? 0 : String(f.getSize()), modifiedTime: f.getLastUpdated().toISOString(), mimeType: folder ? GX_FOLDER_MIME : 'text/csv' });
  if (fid === GX_CSV_FOLDER) {
    const fs = root.getFolders();
    while (fs.hasNext()) { const d = fs.next(); if (gxCsvAllowed_(kinds, gxKindOf_(d.getName(), true))) add(d, true); }
    const xs = root.getFiles();
    while (xs.hasNext()) { const f = xs.next(); if (/\.csv$/i.test(f.getName()) && gxCsvAllowed_(kinds, gxKindOf_(f.getName(), false))) add(f, false); }
    return gxDriveJson_({ files: out });
  }
  const sub = DriveApp.getFolderById(fid), parents = sub.getParents();
  let ok = false;
  while (parents.hasNext()) if (parents.next().getId() === GX_CSV_FOLDER) ok = true;
  if (!ok || !gxCsvAllowed_(kinds, gxKindOf_(sub.getName(), true))) return gxCsvErr_('Folder not allowed');
  const xs = sub.getFiles();
  while (xs.hasNext()) { const f = xs.next(); if (/\.(csv|json)$/i.test(f.getName())) add(f, false); }
  return gxDriveJson_({ files: out });
}

// File contents, only for files in the CSV root (by file name) or an allowed subfolder.
function gxCsvGet_(user, p) {
  const kinds = gxCsvKinds_(user);
  let f;
  try { f = DriveApp.getFileById(String(p.id || '')); } catch (e) { return gxCsvErr_('File not found'); }
  let kind = null;
  const parents = f.getParents();
  while (parents.hasNext()) {
    const d = parents.next();
    if (d.getId() === GX_CSV_FOLDER) { kind = gxKindOf_(f.getName(), false); break; }
    const pp = d.getParents();
    while (pp.hasNext()) if (pp.next().getId() === GX_CSV_FOLDER) kind = gxKindOf_(d.getName(), true);
    if (kind) break;
  }
  if (!gxCsvAllowed_(kinds, kind)) return gxCsvErr_('File not allowed');
  return ContentService.createTextOutput(f.getBlob().getDataAsString()).setMimeType(ContentService.MimeType.TEXT);
}


/* ---------- ETA API for DotAI ----------
 * Every open IDS screen (board or arrivals TV) sends a snapshot of today's plan: per WO its status, ETA instant, jobs
 * before it and what the team is doing now. No technician name, phone or position is stored or answered.
 *
 * DotAI reads:  GET <web app URL>?action=eta&key=<GX_DOTAI_KEY>&cid=<CID>     (or &uid=<user ID>, or &wo=<WO number>)
 * An admin access key of the dashboard also works, for testing in a browser.
 * The answer gives the ETA as a 2-hour window, the technician status as a sentence, and handoff=true when DotAI should
 * pass the chat to a dispatcher instead of answering (ETA passed, customer asked to reschedule, or no fresh data).
 */
const GX_ETA_FRESH_MIN = 30;          // a snapshot older than this is not used for an ETA
const GX_ETA_MAX_ROWS = 3000;
const GX_ETA_TYPES = { WWR: 'Wiredown', WCM: 'Maintenance' };

function gxEtaLoad_(type) {
  const cache = CacheService.getScriptCache(), hit = cache.get('gxeta_' + type);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const P = gxProps_(), n = +(P.getProperty('GX_ETA_' + type + '_N') || 0);
  let s = '';
  for (let i = 0; i < n; i++) s += P.getProperty('GX_ETA_' + type + '_' + i) || '';
  let st = { branches: {} };
  if (s) { try { st = JSON.parse(s); } catch (e) {} }
  return st;
}
function gxEtaSave_(type, st, durable) {
  const s = JSON.stringify(st);
  try { CacheService.getScriptCache().put('gxeta_' + type, s, 21600); } catch (e) { durable = true; }
  if (!durable) return;
  const P = gxProps_(), n = Math.ceil(s.length / GX_IDS_CHUNK), old = +(P.getProperty('GX_ETA_' + type + '_N') || 0), m = {};
  for (let i = 0; i < n; i++) m['GX_ETA_' + type + '_' + i] = s.slice(i * GX_IDS_CHUNK, (i + 1) * GX_IDS_CHUNK);
  m['GX_ETA_' + type + '_N'] = String(n);
  P.setProperties(m);
  for (let i = n; i < old; i++) P.deleteProperty('GX_ETA_' + type + '_' + i);
}

// POST { action: 'eta', type, branch, date, rows: [[wo, cid, uid, status, etaMs, ahead, team, conf], ...] }
function gxEtaPost_(user, req) {
  const type = gxIdsType_(req.type);
  if (!gxIdsCanUse_(user, type)) return gxJson_({ error: 'UNAUTHORIZED' });
  const branch = String(req.branch || '').slice(0, 80), date = String(req.date || '').slice(0, 10);
  if (!branch || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(req.rows)) return gxJson_({ error: 'Bad ETA snapshot' });
  const str = v => v == null ? '' : String(v).slice(0, 60);
  const rows = req.rows.slice(0, GX_ETA_MAX_ROWS).filter(Array.isArray).map(r => [str(r[0]), str(r[1]), str(r[2]), str(r[3]).slice(0, 12),
    r[4] == null || !isFinite(+r[4]) ? null : Math.round(+r[4]), r[5] == null || !isFinite(+r[5]) ? null : Math.round(+r[5]), str(r[6]).slice(0, 16), str(r[7]).slice(0, 12)]);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const st = gxEtaLoad_(type), old = st.branches[branch];
    const changed = !old || old.date !== date || JSON.stringify(old.rows) !== JSON.stringify(rows);
    st.branches[branch] = { date: date, at: Date.now(), by: user.name, rows: changed ? rows : old.rows };
    gxEtaSave_(type, st, changed);
    return gxJson_({ eta: { ok: true, changed: changed, rows: rows.length } });
  } finally { lock.releaseLock(); }
}

function gxEtaTz_(branch) { return /malang|jakarta|jkt|surabaya/i.test(branch) ? ['Asia/Jakarta', 'WIB'] : ['Asia/Makassar', 'WITA']; }

const GX_ETA_STATUS = {
  scheduled: 'Terjadwal hari ini',
  late: 'Terjadwal hari ini, kedatangan terlambat dari perkiraan',
  onway: 'Teknisi dalam perjalanan ke lokasi pelanggan',
  onsite: 'Teknisi sudah di lokasi pelanggan',
  done: 'Kunjungan hari ini sudah selesai',
  mass: 'Jadwal bergeser karena teknisi menangani gangguan massal',
  break: 'Terjadwal hari ini, teknisi sedang istirahat',
  resched: 'Pelanggan meminta jadwal ulang',
  next: 'Dijadwalkan pada hari kerja berikutnya',
  cancel: 'Work order dibatalkan',
};
const GX_ETA_TECH = {
  onway: 'Teknisi sedang dalam perjalanan menuju lokasi Anda.',
  onsite: 'Teknisi sudah berada di lokasi Anda.',
  done: 'Kunjungan teknisi untuk work order ini sudah selesai.',
  mass: 'Teknisi sedang menangani gangguan jaringan di area lain, sehingga jadwal kunjungan sedikit bergeser.',
  break: 'Teknisi sedang istirahat sebentar dan setelah itu melanjutkan jadwal kunjungan.',
  prev_onsite: 'Teknisi sedang menyelesaikan pekerjaan di lokasi pelanggan sebelumnya.',
  prev_onway: 'Teknisi sedang dalam perjalanan ke lokasi pelanggan sebelumnya.',
  between_jobs: 'Teknisi sedang menjalankan jadwal kunjungan hari ini.',
  not_started: 'Teknisi belum mulai bertugas hari ini.',
};

function gxEtaItem_(type, branch, b, r, now) {
  const tz = gxEtaTz_(branch), fresh = now - (b.at || 0) <= GX_ETA_FRESH_MIN * 60000;
  const code = r[3], etaMs = r[4], ahead = r[5], team = r[6];
  const fmt = ms => Utilities.formatDate(new Date(ms), tz[0], 'HH:mm');
  const it = {
    wo: r[0], cid: r[1], uid: r[2], type: type, typeName: GX_ETA_TYPES[type], branch: branch,
    status: code, statusText: GX_ETA_STATUS[code] || code,
    etaWindow: null, jobsAhead: ahead, technicianStatus: null,
    updatedAt: Utilities.formatDate(new Date(b.at || 0), tz[0], "yyyy-MM-dd'T'HH:mm:ssXXX"), fresh: fresh,
    handoff: false, handoffReason: null, reply: '',
  };
  const tech = GX_ETA_TECH[code] || GX_ETA_TECH[team] || null;
  if (['scheduled', 'late', 'onway', 'onsite', 'done', 'mass', 'break', 'resched'].indexOf(code) !== -1) it.technicianStatus = tech;
  const step = 30 * 60000;
  if (fresh && etaMs != null && ['scheduled', 'onway', 'mass', 'break'].indexOf(code) !== -1) {
    const from = Math.max(Math.floor((etaMs - 60 * 60000) / step) * step, Math.ceil(now / step) * step), to = from + 120 * 60000;
    it.etaWindow = { from: fmt(from), to: fmt(to), tz: tz[1] };
  }
  if (!fresh && ['done', 'next', 'cancel'].indexOf(code) === -1) { it.handoff = true; it.handoffReason = 'stale'; it.technicianStatus = null; }
  else if (code === 'late') { it.handoff = true; it.handoffReason = 'late'; }
  else if (code === 'resched') { it.handoff = true; it.handoffReason = 'reschedule'; }
  const w = it.etaWindow;
  it.reply = it.handoff ? (it.handoffReason === 'stale'
      ? 'Work order ' + it.wo + ' sudah terjadwal. Untuk perkiraan waktu kedatangan terbaru, kami bantu konfirmasikan ke tim dispatcher terlebih dahulu.'
      : it.handoffReason === 'late'
        ? 'Mohon maaf, kunjungan teknisi untuk work order ' + it.wo + ' mengalami keterlambatan. Kami teruskan ke tim dispatcher untuk konfirmasi waktu kedatangan.'
        : 'Permintaan jadwal ulang untuk work order ' + it.wo + ' sedang diproses. Kami teruskan ke tim dispatcher untuk konfirmasi jadwal baru.')
    : code === 'done' ? 'Kunjungan teknisi untuk work order ' + it.wo + ' hari ini sudah selesai.'
    : code === 'next' ? 'Work order ' + it.wo + ' dijadwalkan untuk kunjungan pada hari kerja berikutnya. Tim kami akan menghubungi Anda untuk konfirmasi.'
    : code === 'cancel' ? 'Work order ' + it.wo + ' sudah dibatalkan. Jika gangguan masih terjadi, kami bantu buatkan jadwal kunjungan baru.'
    : code === 'onsite' ? 'Teknisi sudah berada di lokasi Anda untuk work order ' + it.wo + '.'
    : (w ? 'Perkiraan teknisi tiba antara pukul ' + w.from + '–' + w.to + ' ' + w.tz + ' untuk work order ' + it.wo + '. ' : 'Work order ' + it.wo + ' terjadwal hari ini. ') + (tech || '') + ' Perkiraan ini dapat berubah mengikuti kondisi di lapangan.';
  return it;
}

function gxEtaApi_(p) {
  const key = String(p.key || ''), dk = gxProps_().getProperty('GX_DOTAI_KEY') || '';
  let ok = !!dk && key === dk;
  if (!ok) { const u = gxUser_(key); ok = !!u && u.role === 'admin'; }
  if (!ok) return gxJson_({ ok: false, error: 'UNAUTHORIZED' });
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const q = { cid: norm(p.cid), uid: norm(p.uid), wo: norm(p.wo) };
  if (!q.cid && !q.uid && !q.wo) return gxJson_({ ok: false, error: 'Give cid, uid or wo.' });
  const now = Date.now(), out = [];
  Object.keys(GX_ETA_TYPES).forEach(type => {
    const st = gxEtaLoad_(type);
    Object.keys(st.branches || {}).forEach(branch => {
      const b = st.branches[branch];
      if (!b || b.date !== Utilities.formatDate(new Date(now), gxEtaTz_(branch)[0], 'yyyy-MM-dd')) return;
      (b.rows || []).forEach(r => {
        if ((q.cid && norm(r[1]) === q.cid) || (q.uid && norm(r[2]) === q.uid) || (q.wo && norm(r[0]) === q.wo)) out.push(gxEtaItem_(type, branch, b, r, now));
      });
    });
  });
  const order = { onsite: 0, onway: 1, late: 2, mass: 3, break: 4, scheduled: 5, resched: 6, next: 7, done: 8, cancel: 9 };
  out.sort((a, b) => (a.status in order ? order[a.status] : 9) - (b.status in order ? order[b.status] : 9));
  return gxJson_({ ok: true, query: { cid: p.cid || null, uid: p.uid || null, wo: p.wo || null }, found: out.length, workOrders: out,
    reply: out.length ? out[0].reply : 'Work order untuk pelanggan ini belum masuk jadwal kunjungan teknisi hari ini.' });
}
