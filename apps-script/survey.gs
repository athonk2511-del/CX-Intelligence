/* CX Intelligence — Surveys (form builder + responses) for the Apps Script proxy.
 *
 * Add this file to the SAME proxy project as roles.gs (Apps Script editor → + → Script, name it "survey").
 * roles.gs routes POST { action: 'survey' } here before its own key check, because respondents have no key.
 * See SURVEY_SETUP.md.
 *
 * Storage: one spreadsheet "CX Intelligence · Survey DB", created by gxSurveySetup() and kept in the script
 * property GX_SURVEY_SHEET. Tabs:
 *   Forms       id | title | updatedAt | json
 *   Responses   id | formId | submittedAt | answers json | hidden-field json
 *   Jawaban - <title> [id]   one readable tab per survey, one column per question (archive; never deleted here)
 *
 * Who may do what:
 *   respondent (no key)            op form, submit
 *   admin, or a user with the "surveys" menu      list, get, responses (viewer: read only)
 *   admin, or a dispatcher with the "surveys" menu  save, delete, deleteResponse
 *   any user who may read CSAT     csatFeed (rows of surveys linked to the CSAT report)
 */

const GX_SURVEY_PROP = 'GX_SURVEY_SHEET';
const GX_SURVEY_MAX_ANSWER = 5000;
const GX_SURVEY_MAX_HIDDEN = 120;

// Run once from the editor: creates the Survey DB spreadsheet (or reuses the one already set) and asks for permissions.
function gxSurveySetup() {
  const ss = gxSurveySS_();
  gxSurveyForms_(); gxSurveyResp_();
  Logger.log('Survey DB: ' + ss.getUrl());
}

function gxSurveySS_() {
  const P = gxProps_(), id = P.getProperty(GX_SURVEY_PROP);
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('CX Intelligence · Survey DB');
  P.setProperty(GX_SURVEY_PROP, ss.getId());
  const first = ss.getSheets()[0]; first.setName('Forms'); first.appendRow(['id', 'title', 'updatedAt', 'json']); first.setFrozenRows(1);
  return ss;
}
function gxSurveySheet_(name, headers) {
  const ss = gxSurveySS_();
  let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.appendRow(headers); s.setFrozenRows(1); }
  return s;
}
function gxSurveyForms_() { return gxSurveySheet_('Forms', ['id', 'title', 'updatedAt', 'json']); }
function gxSurveyResp_() { return gxSurveySheet_('Responses', ['id', 'formId', 'submittedAt', 'answers', 'hidden']); }
function gxSurveyRows_(s) { const n = s.getLastRow(); return n < 2 ? [] : s.getRange(2, 1, n - 1, s.getLastColumn()).getValues(); }
function gxSurveyFind_(s, col, val) {
  const n = s.getLastRow(); if (n < 2) return -1;
  const v = s.getRange(2, col + 1, n - 1, 1).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]) === String(val)) return i + 2;
  return -1;
}
function gxSurveyIso_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }
function gxSurveyForm_(id) {
  const s = gxSurveyForms_(), r = gxSurveyFind_(s, 0, id);
  if (r < 0) throw new Error('NOT_FOUND');
  return JSON.parse(s.getRange(r, 4).getValue());
}
function gxSurveyParse_(t) { try { return JSON.parse(t || '{}') || {}; } catch (e) { return {}; } }
function gxSurveyLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }

function gxSurveyCanView_(u) { return !!u && (u.role === 'admin' || (u.menus || []).indexOf('surveys') !== -1); }
function gxSurveyCanEdit_(u) { return gxSurveyCanView_(u) && u.role !== 'viewer'; }

function gxSurveyApi_(req) {
  try { return gxJson_({ ok: true, data: gxSurveyRoute_(req) }); }
  catch (err) { return gxJson_({ ok: false, error: String((err && err.message) || err) }); }
}

function gxSurveyRoute_(req) {
  const op = req.op;

  // ---- public: respondents ----
  if (op === 'form') {
    const f = gxSurveyForm_(req.id);
    delete f.csat; // internal mapping, not needed by respondents
    return f;
  }
  if (op === 'submit') return gxSurveyLock_(() => {
    const f = gxSurveyForm_(req.formId);
    if (!f.accepting) throw new Error('CLOSED');
    const ids = {}; (f.questions || []).forEach(q => { if (q.type !== 'statement') ids[q.id] = q; });
    const a = req.answers || {}, clean = {};
    Object.keys(a).forEach(k => {
      if (!ids[k]) return;
      if (JSON.stringify(a[k]).length > GX_SURVEY_MAX_ANSWER) throw new Error('Jawaban terlalu panjang');
      clean[k] = a[k];
    });
    const allowed = String(f.hidden || '').split(',').map(x => x.trim()).filter(Boolean), h = req.hidden || {}, hid = {};
    allowed.forEach(k => { if (h[k] != null && h[k] !== '') hid[k] = String(h[k]).slice(0, GX_SURVEY_MAX_HIDDEN); });
    const id = Utilities.getUuid(), ts = new Date();
    gxSurveyResp_().appendRow([id, f.id, ts, JSON.stringify(clean), JSON.stringify(hid)]);
    gxSurveyReadable_(f, id, ts, clean, hid);
    return { id: id };
  });

  // ---- signed in (access key) ----
  const u = gxUser_(req.key);
  if (!u) throw new Error('UNAUTHORIZED');

  if (op === 'csatFeed') {
    if (!gxCanReadGid_(u, GX_GID.csat)) throw new Error('UNAUTHORIZED');
    return gxSurveyCsatFeed_();
  }
  if (!gxSurveyCanView_(u)) throw new Error('Akses ke menu Surveys belum diberikan. Minta admin menambahkannya di Role management.');

  if (op === 'list') {
    const counts = {};
    gxSurveyRows_(gxSurveyResp_()).forEach(r => { counts[r[1]] = (counts[r[1]] || 0) + 1; });
    return gxSurveyRows_(gxSurveyForms_()).filter(r => r[0]).map(r => { const f = gxSurveyParse_(r[3]); f.responseCount = counts[r[0]] || 0; return f; });
  }
  if (op === 'get') return gxSurveyForm_(req.id);
  if (op === 'responses') {
    return gxSurveyRows_(gxSurveyResp_()).filter(r => String(r[1]) === String(req.formId))
      .map(r => ({ id: r[0], submittedAt: gxSurveyIso_(r[2]), answers: gxSurveyParse_(r[3]), hidden: gxSurveyParse_(r[4]) }));
  }

  if (!gxSurveyCanEdit_(u)) throw new Error('View only: akun ini tidak bisa mengubah survei.');

  if (op === 'save') return gxSurveyLock_(() => {
    const f = req.form;
    if (!f || !f.id || !/^[a-z0-9]{4,20}$/i.test(f.id)) throw new Error('Form tidak valid');
    f.updatedAt = new Date().toISOString();
    f.updatedBy = u.name;
    const text = JSON.stringify(f);
    if (text.length > 49000) throw new Error('Survei terlalu besar untuk satu sel Sheets (maks ±49.000 karakter).');
    const s = gxSurveyForms_(), r = gxSurveyFind_(s, 0, f.id), vals = [f.id, f.title || '', f.updatedAt, text];
    if (r < 0) s.appendRow(vals); else s.getRange(r, 1, 1, 4).setValues([vals]);
    return { updatedAt: f.updatedAt };
  });
  if (op === 'delete') return gxSurveyLock_(() => {
    const fs = gxSurveyForms_(), r = gxSurveyFind_(fs, 0, req.id);
    if (r > 0) fs.deleteRow(r);
    const rs = gxSurveyResp_(), n = rs.getLastRow();
    if (n >= 2) {
      const v = rs.getRange(2, 2, n - 1, 1).getValues();
      for (let i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === String(req.id)) rs.deleteRow(i + 2);
    }
    return { deleted: true };
  });
  if (op === 'deleteResponse') return gxSurveyLock_(() => {
    const s = gxSurveyResp_(), r = gxSurveyFind_(s, 0, req.id);
    if (r > 0) s.deleteRow(r);
    return { deleted: true };
  });
  throw new Error('Unknown survey operation');
}

/* Rows for the dashboard's CSAT report: every response of a survey whose CSAT link is on.
   Row: [ISO date, rating 1–5, comment, who, survey title]. Ratings outside 1–5 are skipped. */
function gxSurveyCsatFeed_() {
  const forms = {};
  gxSurveyRows_(gxSurveyForms_()).forEach(r => {
    const f = gxSurveyParse_(r[3]);
    if (f.csat && f.csat.on && f.csat.ratingQ) forms[r[0]] = f;
  });
  if (!Object.keys(forms).length) return { rows: [], forms: 0 };
  const out = [];
  gxSurveyRows_(gxSurveyResp_()).forEach(r => {
    const f = forms[r[1]]; if (!f) return;
    const a = gxSurveyParse_(r[3]), h = gxSurveyParse_(r[4]), c = f.csat;
    const rating = Number(a[c.ratingQ]);
    if (!(rating >= 1 && rating <= 5) || Math.round(rating) !== rating) return;
    const comment = c.commentQ ? String(a[c.commentQ] == null ? '' : a[c.commentQ]).slice(0, 1500) : '';
    let who = '';
    if (c.whoQ) who = /^h:/.test(c.whoQ) ? String(h[c.whoQ.slice(2)] || '') : String(a[c.whoQ] == null ? '' : a[c.whoQ]);
    out.push([gxSurveyIso_(r[2]), rating, comment, who.slice(0, 120), f.title || 'Survei']);
  });
  return { rows: out, forms: Object.keys(forms).length };
}

/* Readable tab per survey: hidden row 1 = keys, row 2 = labels, then one row per response. */
function gxSurveyReadable_(f, rid, ts, answers, hidden) {
  const ss = gxSurveySS_(), tag = '[' + f.id + ']';
  let s = ss.getSheets().filter(x => x.getName().slice(-tag.length) === tag)[0];
  if (!s) {
    const name = ('Jawaban - ' + (f.title || 'Survei')).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 80) + ' ' + tag;
    s = ss.insertSheet(name);
    s.getRange(1, 1, 2, 2).setValues([['_ts', '_rid'], ['Waktu', 'ID respons']]);
    s.hideRows(1); s.setFrozenRows(2); s.getRange(2, 1, 1, 2).setFontWeight('bold');
  }
  const width = Math.max(s.getLastColumn(), 2), head = s.getRange(1, 1, 2, width).getValues(), keys = head[0], labels = head[1];
  const want = String(f.hidden || '').split(',').map(x => x.trim()).filter(Boolean).map(k => ['h:' + k, k.toUpperCase()])
    .concat((f.questions || []).filter(q => q.type !== 'statement').map(q => [q.id, q.title || 'Tanpa judul']));
  want.forEach(([k, title]) => {
    let c = keys.indexOf(k);
    if (c < 0) { keys.push(k); labels.push(title); c = keys.length - 1; s.getRange(1, c + 1, 2, 1).setValues([[k], [title]]); s.getRange(2, c + 1).setFontWeight('bold'); }
    else if (labels[c] !== title) s.getRange(2, c + 1).setValue(title);
  });
  s.appendRow(keys.map(k => k === '_ts' ? ts : k === '_rid' ? rid : /^h:/.test(k) ? gxSurveyCell_(hidden[k.slice(2)]) : gxSurveyCell_(answers[k])));
}
function gxSurveyCell_(v) {
  if (v === undefined || v === null) return '';
  let out;
  if (Array.isArray(v)) out = v.join(', ');
  else if (typeof v === 'object') out = Object.keys(v).map(k => k + ': ' + v[k]).join('; ');
  else out = v;
  if (typeof out === 'string' && /^[=+\-@]/.test(out)) out = "'" + out; // no formula injection
  return out;
}
