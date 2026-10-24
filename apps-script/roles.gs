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
    return { name: u.name || 'User', role: admin ? 'admin' : 'dispatcher', menus: admin ? '*' : (u.menus || []).filter(m => GX_MENUS.indexOf(m) !== -1), managed: true };
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
  const user = gxUser_(p.key);
  if (p.action === 'whoami') {
    if (!user) return gxJson_({ error: 'UNAUTHORIZED' });
    return gxJson_({ gxUser: { name: user.name, role: user.role, menus: user.menus } });
  }
  if (!user) return gxJson_({ error: 'UNAUTHORIZED' });
  if (p.action === 'ids') return gxIdsGet_(user, p);
  if (p.action === 'track') return gxTrackGet_(user);
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
  if (req.action === 'ids') return gxIdsPost_(user, req);
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
      role: d.role === 'admin' ? 'admin' : 'dispatcher',
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
          GX_IDS_TEAM_KEYS.forEach(k => { if (k in v) c[k] = v[k]; });
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
