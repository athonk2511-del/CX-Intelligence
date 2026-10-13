// Administrative boundaries (Provinsi → Kab/Kota → Kecamatan → Kelurahan/Desa) and
// per-area customer, revenue and work-order stats. Boundary GeoJSON is fetched per
// parent from github.com/aaronsanger/idn-geojson (GADM 4.1 / cahyadsn derived).
const BASE = 'https://cdn.jsdelivr.net/gh/aaronsanger/idn-geojson@main/';
export const PROVINCES = [["11","Aceh"],["12","Sumatera Utara"],["13","Sumatera Barat"],["14","Riau"],["15","Jambi"],["16","Sumatera Selatan"],["17","Bengkulu"],["18","Lampung"],["19","Kepulauan Bangka Belitung"],["21","Kepulauan Riau"],["31","DKI Jakarta"],["32","Jawa Barat"],["33","Jawa Tengah"],["34","DI Yogyakarta"],["35","Jawa Timur"],["36","Banten"],["51","Bali"],["52","Nusa Tenggara Barat"],["53","Nusa Tenggara Timur"],["61","Kalimantan Barat"],["62","Kalimantan Tengah"],["63","Kalimantan Selatan"],["64","Kalimantan Timur"],["65","Kalimantan Utara"],["71","Sulawesi Utara"],["72","Sulawesi Tengah"],["73","Sulawesi Selatan"],["74","Sulawesi Tenggara"],["75","Gorontalo"],["76","Sulawesi Barat"],["81","Maluku"],["82","Maluku Utara"],["91","Papua"],["92","Papua Barat"],["93","Papua Barat Daya"],["94","Papua Pegunungan"],["95","Papua Selatan"],["96","Papua Tengah"]].map(([code, name]) => ({ code, name }));
export const LEVELS = ['Provinsi', 'Kabupaten/Kota', 'Kecamatan', 'Kelurahan/Desa'];

const titleCase = s => String(s || '').toLowerCase().replace(/(^|[\s.\-\/(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bDki\b/, 'DKI').replace(/\bDi\b/, 'DI');
const files = new Map();
function fileFor(level, parent) {
  const p = String(parent).replace(/\./g, '_');
  return level === 1 ? 'cities/' + p + '.geojson' : level === 2 ? 'districts/' + p + '.geojson' : 'kelurahan/' + p + '.geojson';
}

function prep(f) {
  const g = f.geometry; if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return null;
  const pr = f.properties || {};
  return makeArea(String(pr.code || pr.id), titleCase(pr.name), polys, g);
}
function makeArea(code, name, polys, outline) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90, ax = 0, ay = 0, aw = 0;
  polys.forEach(poly => {
    const ring = poly[0]; let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [px, py] = ring[j];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const c = px * y - x * py; a += c; cx += (px + x) * c; cy += (py + y) * c;
    }
    if (Math.abs(a) > 1e-12) { ax += cx / 3; ay += cy / 3; aw += a; }
  });
  const fill = { type: 'MultiPolygon', coordinates: polys };
  return { code, name, polys, bbox: [x0, y0, x1, y1], center: aw ? [ay / aw, ax / aw] : [(y0 + y1) / 2, (x0 + x1) / 2], geometry: outline || fill, fill };
}

// Child areas of a parent code. level 1 = kab/kota of a province, 2 = kecamatan of a kab, 3 = kelurahan of a kec.
export function loadChildren(level, parent) {
  const key = level + '|' + parent;
  if (files.has(key)) return files.get(key);
  const p = fetch(BASE + fileFor(level, parent)).then(r => { if (!r.ok) throw new Error('No boundary file for ' + parent + ' (HTTP ' + r.status + ')'); return r.json(); })
    .then(j => {
      const seen = new Set(), out = [];
      (j.features || []).forEach(f => { const a = prep(f); if (a && !seen.has(a.code)) { seen.add(a.code); out.push(a); } });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    });
  p.catch(() => files.delete(key));
  files.set(key, p);
  return p;
}

function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function contains(a, lat, lng) {
  const b = a.bbox; if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) return false;
  for (const poly of a.polys) { if (inRing(lng, lat, poly[0])) { let hole = false; for (let k = 1; k < poly.length; k++) if (inRing(lng, lat, poly[k])) { hole = true; break; } if (!hole) return true; } }
  return false;
}

// Split point indices (all points when idx is null) among areas → array of Int32Array members.
export function assign(areas, data, idx) {
  const lists = areas.map(() => []);
  const n = idx ? idx.length : data.count;
  let X0 = 180, Y0 = 90, X1 = -180, Y1 = -90;
  areas.forEach(a => { X0 = Math.min(X0, a.bbox[0]); Y0 = Math.min(Y0, a.bbox[1]); X1 = Math.max(X1, a.bbox[2]); Y1 = Math.max(Y1, a.bbox[3]); });
  for (let k = 0; k < n; k++) {
    const i = idx ? idx[k] : k, la = data.lat[i], lo = data.lng[i];
    if (lo < X0 || lo > X1 || la < Y0 || la > Y1) continue;
    for (let a = 0; a < areas.length; a++) if (contains(areas[a], la, lo)) { lists[a].push(i); break; }
  }
  return lists.map(l => Int32Array.from(l));
}

// Period → [from, to] ms, or null for "all time" (current status).
export function periodRange(p) {
  if (!p || p.mode === 'all') return null;
  const y = +p.y, m = +p.m || 0, d = +p.d || 1;
  if (p.mode === 'year') return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime() - 1];
  if (p.mode === 'month') return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime() - 1];
  return [new Date(y, m, d).getTime(), new Date(y, m, d + 1).getTime() - 1];
}

/* Per-account state for a period:
   Active / Blocked = state at the end of the period, rebuilt from start date (J),
   blocked date (K, else L) and termination date (L). Terminated = terminated inside
   the period. All time = current status. Revenue = MRC (fee − discount). */
export function stateAt(data, i, R) {
  const st = data.status[i];
  if (!R) return st;
  const b = R[1], s = data.start[i];
  if (s > b) return -1;
  if (st === 2) {
    const t = data.endAt[i];
    if (!(t >= 0)) return -1;
    if (t < R[0]) return -1;
    if (t <= b) return 2;
    return data.blockAt[i] <= b ? 1 : 0;
  }
  if (st === 1) return data.blockAt[i] <= b ? 1 : 0;
  return 0;
}

export function stats(data, members, R, woIdx) {
  const o = { n: [0, 0, 0], rev: [0, 0, 0], wwr: 0, wcm: 0 };
  if (!members) return o;
  const inSet = woIdx ? null : new Uint8Array(data.count);
  for (let k = 0; k < members.length; k++) {
    const i = members[k], s = stateAt(data, i, R);
    if (inSet) inSet[i] = 1;
    if (s < 0) continue;
    o.n[s]++; o.rev[s] += data.mrc[i] || 0;
  }
  const W = data.wo; if (!W) return o;
  for (let k = 0; k < W.n; k++) {
    if (!inSet[W.pt[k]]) continue;
    const t = W.t[k]; if (R && !(t >= R[0] && t <= R[1])) continue;
    if (W.type[k] === 0) o.wwr++; else o.wcm++;
  }
  return o;
}

/* ---------- BPS boundary file (Wilkerstat) ----------
   Accepts BPS GeoJSON or zipped SHP at desa/kelurahan or SLS level. Codes follow
   the BPS scheme: prov 2, kab 4, kec 7, desa 10 digits (SLS ids are cut to 10).
   Kab and kecamatan shapes are built by grouping desa; their outlines come from
   edges that are not shared between two members. */
const SHPJS = 'https://unpkg.com/shpjs@4.0.4/dist/shp.js';
let shpP = null;
function loadShp() {
  if (window.shp) return Promise.resolve(window.shp);
  return shpP || (shpP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = SHPJS; s.onload = () => res(window.shp); s.onerror = () => { shpP = null; rej(new Error('Could not load the shapefile reader')); }; document.head.appendChild(s); }));
}
export async function readBoundaryFile(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  let out;
  if (head[0] === 0x50 && head[1] === 0x4B) { const shp = await loadShp(); out = await shp(buf); }
  else out = JSON.parse(new TextDecoder().decode(buf));
  const list = Array.isArray(out) ? out : [out];
  return list.flatMap(fc => fc.features || (fc.type === 'Feature' ? [fc] : []));
}
const pick = (p, keys) => { for (const k of keys) { const v = p[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };
const digits = v => String(v || '').replace(/\D/g, '');
const pad = (v, n) => { const d = digits(v); return d ? d.padStart(n, '0').slice(-n) : ''; };
function bpsCode(p) {
  let c = digits(pick(p, ['iddesa', 'kdebps', 'kode_desa', 'kode_bps', 'kdbps']));
  if (c.length < 10) { const s = digits(pick(p, ['idsls', 'idsubsls', 'id_sls'])); if (s.length >= 10) c = s; }
  if (c.length < 10) { const a = pad(pick(p, ['kdprov', 'kode_prov']), 2), b = pad(pick(p, ['kdkab', 'kode_kab']), 2), k = pad(pick(p, ['kdkec', 'kode_kec']), 3), d = pad(pick(p, ['kddesa', 'kode_desa']), 3); if (a && b && k && d) c = a + b + k + d; }
  if (c.length < 10) { const s = digits(pick(p, ['kode', 'code', 'id'])); if (s.length >= 10) c = s; }
  return c.length >= 10 ? c.slice(0, 10) : '';
}
const round = n => Math.round(n * 1e5) / 1e5;
function cleanPolys(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map(poly => poly.map(ring => { const r = []; let px, py; ring.forEach(([x, y]) => { x = round(x); y = round(y); if (x !== px || y !== py) { r.push([x, y]); px = x; py = y; } }); return r; }).filter(r => r.length >= 4)).filter(p => p.length);
}
// Outer edges of a group of polygons → MultiLineString (shared edges cancel out).
function outlineOf(polys) {
  const cnt = new Map(), key = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a[0] + ',' + a[1] + ',' + b[0] + ',' + b[1] : b[0] + ',' + b[1] + ',' + a[0] + ',' + a[1];
  polys.forEach(poly => poly.forEach(ring => { for (let i = 1; i < ring.length; i++) { const k = key(ring[i - 1], ring[i]); cnt.set(k, (cnt.get(k) || 0) + 1); } }));
  const lines = [];
  polys.forEach(poly => poly.forEach(ring => {
    let cur = null;
    for (let i = 1; i < ring.length; i++) {
      if (cnt.get(key(ring[i - 1], ring[i])) === 1) { if (!cur) { cur = [ring[i - 1]]; lines.push(cur); } cur.push(ring[i]); } else cur = null;
    }
  }));
  return { type: 'MultiLineString', coordinates: lines };
}
export function buildBps(features, label) {
  const desa = new Map(), names = new Map();
  let skipped = 0, projected = false;
  features.forEach(f => {
    const p = {}; Object.keys(f.properties || {}).forEach(k => { p[k.toLowerCase()] = f.properties[k]; });
    const c = bpsCode(p); if (!c || !f.geometry) { skipped++; return; }
    const polys = cleanPolys(f.geometry); if (!polys.length) { skipped++; return; }
    if (Math.abs(polys[0][0][0][0]) > 180) projected = true;
    const e = desa.get(c) || { polys: [] }; e.polys.push(...polys); desa.set(c, e);
    const nm = (k, keys) => { if (!names.has(k)) { const v = pick(p, keys); if (v) names.set(k, titleCase(v)); } };
    nm(c.slice(0, 2), ['nmprov', 'wadmpr', 'provinsi', 'nama_prov']); nm(c.slice(0, 4), ['nmkab', 'wadmkk', 'kabupaten', 'nama_kab']);
    nm(c.slice(0, 7), ['nmkec', 'wadmkc', 'kecamatan', 'nama_kec']); nm(c, ['nmdesa', 'wadmkd', 'desa', 'kelurahan', 'nama_desa', 'namobj']);
  });
  if (projected) throw new Error('The file is in a projected coordinate system. Export it as WGS 84 (EPSG:4326) or upload the zipped SHP with its .prj file.');
  if (!desa.size) throw new Error('No BPS desa/kelurahan codes found (expected iddesa, idsls, or kdprov + kdkab + kdkec + kddesa).');
  const codes = [...desa.keys()].sort();
  const provinces = [...new Set(codes.map(c => c.slice(0, 2)))].map(code => ({ code, name: names.get(code) || (PROVINCES.find(p => p.code === code) || {}).name || code }));
  const cache = new Map(), LEN = [2, 4, 7, 10];
  function children(level, parent) {
    const key = level + '|' + parent; if (cache.has(key)) return cache.get(key);
    const n = LEN[level], groups = new Map();
    codes.forEach(c => { if (c.startsWith(parent)) { const g = c.slice(0, n); (groups.get(g) || groups.set(g, []).get(g)).push(...desa.get(c).polys); } });
    const out = [...groups].map(([code, polys]) => makeArea(code, names.get(code) || code, polys, level === 3 && desa.get(code).polys.length === 1 ? null : outlineOf(polys))).sort((a, b) => a.name.localeCompare(b.name));
    cache.set(key, out); return out;
  }
  return { key: 'bps|' + label + '|' + codes.length, label, desaCount: codes.length, skipped, provinces, children: (lv, parent) => Promise.resolve(children(lv, parent)) };
}
export const online = { key: 'online', label: 'Online fallback (GADM 4.1 / cahyadsn)', provinces: PROVINCES, children: loadChildren };

// Saved boundary files live in IndexedDB so they load again on the next visit.
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('gx-boundaries', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function saveFiles(files) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').put(files.map(f => ({ name: f.name, blob: f })), 'bps'); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
export async function loadSaved() { const db = await idb(); return new Promise(res => { const r = db.transaction('files').objectStore('files').get('bps'); r.onsuccess = () => res((r.result || []).map(x => new File([x.blob], x.name))); r.onerror = () => res([]); }); }
export async function clearSaved() { const db = await idb(); return new Promise(res => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').delete('bps'); t.oncomplete = res; t.onerror = res; }); }

export function concat(lists) {
  let n = 0; lists.forEach(l => { n += l.length; });
  const out = new Int32Array(n); let o = 0; lists.forEach(l => { out.set(l, o); o += l.length; });
  return out;
}
