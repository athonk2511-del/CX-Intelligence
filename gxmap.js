// GlobalXtreme BI — customer map on OpenStreetMap tiles (Leaflet).
// Points are painted on one canvas per redraw, so ~100k accounts stay fast.
const LV = '1.9.4';
let leaflet;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leaflet) return leaflet;
  leaflet = new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://unpkg.com/leaflet@' + LV + '/dist/leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@' + LV + '/dist/leaflet.js';
    s.onload = () => res(window.L); s.onerror = () => { leaflet = null; rej(new Error('Could not load the map library')); };
    document.head.appendChild(s);
  });
  return leaflet;
}
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtDate = v => { if (v == null || v === '') return '—'; const d = v instanceof Date ? v : null; return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : esc(v); };

// Fixed work-area grid. Web Mercator metres, corrected to true metres at 5°S, anchored at 95°E / 6°N
// so every cell keeps the same ID forever (independent of zoom, branch or filters).
const RE = 6378137, SEC = 1 / Math.cos(5 * Math.PI / 180);
const mx = lng => RE * lng * Math.PI / 180, my = lat => RE * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const lngOf = x => x / RE * 180 / Math.PI, latOf = y => (2 * Math.atan(Math.exp(y / RE)) - Math.PI / 2) * 180 / Math.PI;
const X0 = mx(95), Y0 = my(6);
export function cellOf(lat, lng, size) { const s = size * SEC; return [Math.floor((mx(lng) - X0) / s), Math.floor((Y0 - my(lat)) / s)]; }
export function cellKey(lat, lng, size) { const c = cellOf(lat, lng, size); return c[0] + ',' + c[1]; }
export function cellBounds(c, r, size) { const s = size * SEC; return [[latOf(Y0 - (r + 1) * s), lngOf(X0 + c * s)], [latOf(Y0 - r * s), lngOf(X0 + (c + 1) * s)]]; }
const colName = c => { let n = c + 1, out = ''; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; };
export function cellLabel(key) { const p = String(key).split(','); return colName(+p[0]) + '-' + (+p[1] + 1); }

export async function createMap(el, data, opts) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: true, worldCopyJump: false, minZoom: 4 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  map.setView([-2.5, 117], 5);
  let F = { colorBy: 'status', status: [true, true, true], hide: {}, branch: -1, wd: [true, true, false], wdOnly: false, display: 'points', heatCat: 'all', heatR: 20, ptA: 1, heatA: 0.8, areaA: 1 };
  let hitX = new Float32Array(0), hitY = new Float32Array(0), hitI = new Int32Array(0), hitN = 0, radius = 2;
  const canvas = L.DomUtil.create('canvas', '');
  canvas.style.position = 'absolute'; canvas.style.pointerEvents = 'none';
  const pane = map.getPanes().overlayPane; pane.appendChild(canvas);
  const base = i => !F.hide[data.product[i]] && (F.branch < 0 || data.branch[i] === F.branch);
  const ringOn = i => data.wd[i] >= 0 && F.wd[data.wd[i]];
  const visible = i => base(i) && (F.wdOnly ? ringOn(i) : F.status[data.status[i]]);
  const colorOf = i => F.colorBy === 'status' ? data.statuses[data.status[i]].color : data.products[data.product[i]].color;
  const groupOf = i => F.colorBy === 'status' ? data.status[i] : data.product[i];
  // Heatmap: bin visible points per few pixels, stamp a blurred sprite per bin, then colourise by intensity.
  let heatCv = null, sprite = null, spriteR = 0;
  const pals = {};
  const rgbOf = c => { const k = document.createElement('canvas'); k.width = k.height = 1; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 1, 1); return g.getImageData(0, 0, 1, 1).data; };
  function heatPal(color) {
    const key = color || '_';
    if (pals[key]) return pals[key];
    const k = document.createElement('canvas'); k.width = 256; k.height = 1;
    const g = k.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 0);
    if (color) {
      const c = rgbOf(color), m = (t, a) => 'rgb(' + [0, 1, 2].map(j => Math.round(c[j] + (t - c[j]) * a)).join(',') + ')';
      gr.addColorStop(0, m(255, 0.6)); gr.addColorStop(0.55, color); gr.addColorStop(1, m(0, 0.55));
    } else {
      gr.addColorStop(0, '#2F6FB3'); gr.addColorStop(0.35, '#13A08A'); gr.addColorStop(0.6, '#F2C230'); gr.addColorStop(0.82, '#E8730C'); gr.addColorStop(1, '#B42318');
    }
    g.fillStyle = gr; g.fillRect(0, 0, 256, 1);
    return (pals[key] = g.getImageData(0, 0, 256, 1).data);
  }
  function heatSpec() {
    const c = F.heatCat || 'all', n = +c.slice(1), inBr = i => F.branch < 0 || data.branch[i] === F.branch;
    if (c[0] === 's' && data.statuses[n]) return { pred: i => inBr(i) && !F.hide[data.product[i]] && data.status[i] === n, color: data.statuses[n].color };
    if (c[0] === 'w' && data.wdStatuses[n]) return { pred: i => inBr(i) && !F.hide[data.product[i]] && F.status[data.status[i]] && data.wd[i] === n, color: data.wdStatuses[n].color };
    if (c[0] === 'p' && data.products[n]) return { pred: i => inBr(i) && F.status[data.status[i]] && data.product[i] === n, color: data.products[n].color };
    return { pred: visible, color: null };
  }
  function drawHeat(ctx, sz) {
    const W = sz.x, H = sz.y; if (!W || !H) return;
    const r = Math.max(6, F.heatR || 20), cell = Math.max(2, Math.round(r / 4));
    if (spriteR !== r) {
      sprite = document.createElement('canvas'); sprite.width = sprite.height = r * 2;
      const g = sprite.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); spriteR = r;
    }
    const cw = Math.ceil((W + 2 * r) / cell) + 1, ch = Math.ceil((H + 2 * r) / cell) + 1, bins = new Float32Array(cw * ch);
    const b = map.getBounds().pad(0.15), S = b.getSouth(), N = b.getNorth(), Wl = b.getWest(), E = b.getEast(), spec = heatSpec();
    for (let i = 0; i < data.count; i++) {
      const a = data.lat[i], o = data.lng[i];
      if (a < S || a > N || o < Wl || o > E || !spec.pred(i)) continue;
      const p = map.latLngToContainerPoint([a, o]);
      if (p.x < -r || p.y < -r || p.x > W + r || p.y > H + r) continue;
      bins[Math.floor((p.y + r) / cell) * cw + Math.floor((p.x + r) / cell)]++;
    }
    const nz = []; for (let k = 0; k < bins.length; k++) if (bins[k]) nz.push(bins[k]);
    if (!nz.length) return;
    nz.sort((x, y) => x - y);
    const max = Math.max(1, nz[Math.floor(nz.length * 0.97)]);
    if (!heatCv) heatCv = document.createElement('canvas');
    heatCv.width = W; heatCv.height = H;
    const hc = heatCv.getContext('2d'); hc.clearRect(0, 0, W, H);
    for (let k = 0; k < bins.length; k++) {
      const v = bins[k]; if (!v) continue;
      hc.globalAlpha = Math.min(1, Math.max(0.06, v / max));
      hc.drawImage(sprite, (k % cw) * cell - r + cell / 2 - r, Math.floor(k / cw) * cell - r + cell / 2 - r);
    }
    const img = hc.getImageData(0, 0, W, H), d = img.data, pal = heatPal(spec.color);
    for (let j = 0; j < d.length; j += 4) {
      const a = d[j + 3]; if (!a) continue;
      const o = a * 4; d[j] = pal[o]; d[j + 1] = pal[o + 1]; d[j + 2] = pal[o + 2]; d[j + 3] = Math.min(255, a * 1.6);
    }
    hc.putImageData(img, 0, 0);
    ctx.globalAlpha = F.heatA == null ? 0.8 : F.heatA; ctx.drawImage(heatCv, 0, 0, W, H); ctx.globalAlpha = 1;
  }
  let G = { size: 1000, show: true, cells: {}, teams: {}, focus: null, edit: null }, onPaint = null, painting = null;

  function drawGrid(ctx, sz) {
    const s = G.size * SEC, b = map.getBounds(), ctr = b.getCenter();
    const c0 = Math.floor((mx(b.getWest()) - X0) / s), c1 = Math.floor((mx(b.getEast()) - X0) / s);
    const r0 = Math.floor((Y0 - my(b.getNorth())) / s), r1 = Math.floor((Y0 - my(b.getSouth())) / s);
    const X = c => map.latLngToContainerPoint([ctr.lat, lngOf(X0 + c * s)]).x;
    const Y = r => map.latLngToContainerPoint([latOf(Y0 - r * s), ctr.lng]).y;
    const px = X(c0 + 1) - X(c0), aA = F.areaA == null ? 1 : F.areaA;
    if (aA <= 0) return;
    const inView = [];
    for (const k in G.cells) {
      const t = G.teams[G.cells[k]]; if (!t) continue;
      const p = k.split(','), c = +p[0], r = +p[1];
      if (c < c0 || c > c1 || r < r0 || r > r1) continue;
      inView.push([c, r, G.cells[k], t]);
    }
    // Team fills, then team borders on edges where the neighbour belongs to another team (or none).
    inView.forEach(([c, r, id, t]) => {
      ctx.globalAlpha = (G.focus == null ? 0.22 : G.focus === id ? 0.34 : 0.1) * aA;
      ctx.fillStyle = t.color; const x = X(c), y = Y(r);
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(X(c + 1) - x) + 1, Math.ceil(Y(r + 1) - y) + 1);
    });
    if (G.show && px >= 5) {
      ctx.globalAlpha = (px >= 24 ? 0.22 : 0.12) * aA; ctx.strokeStyle = '#1F1F1D'; ctx.lineWidth = 1; ctx.beginPath();
      for (let c = c0; c <= c1 + 1; c++) { const x = Math.round(X(c)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, sz.y); }
      for (let r = r0; r <= r1 + 1; r++) { const y = Math.round(Y(r)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(sz.x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = aA; ctx.lineWidth = px >= 12 ? 2 : 1.2;
    inView.forEach(([c, r, id, t]) => {
      const x0 = X(c), x1 = X(c + 1), y0 = Y(r), y1 = Y(r + 1), nb = (dc, dr) => G.cells[(c + dc) + ',' + (r + dr)] !== id;
      ctx.strokeStyle = t.color; ctx.beginPath();
      if (nb(0, -1)) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
      if (nb(0, 1)) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
      if (nb(-1, 0)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
      if (nb(1, 0)) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
      ctx.stroke();
    });
    if (G.show && px >= 64) {
      ctx.font = "500 10px 'IBM Plex Mono',monospace"; ctx.textBaseline = 'top';
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const k = c + ',' + r, t = G.teams[G.cells[k]], x = X(c) + 5, y = Y(r) + 5;
        ctx.globalAlpha = 0.75 * aA; ctx.fillStyle = '#3A3A37'; ctx.fillText(cellLabel(k), x, y);
        if (t && px >= 90) { ctx.globalAlpha = aA; ctx.fillStyle = t.color; ctx.font = "600 11px 'IBM Plex Sans',system-ui,sans-serif"; ctx.fillText(t.name, x, y + 14); ctx.font = "500 10px 'IBM Plex Mono',monospace"; }
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    const sz = map.getSize(), dpr = window.devicePixelRatio || 1;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.style.width = sz.x + 'px'; canvas.style.height = sz.y + 'px';
    canvas.width = Math.round(sz.x * dpr); canvas.height = Math.round(sz.y * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, sz.x, sz.y);
    drawGrid(ctx, sz);
    if (F.display !== 'points') drawHeat(ctx, sz);
    if (F.display === 'heat') { hitN = 0; return; }
    const pA = F.ptA == null ? 1 : F.ptA;
    const z = map.getZoom();
    radius = z < 9 ? 1.3 : z < 11 ? 1.8 : z < 13 ? 2.6 : z < 15 ? 3.6 : 5;
    const b = map.getBounds().pad(0.05), S = b.getSouth(), N = b.getNorth(), W = b.getWest(), E = b.getEast();
    const groups = new Map();
    for (let i = 0; i < data.count; i++) {
      const a = data.lat[i], o = data.lng[i];
      if (a < S || a > N || o < W || o > E || !visible(i)) continue;
      const g = groupOf(i); let arr = groups.get(g); if (!arr) groups.set(g, arr = []); arr.push(i);
    }
    // Status: terminated underneath, blocked on top. Package: biggest group underneath.
    const order = F.colorBy === 'status' ? [2, 0, 1].filter(g => groups.has(g)) : [...groups.keys()].sort((x, y) => groups.get(y).length - groups.get(x).length);
    let total = 0; groups.forEach(a => { total += a.length; });
    if (hitX.length < total) { hitX = new Float32Array(total); hitY = new Float32Array(total); hitI = new Int32Array(total); }
    hitN = 0;
    const r = radius, big = r >= 2.5;
    ctx.globalAlpha = (big ? 0.85 : 0.75) * pA;
    order.forEach(g => {
      const ids = groups.get(g);
      ctx.fillStyle = colorOf(ids[0]); ctx.beginPath();
      for (const i of ids) {
        const p = map.latLngToContainerPoint([data.lat[i], data.lng[i]]);
        if (big) { ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, 6.2832); } else ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        hitX[hitN] = p.x; hitY[hitN] = p.y; hitI[hitN] = i; hitN++;
      }
      ctx.fill();
      if (z >= 14) { ctx.globalAlpha = pA; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 0.75; ctx.stroke(); ctx.globalAlpha = 0.85 * pA; }
    });
    // Wiredown overlay: hollow rings drawn above every dot, closed first so open stays on top.
    const rr = Math.max(r + 2.5, 4), rings = [[], [], []];
    for (let i = 0; i < data.count; i++) {
      const a = data.lat[i], o = data.lng[i];
      if (a < S || a > N || o < W || o > E || !ringOn(i) || !base(i)) continue;
      rings[data.wd[i]].push(i);
    }
    ctx.globalAlpha = pA; ctx.lineWidth = z < 11 ? 1.4 : 2;
    [2, 1, 0].forEach(s => {
      if (!rings[s].length) return;
      ctx.strokeStyle = data.wdStatuses[s].color; ctx.beginPath();
      for (const i of rings[s]) {
        const p = map.latLngToContainerPoint([data.lat[i], data.lng[i]]);
        ctx.moveTo(p.x + rr, p.y); ctx.arc(p.x, p.y, rr, 0, 6.2832);
        if (!visible(i)) { if (hitN >= hitX.length) { const g = n => { const x = new (n.constructor)(n.length * 2 + 16); x.set(n); return x; }; hitX = g(hitX); hitY = g(hitY); hitI = g(hitI); } hitX[hitN] = p.x; hitY[hitN] = p.y; hitI[hitN] = i; hitN++; }
      }
      ctx.stroke();
    });
  }
  function hit(pt) {
    const lim = (radius + 5) ** 2; let best = -1, bd = lim;
    for (let k = hitN - 1; k >= 0; k--) { const dx = hitX[k] - pt.x, dy = hitY[k] - pt.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = hitI[k]; } }
    return best;
  }
  map.on('moveend zoomend resize viewreset', draw);
  map.on('zoomstart', () => { canvas.style.opacity = 0; });
  map.on('zoomend', () => { canvas.style.opacity = 1; });
  let raf = 0;
  map.on('mousemove', e => { if (G.edit || raf) return; raf = requestAnimationFrame(() => { raf = 0; el.style.cursor = hit(e.containerPoint) >= 0 ? 'pointer' : ''; }); });
  map.on('click', e => { if (G.edit) return; const i = hit(e.containerPoint); if (i >= 0) { openAt(i); return; } if (adm && adm.onClick) { const a = adm.areas.find(x => adm.contains(x, e.latlng.lat, e.latlng.lng)); if (a) adm.onClick(a.code, e.latlng); } });
  map.createPane('gxAdmin').style.zIndex = 350; map.getPane('gxAdmin').style.pointerEvents = 'none';
  let adm = null, admLayer = null, admKey = null;
  function drawAdmin(a) {
    if (admLayer) { map.removeLayer(admLayer); admLayer = null; }
    adm = a; if (!a || !a.show) return;
    admLayer = L.layerGroup().addTo(map);
    const label = a.areas.length <= 90;
    a.areas.forEach(x => {
      const sel = x.code === a.sel || x.code === a.hi;
      if (sel) L.geoJSON(x.fill, { pane: 'gxAdmin', interactive: false, style: { stroke: false, fillColor: '#1F1F1D', fillOpacity: 0.08 } }).addTo(admLayer);
      const ly = L.geoJSON(x.geometry, { pane: 'gxAdmin', interactive: false, style: { color: sel ? '#1F1F1D' : '#3A3A37', weight: sel ? 2.5 : 1, opacity: sel ? 1 : 0.7, fill: false } }).addTo(admLayer);
      if (label && (!a.sel || sel)) L.tooltip({ permanent: true, direction: 'center', className: 'gx-adm-label', interactive: false }).setLatLng(x.center).setContent(esc(x.name.replace(/^(Kel|Kec|Kab|Kota|Desa)\.?\s+/i, ''))).addTo(admLayer);
    });
    if (a.parent) L.geoJSON(a.parent, { pane: 'gxAdmin', interactive: false, style: { color: '#1F1F1D', weight: 2, opacity: 0.9, fill: false, dashArray: '6 4' } }).addTo(admLayer);
  }
  if (!document.getElementById('gx-adm-css')) { const s = document.createElement('style'); s.id = 'gx-adm-css'; s.textContent = '.gx-adm-label{background:rgba(255,255,255,.82);border:0;box-shadow:none;padding:1px 4px;border-radius:2px;font:500 10.5px \'IBM Plex Sans\',system-ui,sans-serif;color:#1F1F1D;white-space:nowrap}.gx-adm-label:before{display:none}'; document.head.appendChild(s); }
  let pRaf = 0;
  const redrawSoon = () => { if (!pRaf) pRaf = requestAnimationFrame(() => { pRaf = 0; draw(); }); };
  function paintAt(ev) {
    const ll = map.containerPointToLatLng(map.mouseEventToContainerPoint(ev)), cr = cellOf(ll.lat, ll.lng, G.size), k0 = cr.join(',');
    if (painting.last === k0) return; painting.last = k0;
    const n = (G.edit.brush - 1) / 2, v = G.edit.erase ? null : G.edit.team;
    for (let dc = -n; dc <= n; dc++) for (let dr = -n; dr <= n; dr++) {
      const k = (cr[0] + dc) + ',' + (cr[1] + dr);
      if ((G.cells[k] || null) === v) continue;
      if (v) G.cells[k] = v; else delete G.cells[k];
      painting.changes[k] = v;
    }
    redrawSoon();
  }
  const onDown = ev => {
    if (!G.edit || ev.button !== 0 || ev.target.closest('.leaflet-control')) return;
    painting = { changes: {}, last: null }; el.setPointerCapture(ev.pointerId); ev.preventDefault(); ev.stopPropagation(); paintAt(ev);
  };
  const onMove = ev => { if (painting) paintAt(ev); };
  const onUp = () => { if (!painting) return; const ch = painting.changes; painting = null; if (Object.keys(ch).length && onPaint) onPaint(ch); };
  el.addEventListener('pointerdown', onDown, true); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  function gridRows(i) {
    const row = (k, v) => '<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#5F5F5B">' + k + '</span><span style="text-align:right">' + v + '</span></div>';
    const k = cellKey(data.lat[i], data.lng[i], G.size), t = G.teams[G.cells[k]];
    return row('Grid cell', esc(cellLabel(k))) + row('Work area', t ? '<span style="color:' + t.color + ';font-weight:600">' + esc(t.name) + '</span>' : 'Unassigned');
  }
  function openAt(i) {
    const st = data.statuses[data.status[i]], pr = data.products[data.product[i]];
    const row = (k, v) => '<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#5F5F5B">' + k + '</span><span style="text-align:right">' + v + '</span></div>';
    const head = '<div style="font:600 13px \'IBM Plex Sans\',system-ui,sans-serif;color:#1F1F1D;margin-bottom:6px">';
    const base = row('CID', esc(data.cid[i])) + row('UID', esc(data.uid[i] || '—')) + row('Status', '<span style="color:' + st.color + ';font-weight:600">' + esc(st.key) + '</span>') + row('Package', esc(pr.key)) + row('Branch', esc(data.branches[data.branch[i]]));
    const w = data.wdInfo[i];
    const wdRows = w ? '<div style="border-top:1px solid #DCDCD8;margin:4px 0 1px"></div>' + row('Wiredown WO', '<span style="color:' + data.wdStatuses[w.state].color + ';font-weight:600">' + esc(data.wdStatuses[w.state].key) + '</span>')
      + row('Latest WO', esc(w.wo)) + row('WO date', w.t ? new Date(w.t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—') + (w.n > 1 ? row('Wiredown WOs', esc(w.n)) : '') : '';
    const wrap = h => '<div style="font:400 12px \'IBM Plex Sans\',system-ui,sans-serif;color:#1F1F1D;min-width:220px;display:flex;flex-direction:column;gap:3px">' + h + '</div>';
    const popup = L.popup({ maxWidth: 320 }).setLatLng([data.lat[i], data.lng[i]])
      .setContent(wrap(head + esc(data.name[i] || 'Customer') + '</div>' + base + row('Plan', esc(data.variant[i] || '—')) + row('Area', esc(data.area[i] || '—')) + gridRows(i) + wdRows)).openOn(map);
    return popup;
  }
  let ring = null;
  const techLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map), techMarkers = new Map();
  let replayM = null, onTech = null, routeKey = null;
  const planLayer = L.layerGroup().addTo(map); let planKey = null;
  const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  // A tracker assigned to an IDS team is filled with the team colour and carries the team name as a tag.
  const techIcon = (d, sel, colors) => L.divIcon({
    className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: '<div style="position:relative;width:30px;height:30px;box-sizing:border-box;border-radius:50%;border:3px solid ' + colors[d.state] + ';background:' + (sel ? '#1F1F1D' : d.fill || '#FFFFFF') + ';color:' + (sel || d.fill ? '#FFFFFF' : '#1F1F1D') + ';display:flex;align-items:center;justify-content:center;font:600 10.5px \'IBM Plex Mono\',monospace;box-shadow:0 1px 4px rgba(0,0,0,.35)">' + esc(initials(d.tag || d.name)) +
      (d.tag ? '<span style="position:absolute;left:30px;top:3px;white-space:nowrap;padding:1px 6px;border-radius:3px;background:#FFFFFF;border:2px solid ' + d.fill + ';color:#1F1F1D;font:600 11px \'IBM Plex Sans\',sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.25)">' + esc(d.tag) + '</span>' : '') + '</div>',
  });
  // mark: 'done' = checked out (grey, 20 % opacity, green tick); 'revisit' = visited but the customer asks to reschedule.
  const woIcon = (n, color, mark) => {
    const done = mark === 'done', rv = mark === 'revisit';
    const bg = done ? 'rgba(140,140,136,.2)' : rv ? '#FCC419' : color, fg = done ? 'rgba(31,31,29,.45)' : rv ? '#1F1F1D' : '#FFFFFF', bd = done ? 'rgba(31,31,29,.25)' : '#1F1F1D';
    const badge = (c, t, txt) => '<span style="position:absolute;right:-7px;top:-7px;width:12px;height:12px;border-radius:50%;background:' + c + ';border:1.5px solid #FFFFFF;color:' + t + ';font:700 8px sans-serif;line-height:12px;text-align:center">' + txt + '</span>';
    return L.divIcon({
      className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      html: '<div style="position:relative;width:20px;height:20px;box-sizing:border-box;border-radius:3px;border:2px solid ' + bd + ';background:' + bg + ';color:' + fg + ';display:flex;align-items:center;justify-content:center;font:600 10px \'IBM Plex Mono\',monospace">' + n +
        (done ? badge('#2B8A3E', '#FFFFFF', '✓') : rv ? badge('#1F1F1D', '#FCC419', '↻') : '') + '</div>',
    });
  };
  function fit() {
    const la = [], lo = [];
    for (let i = 0; i < data.count; i++) if (visible(i)) { la.push(data.lat[i]); lo.push(data.lng[i]); }
    if (!la.length) return;
    la.sort((a, b) => a - b); lo.sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
    map.fitBounds([[q(la, 0.01), q(lo, 0.01)], [q(la, 0.99), q(lo, 0.99)]], { padding: [24, 24], maxZoom: 14 });
  }
  draw();
  return {
    set(next) { F = { ...F, ...next }; if (next.fit) fit(); draw(); },
    find(q) {
      const s = String(q || '').trim().toLowerCase(); if (!s) return -1;
      for (let i = 0; i < data.count; i++) if (String(data.cid[i]) === s || String(data.uid[i] || '').toLowerCase() === s) return i;
      return -1;
    },
    focus(i) {
      const ll = [data.lat[i], data.lng[i]];
      if (ring) ring.remove();
      ring = L.circleMarker(ll, { radius: 11, color: '#1F1F1D', weight: 2, fill: false, interactive: false }).addTo(map);
      map.setView(ll, Math.max(map.getZoom(), 17));
      setTimeout(() => openAt(i), 300);
    },
    setTechs(list, o) {
      onTech = o.onClick;
      if (!o.show) { techLayer.clearLayers(); techMarkers.clear(); return; }
      const seen = new Set();
      list.forEach(d => {
        if (d.lat == null) return;
        seen.add(d.id);
        const sel = o.sel === d.id, sig = d.state + '|' + sel + '|' + (d.tag || '') + '|' + (d.fill || '');
        let mk = techMarkers.get(d.id);
        if (!mk) {
          mk = L.marker([d.lat, d.lng], { icon: techIcon(d, sel, o.colors), zIndexOffset: sel ? 2000 : 1000 }).addTo(techLayer);
          mk.bindTooltip(esc(d.name), { direction: 'top', offset: [0, -16] });
          mk.on('click', () => onTech && onTech(d.id));
          mk._sig = sig; techMarkers.set(d.id, mk);
        } else {
          mk.setLatLng([d.lat, d.lng]);
          if (mk._sig !== sig) { mk.setIcon(techIcon(d, sel, o.colors)); mk.setZIndexOffset(sel ? 2000 : 1000); mk._sig = sig; }
        }
      });
      techMarkers.forEach((mk, id) => { if (!seen.has(id)) { techLayer.removeLayer(mk); techMarkers.delete(id); } });
    },
    showRoute(r) {
      const k = r ? r.key : null;
      if (k === routeKey) return;
      routeKey = k; routeLayer.clearLayers();
      if (!r || !r.points.length) return;
      const ll = r.points.map(p => [p.lat, p.lng]);
      L.polyline(ll, { color: '#FFFFFF', weight: 6, opacity: 0.9, interactive: false }).addTo(routeLayer);
      L.polyline(ll, { color: '#1F1F1D', weight: 3, opacity: 0.85, interactive: false }).addTo(routeLayer);
      r.wos.forEach((w, n) => {
        if (w.lat == null) return;
        L.circle([w.lat, w.lng], { radius: r.radius, color: r.colors[w.type] || '#1F1F1D', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(routeLayer);
        L.marker([w.lat, w.lng], { icon: woIcon(n + 1, r.colors[w.type] || '#1F1F1D'), zIndexOffset: 500 })
          .bindTooltip(esc(w.wo) + ' · ' + esc(w.name || w.cid), { direction: 'top', offset: [0, -10] }).addTo(routeLayer);
      });
      if (r.fit) map.fitBounds(L.latLngBounds(ll), { padding: [40, 40], maxZoom: 16 });
    },
    setReplay(p) {
      if (!p) { if (replayM) { replayM.remove(); replayM = null; } return; }
      if (!replayM) replayM = L.circleMarker([p.lat, p.lng], { radius: 8, color: '#1F1F1D', weight: 2, fillColor: '#F2C230', fillOpacity: 1, interactive: false }).addTo(map);
      else replayM.setLatLng([p.lat, p.lng]);
    },
    setGrid(g, cb) {
      onPaint = cb;
      G = { size: g.size, show: g.show, cells: { ...g.cells }, teams: g.teams, focus: g.focus, edit: g.edit };
      if (G.edit) { map.dragging.disable(); map.doubleClickZoom.disable(); el.style.cursor = 'crosshair'; }
      else { map.dragging.enable(); map.doubleClickZoom.enable(); el.style.cursor = ''; }
      draw();
    },
    fitCells(keys) {
      if (!keys.length) return;
      let b = null;
      keys.forEach(k => { const p = k.split(','), cb = cellBounds(+p[0], +p[1], G.size); b = b ? b.extend(cb) : L.latLngBounds(cb); });
      map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
    },
    setAdmin(a) {
      const k = a ? [a.key, a.sel, a.hi, a.show].join('|') : null;
      if (a && adm) adm.onClick = a.onClick;
      if (k === admKey) return; admKey = k; drawAdmin(a);
      if (a && a.fit && a.show) { const fb = L.geoJSON({ type: 'FeatureCollection', features: a.areas.filter(x => !a.sel || x.code === a.sel).map(x => ({ type: 'Feature', geometry: x.fill })) }).getBounds(); if (fb.isValid()) map.fitBounds(fb, { padding: [30, 30], maxZoom: 15 }); }
    },
    adminPopup(latlng, html, onAction) {
      const p = L.popup({ maxWidth: 340, minWidth: 260 }).setLatLng(latlng).setContent(html).openOn(map);
      const box = p.getElement();
      if (box) box.addEventListener('click', ev => { const b = ev.target.closest('[data-adm-act]'); if (b) { map.closePopup(p); onAction && onAction(b.getAttribute('data-adm-act')); } });
      return p;
    },
    // IDS dispatch plan: 3 km cells with jobs, one coloured route per team from the base, deferred jobs as rings.
    setPlan(p) {
      const k = p ? p.key : null;
      if (k === planKey) return;
      planKey = k; planLayer.clearLayers();
      if (!p) return;
      const BS = p.bases || [p.base], all = BS.map(b => [b.lat, b.lng]);
      p.cells.forEach(c => {
        const q = c.key.split(','), b = cellBounds(+q[0], +q[1], p.size);
        L.rectangle(b, { color: c.color, weight: 1.2, opacity: 0.9 * Math.min(1, (p.cellA ?? 0.36) * 2.5), fillColor: c.color, fillOpacity: p.cellA ?? 0.36 })
          .bindTooltip(c.tip.map(esc).join('<br>'), { sticky: true, direction: 'top' }).addTo(planLayer);
        if (c.rank <= 40) L.marker([(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], { interactive: false, zIndexOffset: 400, icon: L.divIcon({ className: '', iconSize: [34, 16], iconAnchor: [17, 8],
          html: '<div style="text-align:center;font:600 10.5px \'IBM Plex Mono\',ui-monospace,monospace;color:#FFFFFF;background:' + c.color + ';border:1px solid #FFFFFF;border-radius:3px;line-height:14px">#' + c.rank + '</div>' }) }).addTo(planLayer);
      });
      p.teams.forEach(t => {
        const ll = t.line;
        if (ll) {
          L.polyline(ll, { color: '#FFFFFF', weight: 6, opacity: 0.85 * (p.routeA ?? 1), interactive: false }).addTo(planLayer);
          L.polyline(ll, { color: t.color, weight: 3, opacity: 0.95 * (p.routeA ?? 1), interactive: false }).addTo(planLayer);
        }
        t.pts.forEach((x, n) => { all.push([x.lat, x.lng]); L.marker([x.lat, x.lng], { icon: woIcon(n + 1, t.color, x.mark), zIndexOffset: x.mark === 'done' ? 500 : x.mark ? 650 : 600 }).bindTooltip(esc(x.title), { direction: 'top', offset: [0, -10] }).addTo(planLayer); });
      });
      p.next.forEach(x => { all.push([x.lat, x.lng]); L.circleMarker([x.lat, x.lng], { radius: 6, color: '#D9480F', weight: 2.5, fillColor: '#FFFFFF', fillOpacity: 1 }).bindTooltip(esc(x.title), { direction: 'top' }).addTo(planLayer); });
      BS.forEach(bb => L.marker([bb.lat, bb.lng], { zIndexOffset: 700, icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div style="width:16px;height:16px;box-sizing:border-box;background:#1F1F1D;border:2px solid #E8B400;border-radius:2px"></div>' }) })
        .bindTooltip(esc(bb.title), { direction: 'top', offset: [0, -8] }).addTo(planLayer));
      if (p.fit && all.length > 1) map.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 15 });
    },
    panTo(lat, lng, z) { map.setView([lat, lng], Math.max(map.getZoom(), z || 15)); },
    resize() { map.invalidateSize(); },
    destroy() { map.remove(); },
  };
}
