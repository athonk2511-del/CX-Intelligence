// gxreport.js — Executive overview as a downloadable PDF (A4 portrait, vector text, IBM Plex fonts).
// The page passes a plain snapshot of the figures it already shows (see overview() in index.html);
// this module only lays them out. Nothing here queries data.

const LIBS = {
  jspdf: ['https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', 'https://unpkg.com/jspdf@4.2.1/dist/jspdf.umd.min.js'],
  autotable: ['https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.9/dist/jspdf.plugin.autotable.min.js', 'https://unpkg.com/jspdf-autotable@5.0.9/dist/jspdf.plugin.autotable.min.js'],
};
const ASSETS = { sans: 'fonts/GXReportSans-Regular.ttf', bold: 'fonts/GXReportSans-SemiBold.ttf', mono: 'fonts/GXReportMono-Medium.ttf', logo: 'gx-wordmark.png' };

/* ---------- loading ---------- */

function script(urls) {
  return urls.reduce((p, url) => p.catch(() => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url; s.async = true;
    s.onload = res; s.onerror = () => { s.remove(); rej(new Error('Could not load ' + url)); };
    document.head.appendChild(s);
  })), Promise.reject(new Error('start')));
}
let libP = null;
export function loadLibs() {
  return libP || (libP = (async () => {
    if (!(window.jspdf && window.jspdf.jsPDF)) await script(LIBS.jspdf);
    if (typeof window.autoTable !== 'function') await script(LIBS.autotable);
    if (!(window.jspdf && window.jspdf.jsPDF) || typeof window.autoTable !== 'function') throw new Error('The PDF library did not load.');
    return { jsPDF: window.jspdf.jsPDF, autoTable: window.autoTable };
  })().catch(e => { libP = null; throw e; }));
}
function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
let assetP = null;
// Fonts and logo are optional: without them the report falls back to Helvetica and a text wordmark.
export function loadAssets() {
  return assetP || (assetP = (async () => {
    const get = async p => { try { const r = await fetch(new URL(p, document.baseURI)); if (!r.ok) return null; return b64(await r.arrayBuffer()); } catch (e) { return null; } };
    const [sans, bold, mono, logo] = await Promise.all([get(ASSETS.sans), get(ASSETS.bold), get(ASSETS.mono), get(ASSETS.logo)]);
    return { sans, bold, mono, logo: logo ? 'data:image/png;base64,' + logo : null, logoRatio: 800 / 117 };
  })());
}

export async function downloadOverviewPdf(model) {
  const [libs, assets] = await Promise.all([loadLibs(), loadAssets()]);
  const doc = buildOverviewPdf(model, { ...libs, assets });
  doc.save(fileName(model));
  return doc;
}

export async function downloadPagePdf(model) {
  const [libs, assets] = await Promise.all([loadLibs(), loadAssets()]);
  const doc = buildPagePdf(model, { ...libs, assets });
  doc.save(fileName(model, model.file));
  return doc;
}

export function fileName(m, prefix) {
  const now = m.now || new Date(), z = n => String(n).padStart(2, '0');
  const slug = s => String(s || '').replace(/^GlobalXtreme\s*/i, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
  return 'GX-CX-' + (prefix || 'Executive-Overview') + '_' + slug(m.period) + '_' + slug(m.branch) + '_' + now.getFullYear() + z(now.getMonth() + 1) + z(now.getDate()) + '-' + z(now.getHours()) + z(now.getMinutes()) + '.pdf';
}

/* ---------- formatting ---------- */

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fI = n => (Math.round(n) || 0).toLocaleString('en-US');
const fRp = n => 'Rp ' + (Math.round(n) || 0).toLocaleString('id-ID');
const fP = (n, d = 1) => (n * 100).toFixed(d) + '%';
const sh = (a, b) => b ? fP(a / b) : '—';
const fD = d => d ? d.getDate() + ' ' + MON3[d.getMonth()] : '—';
const fDT = d => d ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : '—';

const C = {
  ink: '#1F1F1D', ink2: '#3A3A37', muted: '#5F5F5B', faint: '#8C8C88', line: '#DCDCD8', line2: '#EBEBE7', bg: '#F4F4F2', track: '#EDEDEA',
  accent: '#E8B400', good: '#2E6B34', bad: '#9B2C1F', blue: '#3E5C76', orange: '#C4561B', plum: '#8A3B6E', steel: '#9DB0C2', gold: '#B08A1E', violet: '#5B4E8C',
};

/* ---------- builder ---------- */

/* ---------- shared kit: fonts, layout helpers, header, footer ---------- */

function kit({ jsPDF, autoTable, assets }) {
  const A = assets || {};
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const plex = !!(A.sans && A.bold && A.mono);
  if (plex) {
    doc.addFileToVFS('GXR-R.ttf', A.sans); doc.addFont('GXR-R.ttf', 'GXReportSans', 'normal');
    doc.addFileToVFS('GXR-B.ttf', A.bold); doc.addFont('GXR-B.ttf', 'GXReportSans', 'bold');
    doc.addFileToVFS('GXR-M.ttf', A.mono); doc.addFont('GXR-M.ttf', 'GXReportMono', 'normal');
  }
  const F = plex ? { sans: ['GXReportSans', 'normal'], bold: ['GXReportSans', 'bold'], mono: ['GXReportMono', 'normal'] }
    : { sans: ['helvetica', 'normal'], bold: ['helvetica', 'bold'], mono: ['helvetica', 'normal'] };
  // Keep only characters the embedded fonts carry (emoji in survey text would print as boxes).
  const KEEP = plex ? /[ -~ -ÿ‐-‧‰′″‹›€™←-↕−≤≥]/
    : /[ -~ -ÿ–—‘’“”•…€]/;
  const FALL = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '−': '-', '‑': '-', '‐': '-' };
  const S = v => {
    if (v == null) return '';
    let s = String(v).replace(/\s+/g, ' ').trim(), o = '';
    for (const ch of s) o += KEEP.test(ch) ? ch : (FALL[ch] || '');
    return o.replace(/\s{2,}/g, ' ');
  };
  const SL = v => String(v == null ? '' : v).split('\n').map(S).join('\n');

  const W = 210, H = 297, M = 14, CW = W - 2 * M, TOP = 24, BOT = 17;
  const R = { y: 0 };
  const font = (k, size, color) => { doc.setFont(F[k][0], F[k][1]); doc.setFontSize(size); doc.setTextColor(color || C.ink); };
  const lh = size => size * 1.32 * 0.3528;
  const lines = (text, w, k, size) => { font(k, size); return doc.splitTextToSize(S(text), w); };
  const para = (text, x, y, w, k, size, color, draw = true, align) => {
    const ls = lines(text, w, k, size);
    if (draw && ls.length) { font(k, size, color); doc.text(ls, align === 'right' ? x + w : x, y, { baseline: 'top', align: align || 'left', lineHeightFactor: 1.32 }); }
    return ls.length * lh(size);
  };
  const caps = (text, x, y, size, color, k, align) => {
    font(k || 'mono', size, color || C.muted);
    doc.text(S(text).toUpperCase(), x, y, { baseline: 'top', charSpace: size * 0.018, align: align || 'left' });
  };
  const capsW = (text, size, k) => { font(k || 'mono', size); const t = S(text).toUpperCase(); return doc.getTextWidth(t) + t.length * size * 0.018; };
  const newPage = () => { doc.addPage(); R.y = TOP; };
  const ensure = h => { if (R.y + h > H - BOT) newPage(); };
  const gap = mm => { R.y += mm; };

  /* blocks: f(x, y, w, draw) -> height */
  const row = (blocks, gapX = 8) => {
    const n = blocks.length, w = (CW - gapX * (n - 1)) / n;
    const hs = blocks.map(b => b(0, 0, w, false));
    const h = Math.max(...hs);
    ensure(h);
    blocks.forEach((b, i) => b(M + i * (w + gapX), R.y, w, true));
    R.y += h;
  };
  const one = b => { const h = b(M, 0, CW, false); ensure(h); b(M, R.y, CW, true); R.y += h; };

  const section = (title, sub) => {
    const subH = sub ? para(sub, 0, 0, CW, 'sans', 8, C.muted, false) : 0;
    if (R.y > TOP + 1) R.y += 7;
    ensure(9 + subH + 40);
    caps(title, M, R.y, 9, C.ink, 'bold');
    const tw = capsW(title, 9, 'bold');
    doc.setFillColor(C.accent); doc.rect(M, R.y + 4.6, tw, 0.7, 'F');
    R.y += 7.5;
    if (sub) { para(sub, M, R.y, CW, 'sans', 8, C.muted); R.y += subH; }
    R.y += 3;
  };
  const blockTitle = (title, meta, x, y, w, draw) => {
    if (draw) {
      caps(title, x, y, 6.8, C.ink, 'bold');
      if (meta) { font('mono', 6.8, C.muted); doc.text(S(meta), x + w, y, { baseline: 'top', align: 'right' }); }
      doc.setDrawColor(C.line2); doc.setLineWidth(0.2); doc.line(x, y + 4.2, x + w, y + 4.2);
    }
    return 6;
  };
  const note = (text, k) => {
    if (!text) return;
    const h = para(text, 0, 0, CW, 'sans', 7, C.faint, false);
    ensure(h + 1);
    para(text, M, R.y + 1, CW, k || 'sans', 7, C.faint);
    R.y += h + 1.5;
  };
  const noteBlock = text => (x, y, w, draw) => text ? para(text, x, y + 1, w, 'sans', 7, C.faint, draw) + 1.5 : 0;
  const stack = (...bs) => (x, y, w, draw) => { let h = 0; bs.filter(Boolean).forEach(b => { h += b(x, y + h, w, draw); }); return h; };
  const spacer = mm => () => mm;
  const titled = (title, meta, b) => stack((x, y, w, d) => blockTitle(title, meta, x, y, w, d), b);

  const hbar = (parts, total, hgt = 5) => (x, y, w, draw) => {
    if (draw) {
      doc.setFillColor(C.track); doc.rect(x, y, w, hgt, 'F');
      let cx = x; const T = total || 1;
      parts.filter(p => p.value > 0).forEach(p => {
        const pw = w * p.value / T; doc.setFillColor(p.color); doc.rect(cx, y, pw, hgt, 'F');
        doc.setFillColor('#FFFFFF'); doc.rect(cx + pw - 0.25, y, 0.25, hgt, 'F'); cx += pw;
      });
    }
    return hgt + 3;
  };
  const tiles = (parts, cols) => (x, y, w, draw) => {
    const n = cols || parts.length, g = 4, tw = (w - g * (n - 1)) / n;
    let top = 0, total = 0;
    for (let i = 0; i < parts.length; i += n) {
      const rowP = parts.slice(i, i + n);
      const labH = Math.max(...rowP.map(p => para(p.label, 0, 0, tw, 'mono', 6.2, null, false)));
      const subH = Math.max(0, ...rowP.map(p => p.sub ? 0.6 + para(p.sub, 0, 0, tw, 'sans', 6.8, null, false) : 0));
      const rh = 2.2 + labH + 1 + lh(12) + subH;
      if (draw) rowP.forEach((p, j) => {
        const tx = x + j * (tw + g); let ty = y + top;
        doc.setFillColor(p.color || C.ink); doc.rect(tx, ty, tw, 0.7, 'F'); ty += 2.2;
        font('mono', 6.2, C.muted); const ll = doc.splitTextToSize(S(p.label).toUpperCase(), tw);
        doc.text(ll, tx, ty, { baseline: 'top', lineHeightFactor: 1.32 }); ty += labH + 1;
        font('mono', 12, p.valueColor || C.ink); doc.text(S(p.value), tx, ty, { baseline: 'top' }); ty += lh(12) + 0.6;
        if (p.sub) para(p.sub, tx, ty, tw, 'sans', 6.8, C.muted);
      });
      top += rh + (i + n < parts.length ? 4 : 0);
    }
    total = top + 3;
    return total;
  };
  const rank = (data, total, color, opt = {}) => (x, y, w, draw) => {
    if (!data || !data.length) return para(opt.empty || 'No data in this period.', x, y, w, 'sans', 7.5, C.muted, draw) + 2;
    const top = Math.max(1, ...data.map(d => d.value));
    let h = 0;
    data.forEach((d, i) => {
      const val = (opt.fmt ? opt.fmt(d.value) : fI(d.value)) + (total ? '  ·  ' + fP(d.value / total) : '');
      font('mono', 7, C.muted); const vw = doc.getTextWidth(S(val));
      font('sans', 7.6); let label = S(d.key || d.label);
      while (label.length > 3 && doc.getTextWidth(label) > w - vw - 3) label = label.slice(0, -2).trimEnd() + '…';
      if (draw) {
        font('sans', 7.6, C.ink); doc.text(label, x, y + h, { baseline: 'top' });
        font('mono', 7, C.muted); doc.text(S(val), x + w, y + h + 0.3, { baseline: 'top', align: 'right' });
        doc.setFillColor(C.track); doc.rect(x, y + h + 4, w, 1.5, 'F');
        doc.setFillColor(opt.colorBy ? opt.colorBy(d, i) : color); doc.rect(x, y + h + 4, Math.max(w * 0.015, w * d.value / top), 1.5, 'F');
      }
      h += 7.6;
    });
    return h + 1;
  };
  const legend = items => (x, y, w, draw) => {
    let cx = x, cy = 0;
    items.forEach(it => {
      font('sans', 7.2); const tw = 3.4 + doc.getTextWidth(S(it.label)) + 5;
      if (cx + tw > x + w) { cx = x; cy += 4.2; }
      if (draw) { doc.setFillColor(it.color); doc.rect(cx, y + cy + 0.6, 2.2, 2.2, 'F'); font('sans', 7.2, C.ink); doc.text(S(it.label), cx + 3.4, y + cy, { baseline: 'top' }); }
      cx += tw;
    });
    return cy + 6;
  };

  /* tables */
  const table = (head, body, o = {}) => {
    ensure(o.minSpace || 18);
    const numeric = o.numeric !== false;
    const colStyles = {};
    head.forEach((_, i) => {
      if (i && numeric) colStyles[i] = { halign: 'right', font: F.mono[0], fontStyle: F.mono[1], fontSize: 7.2 };
    });
    Object.entries(o.columnStyles || {}).forEach(([k, v]) => { colStyles[k] = { ...(colStyles[k] || {}), ...v }; });
    autoTable(doc, {
      startY: R.y, head: [head.map(h => Array.isArray(h) ? h.map(S).join('\n') : S(h))],
      body: body.map(r => r.map(c => c && typeof c === 'object' && !Array.isArray(c) ? { ...c, content: SL(c.content) } : SL(c))),
      margin: { left: o.left != null ? o.left : M, right: o.right != null ? o.right : M, top: TOP, bottom: BOT },
      tableWidth: o.width || 'auto', theme: 'plain', rowPageBreak: 'avoid', showHead: 'everyPage',
      styles: { font: F.sans[0], fontStyle: F.sans[1], fontSize: 7.4, textColor: C.ink, cellPadding: { top: 1.5, bottom: 1.5, left: 1.8, right: 1.8 }, lineColor: C.line2, lineWidth: { bottom: 0.15 }, valign: 'top', overflow: 'linebreak' },
      headStyles: { font: F.mono[0], fontStyle: F.mono[1], fontSize: 6.2, textColor: C.muted, fillColor: C.bg, lineColor: C.line, lineWidth: { bottom: 0.3 }, valign: 'bottom' },
      columnStyles: colStyles,
      didParseCell: d => {
        if (d.section === 'head') { d.cell.text = d.cell.text.map(t => t.toUpperCase()); if (d.column.index && numeric) d.cell.styles.halign = 'right'; }
        if (d.section === 'body' && d.cell.raw && d.cell.raw.color) d.cell.styles.textColor = d.cell.raw.color;
        if (o.didParseCell) o.didParseCell(d);
      },
      didDrawCell: o.didDrawCell,
    });
    R.y = doc.lastAutoTable.finalY + 2;
  };
  const chgCell = c => ({ content: c.txt, color: c.color });

  // Page 1 header. o: { label, kicker, title, period, branch, synced, now, by, sub, kpis, kc }
  const header = o => {
    /* ---------- page 1 header ---------- */
    R.y = 12;
    if (A.logo) { try { doc.addImage(A.logo, 'PNG', M, R.y, 5.4 * A.logoRatio, 5.4, 'gxlogo', 'FAST'); } catch (e) { font('bold', 13); doc.text('globalxtreme', M, R.y, { baseline: 'top' }); } }
    else { font('bold', 13, C.ink); doc.text('globalxtreme', M, R.y, { baseline: 'top' }); }
    caps('CX Intelligence', W - M, R.y, 7, C.ink, 'bold', 'right');
    caps(o.label || 'Report', W - M, R.y + 3.6, 6.4, C.muted, 'mono', 'right');
    R.y += 9;
    doc.setDrawColor(C.line); doc.setLineWidth(0.25); doc.line(M, R.y, W - M, R.y);
    doc.setFillColor(C.accent); doc.rect(M, R.y - 0.4, 22, 0.8, 'F');
    R.y += 6;
    caps(o.kicker || 'Customer Service & Customer Experience', M, R.y, 7, C.muted);
    R.y += 4.5;
    const tl = lines(o.title || '', CW, 'bold', 19); font('bold', 19, C.ink); doc.text(tl, M, R.y, { baseline: 'top', lineHeightFactor: 1.15 });
    R.y += 10 + (tl.length - 1) * 19 * 1.15 * 0.3528;
    const fields = [['Period', o.period], ['Branch', o.branch], ['Data as of', o.synced ? fDT(o.synced) : '—'], ['Generated', fDT(o.now || new Date()) + (o.by ? '\nby ' + o.by : '')]];
    const fw = CW / 4;
    let fh = 0;
    fields.forEach(([k, v], i) => {
      const x = M + i * fw;
      caps(k, x, R.y, 6, C.muted);
      font(i < 2 ? 'bold' : 'sans', i < 2 ? 9 : 7.6, C.ink);
      const ls = String(v).split('\n').flatMap(t => doc.splitTextToSize(S(t), fw - 4));
      doc.text(ls, x, R.y + 3.6, { baseline: 'top', lineHeightFactor: 1.32 });
      fh = Math.max(fh, 3.6 + ls.length * lh(i < 2 ? 9 : 7.6));
      if (i) { doc.setDrawColor(C.line2); doc.setLineWidth(0.2); doc.line(x - 2, R.y, x - 2, R.y + 9); }
    });
    R.y += fh + 4;
    R.y += para(o.sub || '', M, R.y, CW, 'sans', 8, C.muted) + 4;

    // KPI strip: 3 × 2 boxes like the dashboard header row.
    const kp = o.kpis || [], kc = o.kc || 3, kw = CW / kc;
    const kh = kp.length ? Math.max(...kp.map(k => 3 + lh(6.2) + 1.2 + lh(14) + 1 + para(k.sub, 0, 0, kw - 6, 'sans', 7, null, false) + 3)) : 0;
    const kRows = Math.ceil(kp.length / kc);
    if (kp.length) {
      doc.setDrawColor(C.line); doc.setLineWidth(0.25); doc.rect(M, R.y, CW, kh * kRows);
      kp.forEach((k, i) => {
        const cx = M + (i % kc) * kw, cy = R.y + Math.floor(i / kc) * kh;
        if (i % kc) { doc.setDrawColor(C.line); doc.line(cx, cy, cx, cy + kh); }
        if (i >= kc && i % kc === 0) doc.line(M, cy, M + CW, cy);
        caps(k.label, cx + 3, cy + 3, 6.2, C.muted);
        font('mono', 14, C.ink); doc.text(S(k.value), cx + 3, cy + 3 + lh(6.2) + 1.2, { baseline: 'top' });
        para(k.sub, cx + 3, cy + 3 + lh(6.2) + 1.2 + lh(14) + 1, kw - 6, 'sans', 7, C.muted);
      });
      R.y += kh * kRows + 2;
    }
  };

  // Week / month / year comparison table; mets from trendMetrics().
  const trends = (T, mets, o = {}) => {
    if (!T) note('The comparison was still loading when this report was generated. Open the overview again after a few seconds and download again to include it.');
    else if (T.error || T.empty) note(T.error || 'No dated tickets yet.');
    else {
      const chg = (cur, prev, mt, covered) => {
        if (!covered || cur == null || prev == null) return { txt: 'no data', color: C.faint };
        let dir, txt;
        if (mt.mode === 'pp') { const dv = (cur - prev) * 100; dir = Math.abs(dv) < 0.05 ? 0 : Math.sign(dv); txt = (dv >= 0 ? '+' : '') + dv.toFixed(1) + ' pp'; }
        else if (mt.mode === 'score') { const dv = cur - prev; dir = Math.abs(dv) < 0.005 ? 0 : Math.sign(dv); txt = (dv >= 0 ? '+' : '') + dv.toFixed(2); }
        else if (mt.mode === 'abs') { const dv = cur - prev; dir = Math.sign(dv); txt = (dv >= 0 ? '+' : '') + fI(dv); }
        else { if (!prev) return { txt: cur ? 'new' : '–', color: C.faint }; const r = (cur - prev) / prev; dir = Math.abs(r) < 0.005 ? 0 : Math.sign(r); txt = (r >= 0 ? '+' : '') + (r * 100).toFixed(1) + '%'; }
        const good = mt.better === 'up' ? dir > 0 : dir < 0;
        return { txt, color: !dir || !mt.better ? C.muted : good ? C.good : C.bad };
      };
      const c = (mt, a, b) => chgCell(chg(mt.get(a), mt.get(b), mt, b.covered));
      table(['Metric', ['Last 7 days', fD(T.week.from) + ' – ' + fD(T.week.to)], 'vs prior week', ['Month to date', fD(T.mtd.from) + ' – ' + fD(T.mtd.to)], 'vs last month', 'vs last year',
        ['Year to date', fD(T.ytd.from) + ' – ' + fD(T.ytd.to) + ' ' + T.ref.getFullYear()], 'vs last year'],
        mets.map(mt => [mt.label + (mt.csat && o.branchFiltered ? ' *' : ''), mt.fmt(mt.get(T.week)), c(mt, T.week, T.prevWeek), mt.fmt(mt.get(T.mtd)), c(mt, T.mtd, T.prevMtd), c(mt, T.mtd, T.lyMtd), mt.fmt(mt.get(T.ytd)), c(mt, T.ytd, T.lyYtd)]),
        { columnStyles: { 0: { cellWidth: 38 } } });
      if (!o.noNote) note('Complete days up to ' + fD(T.ref) + ' ' + T.ref.getFullYear() + '. Last month and last year use days 1–' + T.ref.getDate() + ' only.' + (o.branchFiltered && mets.some(x => x.csat) ? ' * CSAT is not split by branch.' : ''));
    }
  };

  // Month-on-month and year-on-year accounts table.
  const mom = (g, sw, bl, now, o = {}) => {
    if (!g || !g.monthlySeries) return;
    gap(2);
    now = now || new Date(); const L = now.getFullYear() * 12 + now.getMonth() - 1;
    const by = new Map(g.monthlySeries.map(x => [x.mk, x])), minMk = Math.min(...g.monthlySeries.map(x => x.mk));
    const lab = mk => MON3[mk % 12] + " '" + String(Math.floor(mk / 12)).slice(2);
    const fromSeries = fn => mk => mk < minMk ? null : fn(by.get(mk) || { added: 0, lost: 0 });
    const fromMap = (src, ok) => mk => ok ? (src[mk] || 0) : null;
    const rows = [
      { label: 'New activations', get: fromSeries(x => x.added), better: 'up' },
      { label: 'Terminations', get: fromSeries(x => x.lost), better: 'down' },
      { label: 'Net change', get: fromSeries(x => x.added - x.lost), better: 'up', mode: 'abs', sign: true },
      { label: 'True churn', get: fromMap(sw && sw.realByMonth || {}, !!(sw && sw.realByMonth)), better: 'down' },
      { label: 'Blocked accounts', get: fromMap(bl && bl.byMonth || {}, !!(bl && bl.byMonth)), better: 'down' },
    ];
    const fv = (mt, v) => v == null ? '—' : (mt.sign && v > 0 ? '+' : '') + fI(v);
    const cg = (mt, mk) => {
      const cur = mt.get(L), prev = mt.get(mk);
      if (cur == null || prev == null) return { content: 'no data', color: C.faint };
      let dir, txt;
      if (mt.mode === 'abs') { const dv = cur - prev; dir = Math.sign(dv); txt = (dv >= 0 ? '+' : '') + fI(dv); }
      else { if (!prev) return { content: cur ? 'new' : '–', color: C.faint }; const r = (cur - prev) / prev; dir = Math.abs(r) < 0.005 ? 0 : Math.sign(r); txt = (r >= 0 ? '+' : '') + (r * 100).toFixed(1) + '%'; }
      const good = mt.better === 'up' ? dir > 0 : dir < 0;
      return { content: txt, color: !dir ? C.muted : good ? C.good : C.bad };
    };
    ensure(50);
    one((x, y, w, d) => blockTitle('Month-on-month and year-on-year accounts', 'last complete month · ' + lab(L), x, y, w, d));
    table(['Metric', lab(L), 'MoM change', lab(L - 1), 'YoY change', lab(L - 12)],
      rows.map(mt => [mt.label, fv(mt, mt.get(L)), cg(mt, L - 1), fv(mt, mt.get(L - 1)), cg(mt, L - 12), fv(mt, mt.get(L - 12))]),
      { columnStyles: { 0: { cellWidth: 46 } } });
    note(lab(L + 1) + ' is still running, so the latest complete month is compared.' + (o.note ? ' ' + o.note : ''));
  };

  const aiNotes = ai => {
    if (!ai || !ai.notes) return;
    const n = ai.notes, sw = n.swot || {}, rm = n.roadmap || {};
    newPage();
    section('Consultant notes · AI', 'An operational SWOT of the Customer Service division and recommended milestones, written by an AI consultant from the figures in this report.');
    if (n.headline) { one((x, y, w, d) => para(n.headline, x, y, w, 'bold', 10.5, C.ink, d) + 4); }
    const quad = (title, items, color) => (x, y, w, d) => {
      let h = 3;
      if (d) { doc.setFillColor(color); doc.rect(x, y, w, 0.7, 'F'); }
      if (d) caps(title, x, y + h, 6.8, color, 'bold'); h += 5.5;
      (items || []).forEach(t => {
        const hh = para(t, x + 3.2, y + h, w - 3.2, 'sans', 7.8, C.ink, d);
        if (d) { doc.setFillColor(color); doc.rect(x, y + h + 1.1, 1.3, 1.3, 'F'); }
        h += hh + 1.6;
      });
      return h + 2;
    };
    row([quad('Strengths', sw.strengths, C.good), quad('Weaknesses', sw.weaknesses, C.bad)]);
    gap(3);
    row([quad('Opportunities', sw.opportunities, C.blue), quad('Threats', sw.threats, C.orange)]);
    gap(4);
    const phases = [['Short term', '0–3 months', 'short'], ['Mid term', '3–6 months', 'mid'], ['Long term', '6–12 months', 'long']];
    const rmRows = [];
    phases.forEach(([t, wnd, k]) => (rm[k] || []).forEach((it, i) => rmRows.push([i ? '' : t + '\n' + wnd, typeof it === 'string' ? it : it.action, typeof it === 'string' ? '' : (it.owner || ''), typeof it === 'string' ? '' : (it.kpi || '')])));
    if (rmRows.length) {
      ensure(40); one((x, y, w, d) => blockTitle('Recommended milestones', '', x, y, w, d));
      table(['Phase', 'Action', 'Owner', 'KPI'], rmRows, { numeric: false, columnStyles: { 0: { cellWidth: 24, font: F.bold[0], fontStyle: F.bold[1] }, 2: { cellWidth: 30 }, 3: { cellWidth: 42 } } });
    }
    note('AI-generated from the figures in this report' + (ai.at ? ' on ' + fDT(new Date(ai.at)) : '') + '. Check the figures before acting on a recommendation.');
  };

  const finish = (label, props) => {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (i > 1) {
        if (A.logo) { try { doc.addImage(A.logo, 'PNG', M, 9, 3.6 * A.logoRatio, 3.6, 'gxlogo', 'FAST'); } catch (e) {} }
        else { font('bold', 9, C.ink); doc.text('globalxtreme', M, 9, { baseline: 'top' }); }
        font('mono', 6.6, C.muted);
        doc.text(S(label), W - M, 10, { baseline: 'top', align: 'right' });
        doc.setDrawColor(C.line); doc.setLineWidth(0.25); doc.line(M, 15.5, W - M, 15.5);
      }
      doc.setDrawColor(C.line); doc.setLineWidth(0.2); doc.line(M, H - 11.5, W - M, H - 11.5);
      font('mono', 6.3, C.faint);
      doc.text(S('CX Intelligence · GlobalXtreme · PT. Internet Madju Abad Milenindo · Internal & confidential'), M, H - 8.6, { baseline: 'top' });
      doc.text('Page ' + i + ' of ' + pages, W - M, H - 8.6, { baseline: 'top', align: 'right' });
    }
    doc.setProperties(props);
    return doc;
  };

  return { doc, A, F, S, SL, W, H, M, CW, TOP, BOT, R, font, lh, lines, para, caps, capsW, newPage, ensure, gap, row, one, section, blockTitle, note, noteBlock, stack, spacer, titled, hbar, tiles, rank, legend, table, chgCell, header, trends, mom, aiNotes, finish };
}

// Rows for the week / month / year table. ids: 't' ticket rows, 'c' CSAT rows; score adds the CSAT average.
export function trendMetrics(ids, score) {
  const pct = v => v == null ? '—' : fP(v);
  return [
    { id: 't', label: 'Trouble tickets', get: x => x.tickets, fmt: fI, better: 'down' },
    { id: 't', label: 'Complaints', get: x => x.complaints, fmt: fI, better: 'down' },
    { id: 't', label: 'Complaint share', get: x => x.tickets ? x.complaints / x.tickets : null, fmt: pct, better: 'down', mode: 'pp' },
    { id: 't', label: 'Mass-problem tickets', get: x => x.mass, fmt: fI, better: 'down' },
    { id: 't', label: 'Work orders raised', get: x => x.wo, fmt: fI },
    { id: 'c', label: 'CSAT (rated 4–5)', get: x => x.csatN ? x.csatTop2 / x.csatN : null, fmt: pct, better: 'up', mode: 'pp', csat: true },
    { id: 'c', label: 'CSAT average', get: x => x.csatN ? x.csatScore / x.csatN : null, fmt: v => v == null ? '—' : v.toFixed(2), better: 'up', mode: 'score', csat: true, score: true },
    { id: 'c', label: 'CSAT responses', get: x => x.csatN, fmt: fI, csat: true },
  ].filter(x => ids.includes(x.id) && (score || !x.score));
}

export function buildOverviewPdf(m, libs) {
  const K = kit(libs);
  const { doc, A, F, S, SL, M, CW, R, para, caps, ensure, gap, row, one, section, blockTitle, note, noteBlock, stack, spacer, titled, hbar, tiles, rank, legend, table, newPage, lh, font, capsW } = K;
  K.header({ label: 'Executive overview report', kicker: 'Customer Service & Customer Experience', title: 'Executive summary', period: m.period, branch: m.branch, synced: m.synced, now: m.now, by: m.by, sub: m.sub, kpis: m.kpis });

  /* ---------- 1. Customer Service demand ---------- */
  const f = m.flow;
  section('Customer Service demand', 'Every ticket that reached Customer Service in the period, and the route it took: closed by the CSO, escalated to CTSO, or sent to the field as a work order.');
  const flowParts = [
    { label: 'Resolved by CSO', value: f.cso, color: C.good, sub: sh(f.cso, f.total) + ' · no CTSO, no work order' },
    { label: 'Escalated to CTSO', value: f.sent, color: C.blue, sub: sh(f.sent, f.total) + ' of all tickets' },
    { label: 'Work order without CTSO', value: f.direct, color: C.orange, sub: sh(f.direct, f.total) + ' · CSO raised the WO' },
  ].map(p => ({ ...p, value: p.value || 0 }));
  const ctsoParts = [
    { label: 'Closed by CTSO', value: f.ctsoClosed || 0, color: C.steel, sub: sh(f.ctsoClosed, f.sent) + ' of escalations' },
    { label: 'Work order via CTSO', value: f.viaCtso || 0, color: C.plum, sub: sh(f.viaCtso, f.sent) + ' of escalations' },
  ];
  one(titled('Ticket flow', fI(f.total) + ' tickets', stack(
    hbar(flowParts, f.total, 6), tiles(flowParts.map(p => ({ ...p, value: fI(p.value) })), 3), spacer(1),
    (x, y, w, d) => blockTitle('Inside CTSO', fI(f.sent) + ' escalations', x, y, w, d),
    hbar(ctsoParts, f.sent, 4), tiles(ctsoParts.map(p => ({ ...p, value: fI(p.value) })), 3),
    noteBlock('Tickets that became work orders: ' + fI(f.woFromTickets) + ' (' + fI(f.direct) + ' without CTSO, ' + fI(f.viaCtso) + ' via CTSO).'))));
  gap(3);
  const woC = { WCM: C.gold, WWR: C.bad, WCA: C.good };
  const woParts = (m.woTypes || []).map(w => ({ label: w.code + ' · ' + w.name, value: w.value || 0, color: woC[w.code] || C.muted, sub: sh(w.value, m.woSum) + ' of these work orders' }));
  const cmpN = m.cmpN || 0, inqN = m.inqN || 0;
  const typeParts = [{ label: 'Complaint', value: cmpN, color: C.bad, sub: sh(cmpN, cmpN + inqN) + ' of tickets' }, { label: 'Inquiry', value: inqN, color: C.blue, sub: sh(inqN, cmpN + inqN) + ' of tickets' }];
  row([
    titled('Work orders by type', fI(m.woSum) + ' work orders', stack(hbar(woParts, m.woSum, 5), tiles(woParts.map(p => ({ ...p, value: fI(p.value) })), 3), noteBlock(m.woNote))),
    titled('Inquiry vs complaint', fI(m.tickets.total) + ' tickets', stack(hbar(typeParts, cmpN + inqN, 5), tiles(typeParts.map(p => ({ ...p, value: fI(p.value) })), 2))),
  ]);
  gap(4);
  const q = m.complaints, iq = m.inquiry;
  row([titled('Top 5 complaint categories', fI(q.total) + ' complaints', rank(q.category, q.total, C.bad)), titled('Top 5 complaint types', 'problem reported', rank(q.problem, q.total, C.orange))]);
  gap(3);
  row([titled('Top 5 inquiry categories', fI(iq.total) + ' inquiries', rank(iq.category, iq.total, C.blue)), titled('Top 5 inquiry types', 'request made', rank(iq.problem, iq.total, C.violet))]);
  gap(3);
  row([titled('Entry channel', 'via origin', rank((m.tickets.channel || []).slice(0, 8), m.tickets.total, C.blue)), (x, y, w, d) => 0]);


  /* ---------- 2. Trend comparison ---------- */
  section('Week, month and year comparison', 'Each period is compared with the same number of calendar days before it. Green means the change is favourable, red unfavourable, grey neutral.');
  K.trends(m.trends, trendMetrics(['t', 'c']), { branchFiltered: m.branchFiltered });

  /* ---------- 3. Repeat work orders ---------- */
  const r30 = m.rep30;
  section('Repeat work orders · last 30 days', 'Customer IDs that needed more than one field work order (WCM, WWR, WGM) in the last 30 days of work-order data. Activations (WCA) and cancelled orders are excluded.');
  const repList = r30.list || [], repWo = repList.reduce((a, x) => a + x.n, 0);
  one(titled('CIDs with repeat work orders', r30.start ? fD(r30.start) + ' – ' + fD(r30.end) + ' ' + r30.end.getFullYear() : 'no work orders', tiles([
    { label: 'CIDs with 2+ work orders', value: fI(repList.length), sub: sh(repList.length, r30.cids) + ' of ' + fI(r30.cids) + ' CIDs with field work', color: C.orange },
    { label: 'Work orders on these CIDs', value: fI(repWo), sub: sh(repWo, r30.woInWindow) + ' of ' + fI(r30.woInWindow) + ' work orders in the window', color: C.orange },
    { label: '3 or more', value: fI(repList.filter(x => x.n >= 3).length), sub: 'CIDs visited three times or more', color: C.bad },
  ], 3)));
  if (repList.length) {
    const MAXR = 25;
    table(['CID', 'WOs', 'Mix', 'Work orders · date', 'Category · problem'],
      repList.slice(0, MAXR).map(x => [x.cid, fI(x.n), x.mix, (x.wos || []).map(w => w.wo + ' · ' + fD(w.date)).join('\n'), (x.cats || []).join('\n')]),
      { columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 12 }, 2: { cellWidth: 26, halign: 'left' }, 3: { cellWidth: 44, halign: 'left' }, 4: { halign: 'left', font: F.sans[0], fontStyle: F.sans[1], fontSize: 7.2 } } });
    note('Follows the branch filter. The window ends on the latest work-order date in the data.' + (repList.length > MAXR ? ' The ' + MAXR + ' CIDs with the most work orders are listed; the dashboard shows up to 80.' : ''));
  } else note('No CID had more than one work order in this window.');

  /* ---------- 4. Customer voice ---------- */
  const s = m.csat;
  section('Customer voice', 'Post-interaction survey for the selected period.');
  if (s.total) {
    row([
      titled('CSAT', fI(s.total) + ' responses', tiles([
        { label: 'Score', value: s.avg.toFixed(2) + ' / 5', sub: 'average rating', color: C.gold },
        { label: 'Satisfied', value: fP(s.top2Share), sub: 'rated 4 or 5', color: C.good },
        { label: 'Dissatisfied', value: fP(s.bottom2Share), sub: 'rated 1 or 2', color: C.bad },
      ], 3)),
      titled('Rating distribution', 'share of responses', rank((s.ratings || []).map(x => ({ key: x.rating + ' · ' + x.label, value: x.value })), s.total, C.good,
        { colorBy: (x, i) => [C.good, '#5F7F2E', C.gold, C.orange, C.bad][i] || C.muted })),
    ]);
    const fb = (list, color) => list.map(c => [{ content: c.rating + '/5', color }, c.text, c.date ? fD(c.date) + ' ' + c.date.getFullYear() : '']);
    const fbOpt = { numeric: false, columnStyles: { 0: { cellWidth: 12, font: F.mono[0], fontStyle: F.mono[1] }, 2: { cellWidth: 22, font: F.mono[0], fontStyle: F.mono[1], textColor: C.muted, fontSize: 6.8 } } };
    gap(3);
    ensure(30); one((x, y, w, d) => blockTitle('Positive feedback', (m.pos || []).length + ' most positive · rated 4–5', x, y, w, d));
    if ((m.pos || []).length) table(['Rating', 'Feedback', 'Date'], fb(m.pos, C.good), fbOpt); else note('No written feedback in this period.');
    gap(3);
    ensure(30); one((x, y, w, d) => blockTitle('Complaint feedback', (m.neg || []).length + ' lowest rated · rated 1–3', x, y, w, d));
    if ((m.neg || []).length) table(['Rating', 'Feedback', 'Date'], fb(m.neg, C.bad), fbOpt); else note('No written feedback in this period.');
    note('Verbatim customer comments, unedited. Characters the report font cannot print, such as emoji, are left out.');
  } else note('No CSAT responses in this period.');

  /* ---------- 5. Retail growth and churn ---------- */
  const g = m.growth, ct = m.cohort, bl = m.blocked, life = m.lifetime;
  section('Retail growth and churn', 'Retail customers only; Intracity plans excluded. Not affected by the period and branch filters.');
  const pend = txt => m.retailError ? 'not available' : txt;
  one(titled('All areas', m.cohortWindow || 'trailing 12 months', tiles([
    { label: 'Active customers', value: g ? fI(g.active) : '—', sub: g ? fI(g.added12) + ' new accounts in 12 months' : pend('loading'), color: C.blue },
    { label: 'Net growth rate', value: ct && ct.opening ? fP((ct.added - ct.terminated) / ct.opening) : '—', sub: ct ? 'acquisition rate ' + sh(ct.added, ct.opening) : pend('scanning records'), color: C.good },
    { label: 'True churn rate', value: ct && ct.opening ? fP(ct.churn / ct.opening) : '—', sub: ct ? fI(ct.churn) + ' customers lost' : pend('scanning records'), color: C.bad, valueColor: C.bad },
    { label: 'True churn per 100 new', value: ct && ct.added ? (ct.churn / ct.added * 100).toFixed(0) : '—', sub: ct ? fI(ct.churn) + ' lost for ' + fI(ct.added) + ' acquired' : pend('scanning records'), color: C.bad },
    { label: 'Blocked accounts', value: bl ? fI(bl.total) : '—', sub: bl ? fI(bl.over3) + ' blocked more than 3 months' : pend('loading'), color: C.orange },
    { label: 'MRC on hold', value: bl ? fRp(bl.mrcTotal) : '—', sub: 'monthly fee on blocked accounts', color: C.orange },
    { label: 'Customer lifetime', value: life && life.lifetime != null ? life.lifetime.toFixed(1) + ' mo' : '—', sub: life ? 'terminated in 12 months · active base ' + (life.tenure != null ? life.tenure.toFixed(1) + ' mo' : '—') : pend('loading'), color: C.ink },
  ], 4)));
  note('True churn excludes account swaps, relocations and accounts already blocked before the window. Customer lifetime is the average time from start to termination for accounts terminated in the last 12 months.');
  if (m.churnRisk) { gap(1); one((x, y, w, d) => {
    const t = 'Churn risk (XGBoost): ' + fI(m.churnRisk.high_tier) + ' high-risk accounts · expected ' + fI(m.churnRisk.expected_true_churn) + ' true churn in the next 60 days.';
    const hh = para(t, 0, 0, w - 6, 'bold', 7.8, null, false) + 4;
    if (d) { doc.setFillColor(C.bg); doc.rect(x, y, w, hh, 'F'); doc.setFillColor(C.accent); doc.rect(x, y, 0.8, hh, 'F'); para(t, x + 3.5, y + 2, w - 6, 'bold', 7.8, C.ink); }
    return hh + 2;
  }); }

  K.mom(g, m.swap, bl, m.now);
  gap(2);
  ensure(40);
  one((x, y, w, d) => blockTitle('By area', (m.areaRows || []).length + ' areas', x, y, w, d));
  if ((m.areaRows || []).length) table(['Area', 'Active', 'Net growth', 'True churn', 'Churn / 100 new', 'Blocked', 'MRC on hold', 'Lifetime'], m.areaRows, { columnStyles: { 0: { cellWidth: 34 } } });
  else note(m.retailError ? 'Customer records could not be read: ' + m.retailError : 'Customer records were still being scanned.');

  /* ---------- 6. Retail products and revenue ---------- */
  const bk = m.book;
  section('Retail products and revenue', 'Active retail accounts by package, billing term and priority, with ARPU and payment collection.');
  if (!bk) note(m.retailError ? 'The customer book could not be loaded: ' + m.retailError : 'The customer book was still loading when this report was generated.');
  else {
    const pkgC = { Lite: '#2F5D8A', Signature: C.orange, Dedicated: C.ink, Other: C.faint };
    const pkgs = m.packages || [];
    one(titled('Product distribution', fI(bk.activeN) + ' active accounts', stack(hbar(pkgs.map(p => ({ value: p.n, color: pkgC[p.key] || C.faint })), bk.activeN, 4),
      legend(pkgs.map(p => ({ label: p.key, color: pkgC[p.key] || C.faint }))))));
    table(['Package', 'Customers', 'Share', 'Avg MRC', 'Median MRC', 'Top bandwidth'],
      pkgs.map(p => [p.key, fI(p.n), fP(p.share), fRp(p.avg), fRp(p.median || 0), (p.speeds || []).map(x => x.label + ' · ' + fP(x.share, 0)).join('\n')]),
      { columnStyles: { 0: { cellWidth: 34, cellPadding: { top: 1.5, bottom: 1.5, left: 6, right: 1.8 } } }, didDrawCell: d => { if (d.section === 'body' && d.column.index === 0) { const p = pkgs[d.row.index]; doc.setFillColor(pkgC[p.key] || C.faint); doc.rect(d.cell.x + 1.8, d.cell.y + 2.1, 2.2, 2.2, 'F'); } } });
    note('MRC is monthly fee minus discount, before tax. Bandwidth is read from the price plan name.');

    gap(2);
    const bC = { Monthly: C.blue, Quarterly: C.gold, Semester: C.good, Annual: C.plum }, terms = Object.keys(bC);
    ensure(40);
    one(titled('Billing pattern', 'by payment term', legend(terms.map(k => ({ label: k, color: bC[k] })))));
    table(['Package', 'Accounts', ...terms, 'Mix'],
      pkgs.map(p => { const by = Object.fromEntries((p.billing || []).map(b => [b.key, b])); return [p.key, fI(p.n), ...terms.map(t => by[t] ? fP(by[t].share, 0) : '—'), '']; }),
      { columnStyles: { 0: { cellWidth: 30 }, 6: { cellWidth: 48 } }, didDrawCell: d => {
        if (d.section !== 'body' || d.column.index !== 6) return;
        const p = pkgs[d.row.index]; let cx = d.cell.x + 1.8; const w = d.cell.width - 3.6;
        (p.billing || []).filter(b => b.value > 0).forEach(b => { const bw = w * b.value / (p.n || 1); doc.setFillColor(bC[b.key] || C.faint); doc.rect(cx, d.cell.y + 1.9, bw, 2.6, 'F'); cx += bw; });
      } });
    note('Billing term is read from the price plan name; plans without a term are monthly.');

    gap(2);
    const grp = m.grpCols || ['Lite', 'Signature', 'Dedicated'];
    ensure(40);
    one((x, y, w, d) => blockTitle('Priority by package', 'active accounts', x, y, w, d));
    table(['Priority', 'Accounts', ...grp, 'Main price plans'],
      (bk.priority || []).map(p => [p.key, fI(p.n), ...grp.map(k => p.groups[k] ? fI(p.groups[k]) + ' (' + sh(p.groups[k], p.n) + ')' : '—'), (p.plans || []).map(pl => pl.key + ' · ' + fP(pl.share, 0)).join('\n')]),
      { columnStyles: { 0: { cellWidth: 22 }, [grp.length + 2]: { halign: 'left', font: F.sans[0], fontStyle: F.sans[1], fontSize: 7, cellWidth: 62 } } });

    // ARPU
    gap(2);
    const arS = m.arpuSeries || [], done = arS.filter(x => !x.partial), lastA = done[done.length - 1], prevA = done[done.length - 2];
    ensure(26 + Math.max(52, 10 + Math.min(12, arS.length) * 5.9));
    one(titled('ARPU by month', 'Dedicated, DIA and Intracity excluded', tiles([
      { label: 'ARPU · ' + (lastA ? lastA.label : ''), value: lastA ? fRp(lastA.arpu) : '—', sub: lastA ? fI(lastA.accounts) + ' accounts in the base' : '', color: C.blue },
      { label: 'Month on month', value: lastA && prevA && prevA.arpu ? (lastA.arpu >= prevA.arpu ? '+' : '') + fP(lastA.arpu / prevA.arpu - 1) : '—', sub: prevA ? 'vs ' + prevA.label + ' · ' + fRp(prevA.arpu) : '', color: lastA && prevA && lastA.arpu < prevA.arpu ? C.bad : C.good, valueColor: lastA && prevA && lastA.arpu < prevA.arpu ? C.bad : C.good },
      { label: 'Active accounts today', value: fRp(bk.arpuNow), sub: fI(bk.arpuNowN) + ' Active-status accounts', color: C.ink },
    ], 3)));
    const arpuRows = arS.slice().reverse().map((x, i, arr) => {
      const pv = arr[i + 1], chv = pv && pv.arpu ? x.arpu / pv.arpu - 1 : null;
      return [x.label + (x.partial ? ' (MTD)' : ''), fI(x.accounts), fRp(x.arpu), chv == null ? '—' : { content: (chv > 0 ? '+' : '') + fP(chv), color: chv < 0 ? C.bad : C.good }];
    }).slice(0, 12);
    const chartW = 108, chartH = Math.max(52, 10 + arpuRows.length * 5.9);
    ensure(chartH + 4);
    const y0 = R.y + 2;
    if (arS.length) {
      const maxV = Math.max(...arS.map(x => x.arpu)) || 1, n = arS.length, slot = chartW / n, bw = slot * 0.62, base = y0 + chartH - 7;
      caps('ARPU · Rp thousand', M, y0, 5.8, C.muted);
      doc.setDrawColor(C.line); doc.setLineWidth(0.2); doc.line(M, base, M + chartW, base);
      arS.forEach((x, i) => {
        const bh = (chartH - 15) * x.arpu / maxV, bx = M + i * slot + (slot - bw) / 2;
        doc.setFillColor(x.partial ? C.steel : C.blue); doc.rect(bx, base - bh, bw, bh, 'F');
        font('mono', 5.4, C.ink2); doc.text(fI(x.arpu / 1000), bx + bw / 2, base - bh - 0.8, { align: 'center' });
        font('mono', 5.2, C.muted); doc.text(S(x.label.replace(/\s*20(\d\d)$/, " '$1")), bx + bw / 2, base + 1.2, { baseline: 'top', align: 'center' });
      });
    }
    const yBefore = R.y;
    R.y = y0;
    table(['Month', 'Accounts', 'ARPU', 'MoM'], arpuRows, { left: M + chartW + 6, width: CW - chartW - 6, minSpace: 0 });
    R.y = Math.max(R.y, y0 + chartH, yBefore);
    note('ARPU = total MRC ÷ accounts live at month end (started, not yet terminated). Each account uses its current fee, so mid-year plan changes are not reflected. The current month is month-to-date (lighter bar).');

    // Blocked vs collected
    gap(2);
    const col = m.collected || { total: 0, accounts: 0, byProblem: [] };
    const blk = [
      { label: 'Blocked (unpaid) now', value: bl ? bl.total : 0, text: bl ? fI(bl.total) : '—', color: C.bad, sub: bl ? fRp(bl.mrcTotal) + ' MRC on hold · ' + fI(bl.over3) + ' over 3 months' : pend('loading') },
      { label: 'Collected by CS', value: col.total || 0, text: fI(col.total), color: C.good, sub: fI(col.accounts) + ' accounts · reactivation or payment-confirmation tickets in period' },
    ];
    one(titled('Blocked vs collected by CS', 'collection follows the period and branch filters', stack(hbar(blk, blk.reduce((a, p) => a + p.value, 0), 5),
      tiles(blk.map(p => ({ ...p, value: p.text })), 2), (col.byProblem || []).length ? rank(col.byProblem, col.total, C.good) : null)));
    note('Blocked is the current count of retail accounts past grace without payment. Collected counts reactivation and payment-confirmation tickets, as a stand-in until payment dates are available in the data.');
  }

  K.aiNotes(m.ai);

  return K.finish('Executive overview · ' + m.period + ' · ' + m.branch, { title: 'Executive overview · ' + S(m.period) + ' · ' + S(m.branch), subject: 'CX Intelligence executive overview', author: S(m.by || 'CX Intelligence'), creator: 'CX Intelligence · GlobalXtreme' });
}

/* ---------- dashboard pages (Trouble tickets, Chat omnichannel, CSAT, Growth & churn) ----------
   The page passes its cards already turned into plain blocks (see pdfCard() in index.html):
   m = { label, footer, kicker, title, sub, period, branch, synced, now, by, kpis, first, cards: [{ title, meta, sub, note, span, section, blocks }], ai }
   Block types: kpis, rank, donut, line, multi, bars, scatter, sla, table, text, list, people, feedback, trends, mom. */

const fN = v => v == null || isNaN(v) ? '—' : Math.abs(v) >= 100 ? fI(v) : (Math.round(v * 10) / 10).toLocaleString('en-US');
const niceAxis = (max, d = 4) => {
  const rough = Math.max(max, 1e-9) / d, mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= rough) || mag * 10;
  return { step, max: step * d };
};
const SERIES = ['#2B2B29', '#3E5C76', '#2E6B34', '#8A3B6E', '#C4561B', '#8C8C88', '#5B4E8C', '#B08A1E'];
const FLOW = { sla: 1, table: 1, feedback: 1, trends: 1, mom: 1 };

export function buildPagePdf(m, libs) {
  const K = kit(libs);
  const { doc, F, S, M, CW, R, font, lh, lines, para, caps, ensure, gap, row, one, section, blockTitle, note, noteBlock, stack, tiles, rank, table } = K;
  K.header({ label: m.label, kicker: m.kicker, title: m.title, period: m.period, branch: m.branch, synced: m.synced, now: m.now, by: m.by, sub: m.sub, kpis: m.kpis, kc: (m.kpis || []).length > 6 ? 4 : 3 });

  const empty = (t, x, y, w, d) => para(t || 'No data in this period.', x, y, w, 'sans', 7.5, C.muted, d) + 2;
  const poly = (pts, color) => {
    doc.setFillColor(color);
    doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true);
  };
  const path = (pts, color, width, dash) => {
    if (pts.length < 2) return;
    doc.setDrawColor(color); doc.setLineWidth(width || 0.35);
    if (dash) doc.setLineDashPattern(dash, 0);
    doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], 'S', false);
    if (dash) doc.setLineDashPattern([], 0);
  };
  // y axis with gridlines; returns { x0, y0, pw, ph, Y(v) }
  const axes = (x, y, w, hgt, max, fmt, draw) => {
    const ax = niceAxis(max), lab = [0, 1, 2, 3, 4].map(i => (fmt || fN)(ax.step * i));
    font('mono', 5.4); const lw = Math.max(...lab.map(t => doc.getTextWidth(S(t)))) + 1.6;
    const x0 = x + lw, pw = w - lw, y0 = y + 2, ph = hgt - 8;
    const Y = v => y0 + ph - ph * Math.max(0, v) / ax.max;
    if (draw) lab.forEach((t, i) => {
      const yy = Y(ax.step * i);
      doc.setDrawColor(i ? C.line2 : C.line); doc.setLineWidth(i ? 0.15 : 0.25); doc.line(x0, yy, x0 + pw, yy);
      font('mono', 5.4, C.faint); doc.text(S(t), x0 - 1.2, yy, { baseline: 'middle', align: 'right' });
    });
    return { x0, y0, pw, ph, Y, base: y0 + ph };
  };
  const xLabels = (labels, X, base, pw, draw) => {
    if (!draw || !labels.length) return;
    font('mono', 5.2); const mw = Math.max(...labels.map(t => doc.getTextWidth(S(t)))) + 2.5;
    const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(pw / mw))));
    labels.forEach((t, i) => { if (i % every === 0) { font('mono', 5.2, C.muted); doc.text(S(t), X(i), base + 1.4, { baseline: 'top', align: 'center' }); } });
  };
  const legendRow = items => K.legend(items);

  const box = {
    kpis: b => tiles((b.items || []).map(k => ({ label: k.label, value: k.value, sub: k.sub, color: k.color || C.ink, valueColor: k.color })), Math.min(4, (b.items || []).length || 1)),
    text: b => (x, y, w, d) => para(b.text, x, y, w, 'sans', 7.8, C.ink2, d) + 2.5,
    rank: b => rank((b.data || []).map(r => ({ key: r.key, value: r.value, color: r.color, text: r.text })), b.total, b.color || C.ink,
      { fmt: b.fmt, colorBy: b.data && b.data.some(r => r.color) ? r => r.color || b.color || C.ink : null }),
    people: b => (x, y, w, d) => {
      if (!(b.items || []).length) return empty(b.empty, x, y, w, d);
      let h = 0;
      b.items.forEach(it => {
        font('mono', 6.8); const vw = doc.getTextWidth(S(it.value)); let nm = S(it.name);
        font('sans', 7.4); while (nm.length > 3 && doc.getTextWidth(nm) > w - vw - 2) nm = nm.slice(0, -2).trimEnd() + '…';
        if (d) { font('sans', 7.4, C.ink); doc.text(nm, x, y + h, { baseline: 'top' }); font('mono', 6.8, C.muted); doc.text(S(it.value), x + w, y + h + 0.2, { baseline: 'top', align: 'right' });
          doc.setDrawColor(C.line2); doc.setLineWidth(0.15); doc.line(x, y + h + 4, x + w, y + h + 4); }
        h += 5;
      });
      return h + 2;
    },
    list: b => (x, y, w, d) => {
      let h = 0;
      (b.items || []).forEach((it, i) => {
        if (d) { font('mono', 6.8, b.color || C.gold); doc.text(String(i + 1).padStart(2, '0'), x, y + h + 0.3, { baseline: 'top' }); }
        if (it.title) h += para(it.title, x + 6, y + h, w - 6, 'bold', 7.8, C.ink, d) + 0.4;
        h += para(it.text, x + 6, y + h, w - 6, 'sans', 7.8, C.ink2, d) + 2.4;
      });
      return h + 1;
    },
    donut: b => (x, y, w, d) => {
      const data = (b.data || []).filter(r => r.value > 0), tot = data.reduce((a, r) => a + r.value, 0);
      if (!tot) return empty(null, x, y, w, d);
      const col = i => (b.colors || SERIES)[i % (b.colors || SERIES).length];
      const dia = Math.min(34, w * 0.36), rO = dia / 2, rI = rO * 0.66, cx = x + rO, cy = y + 1 + rO;
      const lx = x + dia + 6, lw = Math.min(w - dia - 6, 100);
      let lh2 = 0;
      data.forEach((r, i) => {
        const val = fI(r.value) + '  ·  ' + fP(r.value / tot);
        font('mono', 6.8); const vw = doc.getTextWidth(S(val));
        const ls = lines(r.key, lw - vw - 6, 'sans', 7.4);
        if (d) {
          doc.setFillColor(col(i)); doc.rect(lx, y + 1 + lh2 + 0.5, 2.2, 2.2, 'F');
          font('sans', 7.4, C.ink); doc.text(ls, lx + 3.6, y + 1 + lh2, { baseline: 'top', lineHeightFactor: 1.32 });
          font('mono', 6.8, C.muted); doc.text(S(val), lx + lw, y + 1 + lh2 + 0.2, { baseline: 'top', align: 'right' });
        }
        lh2 += Math.max(1, ls.length) * lh(7.4) + 1.8;
      });
      if (d) {
        let a = -Math.PI / 2;
        data.forEach((r, i) => {
          const a1 = a + 2 * Math.PI * r.value / tot, n = Math.max(2, Math.ceil((a1 - a) / 0.06)), pts = [];
          for (let k = 0; k <= n; k++) { const t = a + (a1 - a) * k / n; pts.push([cx + rO * Math.cos(t), cy + rO * Math.sin(t)]); }
          for (let k = n; k >= 0; k--) { const t = a + (a1 - a) * k / n; pts.push([cx + rI * Math.cos(t), cy + rI * Math.sin(t)]); }
          poly(pts, col(i));
          if (data.length > 1) { doc.setDrawColor('#FFFFFF'); doc.setLineWidth(0.35); doc.line(cx + rI * Math.cos(a), cy + rI * Math.sin(a), cx + rO * Math.cos(a), cy + rO * Math.sin(a)); }
          a = a1;
        });
        if (b.center) {
          font('mono', 10, C.ink); doc.text(S(b.center.value), cx, cy - 0.6, { align: 'center', baseline: 'bottom' });
          font('mono', 5.4, C.muted); doc.text(S(b.center.label || '').toUpperCase(), cx, cy + 0.8, { align: 'center', baseline: 'top' });
        }
      }
      return Math.max(dia + 2, lh2) + 3;
    },
    line: b => (x, y, w, d) => {
      const pts = b.pts || [], H0 = 52;
      if (!pts.length) return empty(null, x, y, w, d);
      const leg = [{ label: b.label || 'Value', color: b.color || C.ink }].concat(pts.some(p => p.o) ? [{ label: b.overlayLabel || 'Overlay', color: b.overlayColor || C.orange }] : []);
      const lgH = legendRow(leg)(x, y, w, false);
      if (d) legendRow(leg)(x, y, w, true);
      const max = Math.max(1, ...pts.map(p => Math.max(p.v || 0, p.o || 0)));
      const A2 = axes(x, y + lgH, w, H0, max, null, d);
      const step = pts.length > 1 ? A2.pw / (pts.length - 1) : 0, X = i => pts.length > 1 ? A2.x0 + i * step : A2.x0 + A2.pw / 2;
      if (d) {
        const bw = Math.max(0.4, Math.min(2.2, (A2.pw / pts.length) * 0.6));
        pts.forEach((p, i) => { if (p.o) { const hh = A2.base - A2.Y(p.o); doc.setFillColor(b.overlayColor || C.orange); doc.rect(X(i) - bw / 2, A2.base - hh, bw, hh, 'F'); } });
        path(pts.map((p, i) => [X(i), A2.Y(p.v || 0)]), b.color || C.ink, 0.4);
        if (pts.length <= 40) pts.forEach((p, i) => { doc.setFillColor(b.color || C.ink); doc.circle(X(i), A2.Y(p.v || 0), 0.45, 'F'); });
      }
      xLabels(pts.map(p => p.label), X, A2.base, A2.pw, d);
      return lgH + H0 + 2;
    },
    multi: b => (x, y, w, d) => {
      const data = b.data || [], ls = (b.lines || []).filter(l => data.some(r => r[l.key] != null)), H0 = 56;
      if (!data.length || !ls.length) return empty(null, x, y, w, d);
      const leg = ls.map(l => ({ label: l.label, color: l.color }));
      const lgH = legendRow(leg)(x, y, w, false);
      if (d) legendRow(leg)(x, y, w, true);
      const max = Math.max(1, ...data.flatMap(r => ls.map(l => r[l.key] || 0)));
      const A2 = axes(x, y + lgH, w, H0, max, null, d);
      const step = data.length > 1 ? A2.pw / (data.length - 1) : 0, X = i => A2.x0 + i * step;
      if (d) ls.forEach(l => {
        const p = data.map((r, i) => r[l.key] == null ? null : [X(i), A2.Y(r[l.key])]).filter(Boolean);
        path(p, l.color, 0.45, l.dash ? [1.4, 1] : null);
        p.forEach(q => { doc.setFillColor(l.color); doc.circle(q[0], q[1], 0.5, 'F'); });
      });
      xLabels(data.map(r => r.label), X, A2.base, A2.pw, d);
      return lgH + H0 + 2;
    },
    bars: b => (x, y, w, d) => {
      const data = b.data || [], keys = b.keys || [{ key: 'value', label: 'Value', color: C.ink }], H0 = 50;
      if (!data.length) return empty(null, x, y, w, d);
      const lgH = keys.length > 1 ? legendRow(keys.map(k => ({ label: k.label, color: k.color })))(x, y, w, false) : 0;
      if (d && keys.length > 1) legendRow(keys.map(k => ({ label: k.label, color: k.color })))(x, y, w, true);
      const max = Math.max(1e-9, ...data.flatMap(r => keys.map(k => r[k.key] || 0)));
      const A2 = axes(x, y + lgH, w, H0, max, null, d);
      const slot = A2.pw / data.length, gw = slot * 0.66, bw = gw / keys.length, X = i => A2.x0 + slot * i + slot / 2;
      if (d) data.forEach((r, i) => keys.forEach((k, j) => {
        const v = r[k.key] || 0, top = A2.Y(v), bx = X(i) - gw / 2 + j * bw;
        doc.setFillColor(k.color || C.ink); doc.rect(bx, top, bw, A2.base - top, 'F');
        if (data.length * keys.length <= 16) { font('mono', 5, C.ink2); doc.text(S(fN(v)), bx + bw / 2, top - 0.8, { align: 'center' }); }
      }));
      xLabels(data.map(r => r.label), X, A2.base, A2.pw, d);
      return lgH + H0 + 2;
    },
    scatter: b => (x, y, w, d) => {
      const pts = b.points || [], H0 = 86;
      if (!pts.length) return empty(null, x, y, w, d);
      const yMax = Math.max(1, ...pts.map(p => p.y)), xMax = Math.max(1, ...pts.map(p => p.x));
      if (d) { font('mono', 5.6, C.muted); doc.text(S(b.yLabel || '').toUpperCase(), x, y, { baseline: 'top' }); }
      const A2 = axes(x, y + 4, w, H0 - 10, yMax * 1.05, b.yFmt, d);
      const ax = niceAxis(xMax * 1.05), X = v => A2.x0 + A2.pw * v / ax.max;
      if (d) {
        [0, 1, 2, 3, 4].forEach(i => { font('mono', 5.4, C.faint); doc.text(S((b.xFmt || fI)(ax.step * i)), X(ax.step * i), A2.base + 1.4, { baseline: 'top', align: 'center' }); });
        font('mono', 5.6, C.muted); doc.text(S(b.xLabel || '').toUpperCase(), A2.x0 + A2.pw, A2.base + 5, { baseline: 'top', align: 'right' });
        doc.setDrawColor(C.faint); doc.setLineWidth(0.2); doc.setLineDashPattern([1, 1], 0);
        if (b.medX != null) doc.line(X(b.medX), A2.y0, X(b.medX), A2.base);
        if (b.medY != null) doc.line(A2.x0, A2.Y(b.medY), A2.x0 + A2.pw, A2.Y(b.medY));
        doc.setLineDashPattern([], 0);
        const q = b.quadrantLabels || {};
        font('mono', 5, C.faint);
        if (q.tr) doc.text(S(q.tr), A2.x0 + A2.pw - 1, A2.y0 + 1, { baseline: 'top', align: 'right' });
        if (q.tl) doc.text(S(q.tl), A2.x0 + 1, A2.y0 + 1, { baseline: 'top' });
        if (q.br) doc.text(S(q.br), A2.x0 + A2.pw - 1, A2.base - 1.5, { align: 'right' });
        if (q.bl) doc.text(S(q.bl), A2.x0 + 1, A2.base - 1.5);
        pts.forEach(p => { doc.setFillColor(p.color || C.blue); doc.circle(X(p.x), A2.Y(p.y), 0.95, 'F'); });
        pts.filter(p => b.medX != null && b.medY != null && p.x >= b.medX && p.y >= b.medY).forEach(p => {
          font('sans', 5.2, C.ink2); doc.text(S(p.name), X(p.x) + 1.4, A2.Y(p.y), { baseline: 'middle' });
        });
      }
      return H0 + 4;
    },
  };
  const cap = (rows, n) => rows.length > n ? rows.slice(0, n) : rows;
  const flow = {
    table: b => {
      const MAX = b.max || 80, rows = cap(b.rows || [], MAX);
      if (!rows.length) { note('No rows in this period.'); return; }
      table(b.head, rows, { numeric: b.numeric !== false, columnStyles: b.columnStyles });
      if ((b.rows || []).length > MAX) note('The first ' + MAX + ' of ' + fI(b.rows.length) + ' rows are listed; the dashboard shows all of them.');
    },
    sla: b => {
      const data = b.data || [];
      if (!data.length) { note('No measured agents in this period.'); return; }
      const max = Math.max((b.threshold || 0) * 1.4, ...data.map(r => r.value)) || 1;
      table(['Agent', 'Time', 'Against threshold · ' + (b.thText || '')], data.map(r => [r.label, { content: r.text, color: b.threshold && r.value > b.threshold ? C.bad : C.ink }, '']), {
        columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 24 } },
        didDrawCell: dd => {
          if (dd.section !== 'body' || dd.column.index !== 2) return;
          const r = data[dd.row.index], bx = dd.cell.x + 1.8, bw = dd.cell.width - 3.6, by = dd.cell.y + dd.cell.height / 2 - 0.9;
          doc.setFillColor(C.track); doc.rect(bx, by, bw, 1.8, 'F');
          doc.setFillColor(b.threshold && r.value > b.threshold ? C.bad : C.good); doc.rect(bx, by, Math.max(bw * 0.01, bw * r.value / max), 1.8, 'F');
          if (b.threshold) { const tx = bx + bw * b.threshold / max; doc.setDrawColor(C.ink); doc.setLineWidth(0.3); doc.line(tx, by - 0.9, tx, by + 2.7); }
        } });
      note('Red: above the ' + (b.thText || 'threshold') + ' threshold (black tick).');
    },
    feedback: b => {
      const items = b.items || [];
      if (!items.length) { note('No written feedback in this period.'); return; }
      table(['Rating', 'Feedback', 'Date'], items.map(c => [{ content: c.rating + '/5', color: c.rating >= 4 ? C.good : C.bad }, c.text + (c.who ? '\n' + c.who : ''), c.date ? fD(c.date) + ' ' + c.date.getFullYear() : '']),
        { numeric: false, columnStyles: { 0: { cellWidth: 12, font: F.mono[0], fontStyle: F.mono[1] }, 2: { cellWidth: 22, font: F.mono[0], fontStyle: F.mono[1], textColor: C.muted, fontSize: 6.8 } } });
      note('Verbatim customer comments, unedited' + (b.total > items.length ? '; ' + items.length + ' of ' + fI(b.total) + ' comments listed, as on the dashboard' : '') + '. Characters the report font cannot print, such as emoji, are left out.');
    },
    trends: b => {
      if (!b.T) { note('The comparison was still loading when this report was generated.'); return; }
      K.trends(b.T, trendMetrics(b.ids || ['t', 'c'], b.score), { branchFiltered: b.branchFiltered, noNote: true });
    },
    mom: b => { if (b.g && b.g.monthlySeries) K.mom(b.g, b.sw, b.bl, m.now, { note: b.note }); else note('The monthly series was still loading when this report was generated.'); },
  };

  const ctitle = (title, meta) => (x, y, w, d) => {
    const tw = K.capsW(title, 6.8, 'bold');
    font('mono', 6.8); const mw = meta ? doc.getTextWidth(S(meta)) : 0;
    if (!meta || tw + mw + 4 <= w) return blockTitle(title, meta, x, y, w, d);
    if (d) {
      caps(title, x, y, 6.8, C.ink, 'bold');
      font('mono', 6.4, C.muted); doc.text(lines(meta, w, 'mono', 6.4)[0], x, y + 3.6, { baseline: 'top' });
      doc.setDrawColor(C.line2); doc.setLineWidth(0.2); doc.line(x, y + 7.4, x + w, y + 7.4);
    }
    return 9.2;
  };
  const isBox = c => (c.blocks || []).every(b => box[b.t]);
  const boxCard = c => stack(
    ctitle(c.title, c.meta),
    c.sub ? (x, y, w, d) => para(c.sub, x, y, w, 'sans', 7, C.muted, d) + 2 : null,
    ...(c.blocks || []).length ? c.blocks.map(b => box[b.t](b)) : [(x, y, w, d) => empty(/^loading/i.test(c.meta || '') ? 'Still loading when this report was generated.' : 'No data in this period.', x, y, w, d)],
    noteBlock(c.note));
  // Keep a card title with the start of its table: room for the title plus up to ~8 rows.
  const need = b => b.t === 'table' ? 16 + Math.min(8, (b.rows || []).length) * 6.4 : b.t === 'sla' || b.t === 'feedback' ? 16 + Math.min(6, (b.data || b.items || []).length) * 6.4
    : b.t === 'trends' ? 16 + (trendMetrics(b.ids || ['t', 'c'], b.score).length) * 6.4 : b.t === 'mom' ? 52 : 30;
  const flowCard = c => {
    const b0 = c.blocks[0];
    if (b0 && b0.t === 'mom') { ensure(need(b0) + 4); flow.mom(b0); return; }   // the table draws its own title and note
    ensure(10 + (c.sub ? 8 : 0) + need(b0 || {}));
    one(ctitle(c.title, c.meta));
    if (c.sub) one((x, y, w, d) => para(c.sub, x, y, w, 'sans', 7, C.muted, d) + 2);
    c.blocks.forEach((b, i) => { if (i) ensure(need(b)); if (flow[b.t]) flow[b.t](b); else one(box[b.t](b)); });
    if (c.note) note(c.note);
  };

  if (m.first) section(m.first);
  const cards = (m.cards || []).filter(c => c && !/consultant notes/i.test(c.title || ''));
  let started = false;
  for (let i = 0; i < cards.length;) {
    const c = cards[i];
    if (c.section) {
      section(c.title, c.sub);
      if ((c.blocks || []).length) one(stack(...c.blocks.filter(b => box[b.t]).map(b => box[b.t](b))));
      i++; started = false; continue;
    }
    if (started) gap(3);
    started = true;
    if (!isBox(c)) { flowCard(c); i++; continue; }
    const sp = s => s || 12;
    const grp = [c];
    if (sp(c.span) <= 7) {
      const max = sp(c.span) <= 3 ? 4 : 2;
      let sum = sp(c.span);
      while (grp.length < max && i + grp.length < cards.length) {
        const nx = cards[i + grp.length];
        if (!nx || nx.section || !isBox(nx) || sp(nx.span) > 7 || sum + sp(nx.span) > 12) break;
        grp.push(nx); sum += sp(nx.span);
      }
    }
    if (grp.length === 1) one(boxCard(c)); else row(grp.map(boxCard), grp.length > 2 ? 5 : 8);
    i += grp.length;
  }

  K.aiNotes(m.ai);
  const tag = (m.footer || m.title) + ' · ' + m.period + ' · ' + m.branch;
  return K.finish(tag, { title: S(tag), subject: 'CX Intelligence · ' + S(m.footer || m.title), author: S(m.by || 'CX Intelligence'), creator: 'CX Intelligence · GlobalXtreme' });
}
