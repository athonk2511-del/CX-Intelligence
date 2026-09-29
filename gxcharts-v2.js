// GlobalXtreme BI — SVG chart components (React function components with hover state).
export const PALETTE = ['#2B2B29', '#3E5C76', '#2E6B34', '#8A3B6E', '#C4561B', '#8C8C88', '#5B4E8C', '#B08A1E'];
export const INK = '#1F1F1D';
export const MUTED = '#5F5F5B';
export const GRID = '#E6E6E2';
const FONT = "'IBM Plex Sans',system-ui,sans-serif";
const MONO = "'IBM Plex Mono',ui-monospace,monospace";

export function makeCharts(React) {
  const h = React.createElement;
  const { useState, useRef, useEffect } = React;

  function useWidth(fallback) {
    const ref = useRef(null);
    const [w, setW] = useState(0);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const read = () => setW(el.clientWidth);
      read();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    return [ref, Math.max(240, w || fallback || 820)];
  }

  const nf = n => (Math.round(n * 100) / 100).toLocaleString('en-US');

  const niceAxis = (max, divisions) => {
    const d = divisions || 4;
    const rough = Math.max(max, 1) / d;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough) || mag * 10;
    return { step, max: step * d };
  };

  function Tip({ tip }) {
    if (!tip) return null;
    return h('div', {
      style: {
        position: 'absolute', left: tip.x + '%', top: tip.y + '%', transform: 'translate(-50%,-125%)',
        pointerEvents: 'none', zIndex: 5, background: '#FFFFFF',
        border: '1px solid #CFCFCA', borderRadius: 3,
        padding: '6px 9px', font: '500 12px/1.45 ' + MONO, color: INK, whiteSpace: 'nowrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      },
    }, tip.lines.map((l, i) => h('div', {
      key: i, style: { color: i === 0 ? INK : MUTED, fontWeight: i === 0 ? 600 : 400, fontFamily: i === 0 ? FONT : MONO },
    }, l)));
  }

  const Wrap = (children, tip, height, ref) => h('div', {
    ref: ref,
    style: { position: 'relative', width: '100%', height: height ? height + 'px' : 'auto' },
  }, children, h(Tip, { tip }));

  /* ---------- line / area with optional overlay bars ---------- */
  function LineChart({ series, valueKey = 'value', overlayKey, label = 'Tickets', overlayLabel = 'Mass-problem', height = 240, color = PALETTE[0], overlayColor = '#C4561B', formatX }) {
    const [tip, setTip] = useState(null);
    const [boxRef, CW] = useWidth();
    const W = CW, H = height, PL = 46, PR = 14, PT = 16, PB = 30;
    const pts = series || [];
    if (!pts.length) return h('div', { style: { color: MUTED, font: '500 13px ' + FONT, padding: '28px 0' } }, 'No data for this period');
    const max = Math.max(1, ...pts.map(p => p[valueKey]));
    const axis = niceAxis(max, 4);
    const nice = axis.max;
    const x = i => PL + (pts.length === 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (pts.length - 1));
    const y = v => PT + (H - PT - PB) * (1 - v / nice);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[valueKey]).toFixed(1)).join(' ');
    const area = line + ` L ${x(pts.length - 1).toFixed(1)} ${H - PB} L ${x(0).toFixed(1)} ${H - PB} Z`;
    const ticks = [0, 1, 2, 3, 4].map(i => axis.step * i);
    const step = Math.ceil(pts.length / 12);
    return Wrap(h('svg', {
      viewBox: `0 0 ${W} ${H}`, style: { width: '100%', height: '100%', display: 'block', overflow: 'visible' },
      onMouseLeave: () => setTip(null),
    },
      h('defs', null, h('linearGradient', { id: 'lg' + color.slice(1), x1: '0', y1: '0', x2: '0', y2: '1' },
        h('stop', { offset: '0%', stopColor: color, stopOpacity: 0.06 }),
        h('stop', { offset: '100%', stopColor: color, stopOpacity: 0 }))),
      ticks.map((t, i) => h('g', { key: i },
        h('line', { x1: PL, x2: W - PR, y1: y(t), y2: y(t), stroke: GRID, strokeWidth: 1 }),
        h('text', { x: PL - 10, y: y(t) + 4, textAnchor: 'end', fill: MUTED, style: { font: '500 12px ' + MONO } }, nf(t)))),
      overlayKey && pts.map((p, i) => p[overlayKey] > 0 ? h('rect', {
        key: 'o' + i, x: x(i) - 3, width: 6, y: y(p[overlayKey]), height: Math.max(0, H - PB - y(p[overlayKey])),
        fill: overlayColor, opacity: 0.85, rx: 0,
      }) : null),
      h('path', { d: area, fill: `url(#lg${color.slice(1)})` }),
      h('path', { d: line, fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinejoin: 'round', strokeLinecap: 'round' }),
      pts.map((p, i) => h('rect', {
        key: 'h' + i, x: x(i) - (W - PL - PR) / pts.length / 2, y: PT, width: (W - PL - PR) / pts.length, height: H - PT - PB,
        fill: 'transparent',
        onMouseEnter: () => setTip({
          x: (x(i) / W) * 100, y: (y(p[valueKey]) / H) * 100,
          lines: [(formatX ? formatX(p) : (p.date ? p.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : p.label)),
            label + ': ' + nf(p[valueKey])].concat(overlayKey && p[overlayKey] ? [overlayLabel + ': ' + nf(p[overlayKey])] : []),
        }),
      })),
      pts.filter((_, i) => i % step === 0).map((p, i) => h('text', {
        key: 't' + i, x: x(i * step), y: H - 8, textAnchor: 'middle', fill: MUTED, style: { font: '500 12px ' + MONO },
      }, formatX ? formatX(p, true) : (p.date ? p.date.getDate() : p.label)))
    ), tip, height, boxRef);
  }

  /* ---------- several monthly series as lines ---------- */
  function MultiLine({ data, lines, height = 280 }) {
    const [tip, setTip] = useState(null);
    const [boxRef, CW] = useWidth();
    const W = CW, H = height, PL = 50, PR = 14, PT = 16, PB = 34;
    if (!data || !data.length) return h('div', { style: { color: MUTED, font: '500 13px ' + FONT, padding: '28px 0' } }, 'No data');
    const shown = lines.filter(l => data.some(d => d[l.key] != null));
    const max = Math.max(1, ...data.flatMap(d => shown.map(l => d[l.key] || 0)));
    const axis = niceAxis(max, 4);
    const x = i => PL + (data.length === 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (data.length - 1));
    const y = v => PT + (H - PT - PB) * (1 - v / axis.max);
    const bw = (W - PL - PR) / Math.max(1, data.length - 1);
    const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((W - PL - PR) / 62))));
    const legend = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginBottom: 12 } },
      lines.map(l => h('div', { key: l.key, style: { display: 'flex', alignItems: 'center', gap: 7, font: '500 12px ' + FONT, color: shown.includes(l) ? INK : MUTED } },
        h('svg', { width: 22, height: 8 }, h('line', { x1: 0, x2: 22, y1: 4, y2: 4, stroke: l.color, strokeWidth: 2.2, strokeDasharray: l.dash || null })),
        l.label + (shown.includes(l) ? '' : (l.pending ? ' · ' + l.pending : '')))));
    const svg = h('div', { ref: boxRef, style: { position: 'relative', width: '100%', height: H + 'px' } },
      h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%', height: '100%', display: 'block', overflow: 'visible' }, onMouseLeave: () => setTip(null) },
        [0, 1, 2, 3, 4].map(t => h('g', { key: 'g' + t },
          h('line', { x1: PL, x2: W - PR, y1: y(axis.step * t), y2: y(axis.step * t), stroke: GRID }),
          h('text', { x: PL - 10, y: y(axis.step * t) + 4, textAnchor: 'end', fill: MUTED, style: { font: '500 12px ' + MONO } }, nf(axis.step * t)))),
        tip && h('line', { x1: x(tip.i), x2: x(tip.i), y1: PT, y2: H - PB, stroke: '#CFCFCA' }),
        shown.map(l => h('path', {
          key: l.key, fill: 'none', stroke: l.color, strokeWidth: 2, strokeDasharray: l.dash || null, strokeLinejoin: 'round', strokeLinecap: 'round',
          d: data.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[l.key] || 0).toFixed(1)).join(' '),
        })),
        shown.map(l => data.map((d, i) => h('circle', {
          key: l.key + i, cx: x(i), cy: y(d[l.key] || 0), r: tip && tip.i === i ? 4 : 2.4, fill: '#FFFFFF', stroke: l.color, strokeWidth: 1.6,
        }))),
        data.map((d, i) => h('rect', {
          key: 'h' + i, x: x(i) - bw / 2, y: PT, width: bw, height: H - PT - PB, fill: 'transparent',
          onMouseEnter: () => setTip({ i, x: (x(i) / W) * 100, y: 8, lines: [d.label].concat(shown.map(l => l.label + ': ' + nf(d[l.key] || 0))) }),
        })),
        data.map((d, i) => i % every === 0 ? h('text', { key: 'x' + i, x: x(i), y: H - 10, textAnchor: 'middle', fill: MUTED, style: { font: '500 12px ' + MONO } }, d.label) : null)),
      h(Tip, { tip }));
    return h('div', null, legend, svg);
  }

  /* ---------- grouped / stacked vertical bars ---------- */
  function BarChart({ data, keys = [{ key: 'value', label: 'Value', color: PALETTE[0] }], stacked = false, height = 240, showNet }) {
    const [tip, setTip] = useState(null);
    const [boxRef, CW] = useWidth();
    const W = CW, H = height, PL = 50, PR = 14, PT = 16, PB = 34;
    if (!data || !data.length) return h('div', { style: { color: MUTED, font: '500 13px ' + FONT, padding: '28px 0' } }, 'No data');
    const totals = data.map(d => stacked ? keys.reduce((s, k) => s + (d[k.key] || 0), 0) : Math.max(...keys.map(k => d[k.key] || 0)));
    const max = Math.max(1, ...totals);
    const axis = niceAxis(max, 4);
    const nice = axis.max;
    const bw = (W - PL - PR) / data.length;
    const y = v => PT + (H - PT - PB) * (1 - v / nice);
    return Wrap(h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%', height: '100%', display: 'block' }, onMouseLeave: () => setTip(null) },
      [0, 2, 4].map((t, i) => h('line', { key: i, x1: PL, x2: W - PR, y1: y(axis.step * t), y2: y(axis.step * t), stroke: GRID })),
      [0, 2, 4].map((t, i) => h('text', { key: 'l' + i, x: PL - 10, y: y(axis.step * t) + 4, textAnchor: 'end', fill: MUTED, style: { font: '500 12px ' + MONO } }, nf(axis.step * t))),
      data.map((d, i) => {
        const inner = bw * 0.62, gx = PL + i * bw + bw / 2;
        let acc = 0;
        return h('g', {
          key: i,
          onMouseEnter: () => setTip({
            x: (gx / W) * 100, y: (y(totals[i]) / H) * 100,
            lines: [d.label].concat(keys.map(k => k.label + ': ' + nf(d[k.key] || 0)), showNet ? ['Net: ' + (d.net > 0 ? '+' : '') + nf(d.net)] : []),
          }),
        },
          h('rect', { x: PL + i * bw, y: PT, width: bw, height: H - PT - PB, fill: 'transparent' }),
          keys.map((k, j) => {
            const v = d[k.key] || 0;
            if (stacked) {
              const yy = y(acc + v), hh = y(acc) - y(acc + v); acc += v;
              return h('rect', { key: j, x: gx - inner / 2, width: inner, y: yy, height: Math.max(0, hh), fill: k.color, rx: 1 });
            }
            const w2 = inner / keys.length;
            return h('rect', { key: j, x: gx - inner / 2 + j * w2, width: w2 - 2, y: y(v), height: Math.max(0, H - PB - y(v)), fill: k.color, rx: 1 });
          }));
      }),
      data.map((d, i) => i % Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((W - PL - PR) / 62)))) === 0 ? h('text', {
        key: 'x' + i, x: PL + i * bw + bw / 2, y: H - 10, textAnchor: 'middle', fill: MUTED, style: { font: '500 12px ' + MONO },
      }, d.label) : null)
    ), tip, height, boxRef);
  }

  /* ---------- ranked horizontal bars ---------- */
  function RankBars({ data, total, color = PALETTE[0], max, unit = '', colorBy, showShare = true, valueFormat }) {
    const top = Math.max(1, max || Math.max(...data.map(d => d.value)));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 11 } },
      data.map((d, i) => h('div', { key: i, style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center' } },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5 } },
            h('span', { style: { font: '400 13px ' + FONT, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.key || d.label),
            h('span', { style: { font: '500 12px ' + MONO, color: MUTED } },
              (valueFormat ? valueFormat(d.value) : nf(d.value) + unit) + (showShare && total ? '  ·  ' + ((d.value / total) * 100).toFixed(1) + '%' : ''))),
          h('div', { style: { height: 6, borderRadius: 0, background: '#EDEDEA', overflow: 'hidden' } },
            h('div', {
              style: {
                width: Math.max(1.5, (d.value / top) * 100) + '%', height: '100%', borderRadius: 0,
                background: colorBy ? colorBy(d, i) : color, opacity: colorBy ? 1 : 1 - i * 0.045,
              },
            })))))
    );
  }

  /* ---------- donut ---------- */
  function Donut({ data, size = 180, thickness = 18, centerLabel, centerValue, colors = PALETTE }) {
    const [tip, setTip] = useState(null);
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const r = size / 2 - thickness / 2, C = 2 * Math.PI * r;
    let acc = 0;
    return h('div', { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' } },
      h('div', { style: { position: 'relative', width: size, height: size, flex: '0 0 auto' } },
        h('svg', { viewBox: `0 0 ${size} ${size}`, style: { width: '100%', height: '100%', transform: 'rotate(-90deg)' } },
          h('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: '#EDEDEA', strokeWidth: thickness }),
          data.map((d, i) => {
            const len = (d.value / total) * C, off = acc; acc += len;
            return h('circle', {
              key: i, cx: size / 2, cy: size / 2, r, fill: 'none', stroke: colors[i % colors.length],
              strokeWidth: thickness, strokeDasharray: `${Math.max(0, len - 2)} ${C}`, strokeDashoffset: -off,
              strokeLinecap: 'butt', style: { cursor: 'default' },
              onMouseEnter: () => setTip({ x: 50, y: 50, lines: [d.key || d.label, nf(d.value) + ' · ' + ((d.value / total) * 100).toFixed(1) + '%'] }),
              onMouseLeave: () => setTip(null),
            });
          })),
        h('div', {
          style: {
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center',
          },
        },
          h('div', { style: { font: '500 21px ' + MONO, color: INK, letterSpacing: '-0.02em' } }, centerValue),
          h('div', { style: { font: '500 10px ' + MONO, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase' } }, centerLabel)),
        h(Tip, { tip })),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0, flex: '1 1 180px' } },
        data.map((d, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 } },
          h('span', { style: { width: 9, height: 9, borderRadius: 1, background: colors[i % colors.length], flex: '0 0 auto' } }),
          h('span', { style: { font: '400 13px ' + FONT, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 } }, d.key || d.label),
          h('span', { style: { font: '500 12px ' + MONO, color: MUTED, flex: '0 0 auto' } }, nf(d.value)),
          h('span', { style: { font: '500 12px ' + MONO, color: '#5F5F5B', flex: '0 0 auto', width: 46, textAlign: 'right' } }, ((d.value / total) * 100).toFixed(1) + '%'))))
    );
  }

  /* ---------- quadrant scatter ---------- */
  function Scatter({ points, xLabel, yLabel, medX, medY, height = 330, xFormat = nf, yFormat = nf, quadrantLabels }) {
    const [tip, setTip] = useState(null);
    const [boxRef, CW] = useWidth();
    const W = CW, H = height, PL = 74, PR = 22, PT = 30, PB = 58;
    if (!points.length) return h('div', { style: { color: MUTED, font: '500 13px ' + FONT } }, 'No data');
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xMax = Math.max(...xs) * 1.10, yMax = Math.max(...ys) * 1.12;
    const X = v => PL + (v / xMax) * (W - PL - PR);
    const Y = v => PT + (1 - v / yMax) * (H - PT - PB);
    const ql = quadrantLabels || {};
    const corner = (text, x, y, anchor, color) => text ? h('text', {
      x, y, textAnchor: anchor, fill: color, style: { font: '700 10.5px ' + FONT, letterSpacing: '0.04em' },
    }, text) : null;
    return Wrap(h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%', height: '100%', display: 'block' }, onMouseLeave: () => setTip(null) },
      h('rect', { x: X(medX), y: PT, width: W - PR - X(medX), height: Y(medY) - PT, fill: 'rgba(155,44,31,0.05)' }),
      h('rect', { x: X(medX), y: Y(medY), width: W - PR - X(medX), height: H - PB - Y(medY), fill: 'rgba(46,107,52,0.06)' }),
      [0.25, 0.5, 0.75, 1].map((t, i) => h('line', { key: i, x1: PL, x2: W - PR, y1: Y(yMax * t), y2: Y(yMax * t), stroke: GRID })),
      [0.25, 0.5, 0.75, 1].map((t, i) => h('text', { key: 'y' + i, x: PL - 10, y: Y(yMax * t) + 4, textAnchor: 'end', fill: MUTED, style: { font: '500 11.5px ' + MONO } }, yFormat(yMax * t))),
      [0.25, 0.5, 0.75, 1].map((t, i) => h('text', { key: 'x' + i, x: X(xMax * t), y: H - PB + 20, textAnchor: 'middle', fill: MUTED, style: { font: '500 11.5px ' + MONO } }, xFormat(Math.round(xMax * t)))),
      h('line', { x1: PL, x2: W - PR, y1: H - PB, y2: H - PB, stroke: '#BDBDB8' }),
      h('line', { x1: PL, x2: PL, y1: PT, y2: H - PB, stroke: '#BDBDB8' }),
      h('line', { x1: X(medX), x2: X(medX), y1: PT, y2: H - PB, stroke: '#5F5F5B', strokeDasharray: '5 5' }),
      h('line', { x1: PL, x2: W - PR, y1: Y(medY), y2: Y(medY), stroke: '#5F5F5B', strokeDasharray: '5 5' }),
      h('text', { x: X(medX) + 6, y: PT - 10, textAnchor: 'start', fill: MUTED, style: { font: '500 10.5px ' + MONO } }, 'median ' + xFormat(Math.round(medX))),
      h('text', { x: PL + 6, y: Y(medY) - 7, textAnchor: 'start', fill: MUTED, style: { font: '500 10.5px ' + MONO } }, 'median ' + yFormat(medY)),
      corner(ql.tr, W - PR - 8, PT + 14, 'end', '#9B2C1F'),
      corner(ql.tl, PL + 8, PT + 14, 'start', '#6B5A2E'),
      corner(ql.br, W - PR - 8, H - PB - 10, 'end', '#2E6B34'),
      corner(ql.bl, PL + 8, H - PB - 10, 'start', '#3F5162'),
      points.map((p, i) => h('circle', {
        key: i, cx: X(p.x), cy: Y(p.y), r: p.r || 6, fill: p.color || PALETTE[0], fillOpacity: 0.9,
        stroke: 'rgba(255,255,255,0.9)', strokeWidth: 1.4,
        onMouseEnter: () => setTip({ x: (X(p.x) / W) * 100, y: (Y(p.y) / H) * 100, lines: [p.name, xLabel + ': ' + xFormat(p.x), yLabel + ': ' + yFormat(p.y)] }),
      })),
      points.filter(p => p.x >= medX && p.y >= medY)
        .map(p => ({ p, score: (p.x / (medX || 1)) * (p.y / (medY || 1)) }))
        .sort((a, b) => b.score - a.score).slice(0, 5)
        .map(({ p }, i) => {
          const dy = [-14, 21, -26, 31, -38][i % 5];
          return h('text', {
            key: 'n' + i, x: X(p.x), y: Y(p.y) + dy, textAnchor: 'middle', fill: '#9B2C1F',
            style: { font: '700 10.5px ' + FONT, pointerEvents: 'none' },
          }, p.name.split(' ').slice(0, 2).join(' '));
        }),
      h('text', { x: PL + (W - PL - PR) / 2, y: H - 14, textAnchor: 'middle', fill: INK, style: { font: '500 11.5px ' + MONO, letterSpacing: '0.04em' } }, 'X axis — ' + xLabel + ' (more to the right)'),
      h('text', { x: 18, y: PT + (H - PT - PB) / 2, textAnchor: 'middle', fill: INK, transform: `rotate(-90 18 ${PT + (H - PT - PB) / 2})`, style: { font: '500 11.5px ' + MONO, letterSpacing: '0.04em' } }, 'Y axis — ' + yLabel + ' (slower upwards)')
    ), tip, height, boxRef);
  }

  /* ---------- horizontal SLA bars for agents ---------- */
  function SlaBars({ data, threshold, format, height }) {
    const max = Math.max(threshold * 1.4, ...data.map(d => d.value));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: height ? height + 'px' : 'none', overflowY: height ? 'auto' : 'visible', paddingRight: 4 } },
      data.map((d, i) => h('div', { key: i, style: { display: 'grid', gridTemplateColumns: 'minmax(70px,1.1fr) minmax(60px,2fr) auto', gap: 10, alignItems: 'center' } },
        h('span', { style: { font: '400 12.5px ' + FONT, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, d.name),
        h('div', { style: { position: 'relative', height: 6, borderRadius: 0, background: '#EDEDEA' } },
          h('div', { style: { position: 'absolute', inset: 0, width: (d.value / max) * 100 + '%', borderRadius: 0, background: d.value <= threshold ? PALETTE[2] : (d.value <= threshold * 2 ? '#C4561B' : '#9B2C1F') } }),
          h('div', { style: { position: 'absolute', left: (threshold / max) * 100 + '%', top: -4, bottom: -4, width: 1, background: '#5F5F5B' } })),
        h('span', { style: { font: '500 12px ' + MONO, color: MUTED, textAlign: 'right', whiteSpace: 'nowrap' } }, format(d.value))))
    );
  }

  return { LineChart, MultiLine, BarChart, RankBars, Donut, Scatter, SlaBars, PALETTE, nf };
}
