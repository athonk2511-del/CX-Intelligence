// CX Intelligence — Survey builder (menu "Surveys").
// mount(el, { D, me }) renders the builder into el and returns { destroy }.
// Data lives in the proxy (apps-script/survey.gs); respondents answer on survey.html.
// Surveys whose "CSAT report" link is on feed the CSAT page (gxdata.js → surveyCsat).

const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
// Public address of survey.html. Default: next to the dashboard. If the dashboard host is internal-only,
// set this to a public copy, for example 'https://athonk2511-del.github.io/CX-Intelligence/survey.html'.
const SURVEY_PAGE = '';

const CSS = `
.gxs{font:400 13px/1.55 'Inter',system-ui,sans-serif;color:var(--gx-ink)}
.gxs *{box-sizing:border-box;min-width:0}
.gxs button,.gxs input,.gxs select,.gxs textarea{font:inherit;color:inherit}
.gxs button{cursor:pointer}
.gxs :focus-visible{outline:2px solid #F9C900;outline-offset:1px}
.gxs .mono{font-family:'JetBrains Mono',ui-monospace,monospace}
.gxs .lab{display:block;font:600 10.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--gx-mut);margin:14px 0 6px}
.gxs .mut{color:var(--gx-mut);font-size:12.5px;margin:0}
.gxs .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 12px;border:1px solid var(--gx-ink);border-radius:3px;background:var(--gx-sf);font:500 12px 'JetBrains Mono',ui-monospace,monospace;white-space:nowrap;text-decoration:none;color:var(--gx-ink)}
.gxs .btn.pri{background:var(--gx-inv);color:var(--gx-on-inv)}.gxs .btn.pri:hover{background:var(--gx-inv-h)}
.gxs .btn.ghost{border-color:var(--gx-ln)}.gxs .btn.ghost:hover{border-color:var(--gx-ink)}
.gxs .btn.danger{color:var(--gx-bad);border-color:var(--gx-ln)}
.gxs .btn[disabled]{opacity:.5;cursor:default}
.gxs .bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gxs .sp{flex:1}
.gxs .tpls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.gxs .tpl{text-align:left;border:1px solid var(--gx-ln);border-radius:4px;background:var(--gx-sf);padding:12px;display:flex;flex-direction:column;gap:3px}
.gxs .tpl:hover{border-color:var(--gx-ink)}
.gxs .tpl b{font-weight:600;font-size:13.5px}.gxs .tpl span{font-size:12px;color:var(--gx-mut)}
.gxs .tpl i{font:600 11px 'JetBrains Mono',monospace;font-style:normal;color:var(--gx-acct);background:rgba(249,201,0,.16);border-radius:3px;padding:2px 6px;align-self:flex-start;margin-bottom:6px}
.gxs table{border-collapse:collapse;width:100%}
.gxs th,.gxs td{border-bottom:1px solid var(--gx-ln2);padding:8px 10px;text-align:left;vertical-align:top}
.gxs th{font:600 10.5px 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--gx-mut);background:var(--gx-soft);position:sticky;top:0;z-index:1}
.gxs td.num,.gxs th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.gxs .scroll{overflow:auto}
.gxs .linkb{border:0;background:none;padding:0;font-weight:600;text-align:left;text-decoration:underline;text-underline-offset:2px}
.gxs .badge{font:600 10px 'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;border-radius:3px;padding:2px 6px;white-space:nowrap}
.gxs .b-on{background:rgba(46,107,52,.12);color:var(--gx-good)}.gxs .b-off{background:var(--gx-sf2);color:var(--gx-mut)}.gxs .b-csat{background:rgba(249,201,0,.18);color:var(--gx-acct)}
.gxs .tabs{display:flex;gap:2px;border-bottom:1px solid var(--gx-ln);margin:14px 0 16px;overflow-x:auto}
.gxs .tabs button{border:0;background:none;padding:9px 14px;font:500 12.5px 'Inter',sans-serif;color:var(--gx-mut);border-bottom:2px solid transparent;white-space:nowrap}
.gxs .tabs button.on{color:var(--gx-ink);border-color:#F9C900}
.gxs .cnt{font:600 10.5px 'JetBrains Mono',monospace;background:var(--gx-inv);color:var(--gx-on-inv);border-radius:3px;padding:1px 5px;margin-left:4px}
.gxs .col{max-width:820px;margin:0 auto}
.gxs .box{background:var(--gx-sf);border:1px solid var(--gx-ln);border-radius:4px;padding:16px 18px;margin-bottom:10px}
.gxs .box h4{margin:0 0 6px;font:600 14px 'Inter',sans-serif}
.gxs .in{width:100%;border:0;border-bottom:1px solid var(--gx-ln);background:transparent;padding:7px 2px;font-size:14px;border-radius:0;resize:vertical;outline:none}
.gxs .in:focus{border-bottom:2px solid var(--gx-ink);padding-bottom:6px}
.gxs .in.title{font:600 22px 'Inter',sans-serif}
.gxs .in.box2{border:1px solid var(--gx-ln);border-radius:3px;padding:7px 10px;background:var(--gx-sf)}
.gxs select.ps{border:1px solid var(--gx-ln);border-radius:3px;background:var(--gx-sf);padding:6px 8px;min-height:32px;font-size:13px;max-width:100%}
.gxs .qc{background:var(--gx-sf);border:1px solid var(--gx-ln);border-radius:4px;padding:12px 16px;margin-bottom:8px;cursor:pointer}
.gxs .qc:hover{border-color:#9C9C97}
.gxs .qc.on{cursor:default;border-color:var(--gx-ink);box-shadow:inset 3px 0 0 #F9C900}
.gxs .qh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gxs .qn{font:600 11px 'JetBrains Mono',monospace;background:var(--gx-inv);color:var(--gx-on-inv);border-radius:3px;min-width:22px;height:22px;display:grid;place-items:center;padding:0 5px}
.gxs .chip{font:500 11px 'JetBrains Mono',monospace;color:var(--gx-mut);background:var(--gx-soft);border-radius:3px;padding:2px 7px;white-space:nowrap}
.gxs .req{font:500 11px 'JetBrains Mono',monospace;color:var(--gx-bad)}
.gxs .qtt{margin:6px 0 0;font-weight:500}.gxs .qtt em{color:var(--gx-mut2);font-weight:400}
.gxs .qtitle{font-size:16px;font-weight:600}
.gxs .qf{display:flex;align-items:center;gap:4px;flex-wrap:wrap;border-top:1px solid var(--gx-ln2);margin-top:14px;padding-top:10px}
.gxs .ib{border:0;background:none;min-height:30px;min-width:30px;padding:4px 8px;border-radius:3px;font-size:12.5px;color:var(--gx-mut)}
.gxs .ib:hover{background:var(--gx-soft);color:var(--gx-ink)}.gxs .ib.danger{color:var(--gx-bad)}
.gxs .ib.x{font-size:18px;line-height:1}
.gxs .opts{display:grid;gap:2px;margin-top:8px}
.gxs .opt{display:flex;align-items:center;gap:8px}.gxs .opt .in{flex:1}
.gxs .mk{width:14px;height:14px;border:1.5px solid #9C9C97;border-radius:50%;flex:none;font-size:11px;display:grid;place-items:center;color:var(--gx-mut)}
.gxs .mk.checkbox{border-radius:2px}.gxs .mk.dropdown{border:0;width:20px}
.gxs .other{flex:1;color:var(--gx-mut);padding:7px 2px;border-bottom:1px dotted var(--gx-ln)}
.gxs .jump{max-width:46%;border:1px solid var(--gx-ln);border-radius:3px;background:var(--gx-soft);padding:5px 6px;font-size:12px}
.gxs .row{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;margin-top:8px}
.gxs .link{border:0;background:none;color:var(--gx-acct);font-weight:600;font-size:12.5px;padding:6px 0}
.gxs .ck{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--gx-text);cursor:pointer}
.gxs .ck input{accent-color:#1F1F1D;width:15px;height:15px}
.gxs .sw{display:inline-flex;align-items:center;gap:9px;font-size:13px;cursor:pointer;user-select:none;min-height:30px}
.gxs .sw input{position:absolute;opacity:0;width:1px;height:1px}
.gxs .sw span{width:34px;height:20px;border-radius:10px;background:#DCDCD8;position:relative;transition:background .2s;flex:none}
.gxs .sw span::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#FFFFFF;transition:transform .2s;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.gxs .sw input:checked+span{background:var(--gx-inv)}.gxs .sw input:checked+span::after{transform:translateX(14px)}
.gxs .sw input:focus-visible+span{outline:2px solid #F9C900}
.gxs .prev{margin-top:10px;color:var(--gx-mut2);font-size:12.5px;border-bottom:1px dotted var(--gx-ln);padding:6px 2px;max-width:60%}
.gxs .scl{display:flex;gap:4px;flex-wrap:wrap;margin-top:10px}
.gxs .scl i{font:500 11px 'JetBrains Mono',monospace;font-style:normal;min-width:26px;height:26px;border:1px solid var(--gx-ln);border-radius:3px;display:grid;place-items:center;color:var(--gx-mut)}
.gxs .g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px}
.gxs .seg{display:inline-flex;border:1px solid var(--gx-ln);border-radius:3px;overflow:hidden;flex-wrap:wrap}
.gxs .seg button{border:0;border-left:1px solid var(--gx-ln);background:var(--gx-sf);padding:6px 12px;font:500 12px 'JetBrains Mono',monospace;color:var(--gx-ink)}
.gxs .seg button:first-child{border-left:0}.gxs .seg button.on{background:var(--gx-inv);color:var(--gx-on-inv)}
.gxs .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
.gxs .kpi{background:var(--gx-sf);border:1px solid var(--gx-ln);border-radius:4px;padding:12px 14px}
.gxs .kpi b{display:block;font:600 22px 'Inter',sans-serif;font-variant-numeric:tabular-nums}
.gxs .kpi span{font-size:12px;color:var(--gx-mut)}
.gxs .bars{display:grid;gap:8px;margin-top:10px}
.gxs .hb{display:grid;grid-template-columns:minmax(0,34%) minmax(0,1fr) auto;gap:10px;align-items:center;font-size:12.5px}
.gxs .hb .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gxs .hb .t{height:10px;background:var(--gx-sf2);border-radius:2px;overflow:hidden}.gxs .hb .t i{display:block;height:100%;background:var(--gx-inv)}
.gxs .hb .v{font:500 12px 'JetBrains Mono',monospace;color:var(--gx-mut);white-space:nowrap;min-width:84px;text-align:right}
.gxs .cols{display:flex;align-items:flex-end;gap:5px;height:130px;margin-top:12px;padding-top:16px}
.gxs .cols div{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;font:500 11px 'JetBrains Mono',monospace;color:var(--gx-mut)}
.gxs .cols i{display:block;width:100%;max-width:38px;background:var(--gx-inv);min-height:2px;border-radius:2px 2px 0 0}
.gxs .cols b{color:var(--gx-ink);font-weight:500}
.gxs .stats{display:flex;gap:8px 26px;flex-wrap:wrap;margin-top:10px}
.gxs .stats div{display:flex;flex-direction:column}.gxs .stats b{font:600 20px 'Inter',sans-serif;font-variant-numeric:tabular-nums}.gxs .stats span{font-size:12px;color:var(--gx-mut)}
.gxs .txt{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:5px;max-height:300px;overflow:auto}
.gxs .txt li{background:var(--gx-soft);border-radius:3px;padding:7px 10px;white-space:pre-line;overflow-wrap:anywhere}
.gxs .tblw{max-height:560px;overflow:auto;border:1px solid var(--gx-ln);border-radius:4px;background:var(--gx-sf)}
.gxs .tblw td{min-width:130px;white-space:pre-line}.gxs .tblw td:first-child{min-width:0;white-space:nowrap}
.gxs .one dt{font:600 10.5px 'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--gx-mut);margin-top:12px}.gxs .one dd{margin:3px 0 0;white-space:pre-line;overflow-wrap:anywhere}
.gxs .sws{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.gxs .swc{width:28px;height:28px;border-radius:50%;border:2px solid var(--gx-sf);box-shadow:0 0 0 1px var(--gx-ln);padding:0}
.gxs .swc.on{box-shadow:0 0 0 2px var(--gx-ink)}
.gxs .swc.cu{overflow:hidden;background:conic-gradient(#e5484d,#f2780c,#F9C900,#0f8a55,#1f5eff,#e5484d);position:relative}
.gxs .swc.cu input{opacity:0;position:absolute;inset:0;width:100%;height:100%;cursor:pointer}
.gxs .note{background:rgba(249,201,0,.12);border:1px solid rgba(249,201,0,.45);border-radius:3px;padding:9px 12px;font-size:12.5px;color:#5B4600}
.gxs .err{background:rgba(155,44,31,.07);border:1px solid rgba(155,44,31,.3);border-radius:3px;padding:9px 12px;font-size:12.5px;color:var(--gx-bad)}
.gxs .empty{border:1px dashed var(--gx-ln);border-radius:4px;padding:22px;text-align:center;color:var(--gx-mut);background:var(--gx-sf)}
.gxs-modal{position:fixed;inset:0;z-index:2000;background:rgba(20,20,18,.45);display:grid;place-items:center;padding:16px}
.gxs-modal .mb{background:var(--gx-sf);border-radius:4px;padding:20px;width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;box-shadow:0 24px 60px -16px rgba(0,0,0,.45)}
.gxs-modal h3{margin:0 0 10px;font:600 16px 'Inter',sans-serif}
.gxs-modal .mf{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap}
.gxs-modal .types{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.gxs-modal .types button{display:flex;align-items:center;gap:9px;text-align:left;border:1px solid var(--gx-ln);background:var(--gx-sf);border-radius:3px;padding:8px 10px;font-size:13px}
.gxs-modal .types button:hover{border-color:var(--gx-ink)}
.gxs-modal .ti{font:600 10.5px 'JetBrains Mono',monospace;min-width:34px;height:24px;border-radius:3px;background:var(--gx-soft);display:grid;place-items:center}
.gxs-modal .cp{display:flex;gap:6px}.gxs-modal .cp .in{flex:1;font-size:12.5px}
.gxs-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2100;background:var(--gx-inv);color:var(--gx-on-inv);font:500 12.5px 'Inter',sans-serif;padding:9px 14px;border-radius:3px;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 32px)}
.gxs-toast button{border:0;background:none;color:inherit;text-decoration:underline;font-weight:600;cursor:pointer}
@media(max-width:760px){.gxs .tpls,.gxs .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.gxs .g2,.gxs-modal .types{grid-template-columns:minmax(0,1fr)}.gxs .jump{max-width:none;flex:1 1 100%}.gxs .opt{flex-wrap:wrap}.gxs .hb{grid-template-columns:minmax(0,1fr) auto}.gxs .hb .t{grid-column:1/-1;grid-row:2}}
`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (n = 8) => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; crypto.getRandomValues(new Uint8Array(n)).forEach(x => { s += a[x % a.length]; }); return s; };
const clone = o => JSON.parse(JSON.stringify(o));
const safeColor = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#F9C900';
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '0%';
const fmtN = (x, d) => Number(x).toLocaleString('id-ID', { maximumFractionDigits: d });
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? String(iso || '') : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); };
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fileSafe = s => String(s || 'survei').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'survei';

const TYPES = {
  short: ['Jawaban singkat', 'Aa'], long: ['Paragraf', '¶'], choice: ['Pilihan ganda', '◉'], checkbox: ['Kotak centang', '✓'],
  dropdown: ['Dropdown', '▾'], yesno: ['Ya / Tidak', 'Y/T'], scale: ['Skala linear', '1–5'], rating: ['Rating bintang', '★'],
  nps: ['NPS 0–10', '0–10'], matrix: ['Grid pilihan', '▦'], email: ['Email', '@'], phone: ['Nomor telepon', '☎'],
  number: ['Angka', '#'], date: ['Tanggal', 'Tgl'], time: ['Waktu', 'Jam'], statement: ['Teks / info', 'i'],
};
const OPT = ['choice', 'checkbox', 'dropdown'];
const NUMERIC = ['scale', 'rating', 'nps', 'number'];
const SW = ['#F9C900', '#1F1F1D', '#2FA35A', '#5B8BC7', '#D9483B', '#F0782D', '#1f5eff', '#7a5af8'];
const opt = l => ({ id: uid(5), label: l, jump: '' });
function newQ(type) {
  const q = { id: uid(6), type, title: '', desc: '', required: false };
  if (OPT.includes(type)) Object.assign(q, { options: [opt('Opsi 1'), opt('Opsi 2')], allowOther: false, shuffle: false, logic: false });
  if (type === 'yesno') Object.assign(q, { options: [opt('Ya'), opt('Tidak')], logic: false });
  if (type === 'scale') Object.assign(q, { min: 1, max: 5, minLabel: '', maxLabel: '' });
  if (type === 'rating') q.max = 5;
  if (type === 'nps') Object.assign(q, { minLabel: 'Sangat tidak mungkin', maxLabel: 'Sangat mungkin' });
  if (type === 'matrix') Object.assign(q, { rows: ['Baris 1', 'Baris 2'], cols: ['Kolom 1', 'Kolom 2', 'Kolom 3'] });
  if (type === 'short' || type === 'long') q.maxLen = '';
  if (type === 'number') Object.assign(q, { min: '', max: '' });
  return q;
}
const mq = (t, p) => Object.assign(newQ(t), p);
function newForm() {
  const now = new Date().toISOString();
  return { id: uid(8), title: 'Survei tanpa judul', desc: '', color: '#F9C900', bg: 'dark', showLogo: true, showWelcome: true, startText: 'Mulai', showProgress: true,
    thanksTitle: 'Terima kasih!', thanksMsg: 'Jawaban Anda sudah kami terima.', accepting: true, closedMsg: 'Survei ini sudah tidak menerima jawaban.',
    oneResponse: false, hidden: '', csat: { on: false, ratingQ: '', commentQ: '', whoQ: '' }, questions: [], createdAt: now, updatedAt: now };
}
function template(t) {
  const f = newForm();
  if (t === 'csat') {
    const r = mq('rating', { title: 'Seberapa puas Anda dengan layanan kami?', required: true });
    const c = mq('long', { title: 'Apa alasan utama dari penilaian Anda?' });
    Object.assign(f, { title: 'Survei kepuasan pelanggan (CSAT)', desc: 'Terima kasih sudah menghubungi kami.\nHanya 2 pertanyaan, kurang dari 1 menit.', hidden: 'cid',
      questions: [r, c], csat: { on: true, ratingQ: r.id, commentQ: c.id, whoQ: 'h:cid' } });
  } else if (t === 'tech') {
    const r = mq('rating', { title: 'Seberapa puas Anda dengan kunjungan teknisi kami?', required: true });
    const mx = mq('matrix', { title: 'Bagaimana penilaian Anda untuk teknisi kami?', required: true, rows: ['Ketepatan waktu', 'Kerapian pekerjaan', 'Keramahan', 'Kejelasan penjelasan'], cols: ['Kurang', 'Cukup', 'Baik', 'Sangat baik'] });
    const yn = mq('yesno', { title: 'Apakah kendala internet Anda sudah teratasi?', required: true, logic: true });
    yn.options[0].jump = mx.id;
    const c = mq('long', { title: 'Ada saran untuk kami?' });
    Object.assign(f, { title: 'Survei kepuasan kunjungan teknisi', desc: 'Terima kasih sudah menggunakan layanan kami.\nIsi survei singkat ini, sekitar 1 menit.', hidden: 'cid, wo',
      questions: [r, mq('choice', { title: 'Apakah teknisi datang sesuai jadwal yang disepakati?', required: true, options: [opt('Ya, tepat waktu'), opt('Terlambat kurang dari 30 menit'), opt('Terlambat lebih dari 30 menit'), opt('Teknisi tidak datang')] }),
        yn, mq('long', { title: 'Ceritakan kendala yang masih Anda alami', desc: 'Tim kami akan menindaklanjuti.', required: true }), mx,
        mq('nps', { title: 'Seberapa mungkin Anda merekomendasikan layanan kami kepada teman atau keluarga?', required: true }), c],
      csat: { on: false, ratingQ: r.id, commentQ: c.id, whoQ: 'h:cid' } });
  } else if (t === 'nps') {
    Object.assign(f, { title: 'Survei rekomendasi pelanggan', desc: 'Pendapat Anda membantu kami menjadi lebih baik.', hidden: 'cid',
      questions: [mq('nps', { title: 'Seberapa mungkin Anda merekomendasikan kami kepada teman atau rekan?', required: true }), mq('long', { title: 'Apa alasan utama dari skor yang Anda berikan?' }),
        mq('checkbox', { title: 'Hal apa yang paling penting bagi Anda?', options: [opt('Kecepatan internet'), opt('Kestabilan koneksi'), opt('Respons layanan pelanggan'), opt('Harga')], allowOther: true })] });
  }
  return f;
}
// CSAT link needs a 1–5 rating: stars with 5, or a linear scale 1–5.
const csatRatingOK = q => q && ((q.type === 'rating' && +q.max === 5) || (q.type === 'scale' && +q.min === 1 && +q.max === 5));
const hiddenKeys = f => String(f.hidden || '').split(',').map(x => x.trim()).filter(x => /^[a-z0-9_]{1,30}$/i.test(x));

function fmtAns(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([r, c]) => r + ': ' + c).join('\n');
  return String(v);
}
// Export columns: time, id, hidden fields, then one per question (matrix: one per row). Values keep their type.
function exportCols(f) {
  const cols = [{ h: 'Waktu', v: r => new Date(r.submittedAt) }, { h: 'ID respons', v: r => r.id }];
  hiddenKeys(f).forEach(k => cols.push({ h: k.toUpperCase(), v: r => (r.hidden || {})[k] ?? '' }));
  f.questions.filter(q => q.type !== 'statement').forEach(q => {
    const t = q.title || 'Tanpa judul', A = r => (r.answers || {})[q.id];
    if (q.type === 'matrix') q.rows.forEach(row => cols.push({ h: t + ' — ' + row, v: r => (A(r) || {})[row] ?? '' }));
    else if (q.type === 'checkbox') cols.push({ h: t, v: r => Array.isArray(A(r)) ? A(r).join('; ') : (A(r) ?? '') });
    else if (NUMERIC.includes(q.type)) cols.push({ h: t, v: r => { const x = A(r); return x === undefined || x === null || x === '' ? '' : Number(x); } });
    else cols.push({ h: t, v: r => A(r) ?? '' });
  });
  return cols;
}

export function mount(el, opts) {
  const D = opts.D, me = opts.me || { role: 'admin' };
  const canEdit = me.role !== 'viewer';
  if (!document.getElementById('gxs-css')) { const st = document.createElement('style'); st.id = 'gxs-css'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'gxs'; el.innerHTML = ''; el.appendChild(root);
  const S = { view: 'list', forms: [], loading: true, error: '', form: null, tab: 'q', sel: null, resp: [], respFor: null, respErr: '', rv: 'sum', ri: 0, from: '', to: '', saveText: '', timer: null, saving: false, again: false, pending: null, dead: false };
  const api = (op, p) => D.surveyCall(op, p);
  const pageUrl = () => SURVEY_PAGE || new URL('survey.html', location.href.split('#')[0]).href;
  const link = (id, withHidden) => { let u = pageUrl() + '?f=' + id; if (withHidden && S.form) hiddenKeys(S.form).forEach(k => { u += '&' + k + '={' + k.toUpperCase() + '}'; }); return u; };
  const getQ = id => S.form && S.form.questions.find(q => q.id === id);

  /* ---------- small UI helpers ---------- */
  let modalEl = null, toastEl = null;
  function modal(html) {
    closeModal(); modalEl = document.createElement('div'); modalEl.className = 'gxs-modal gxs';
    modalEl.innerHTML = '<div class="mb" role="dialog" aria-modal="true">' + html + '</div>';
    modalEl.addEventListener('click', onClick); modalEl.addEventListener('input', onInput);
    modalEl.addEventListener('mousedown', e => { if (e.target === modalEl) closeModal(); });
    document.body.appendChild(modalEl);
    const f = modalEl.querySelector('input,textarea,button'); if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function toast(msg, act, fn) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement('div'); toastEl.className = 'gxs-toast'; const sp = document.createElement('span'); sp.textContent = msg; toastEl.appendChild(sp);
    if (act) { const b = document.createElement('button'); b.textContent = act; b.onclick = () => { toastEl.remove(); fn(); }; toastEl.appendChild(b); }
    document.body.appendChild(toastEl); const t = toastEl; setTimeout(() => t.remove(), act ? 5000 : 2600);
  }
  function confirmBox(msg, ok, fn) { S.pending = fn; modal(`<h3>Konfirmasi</h3><p>${esc(msg)}</p><div class="mf"><button class="btn ghost" data-a="mclose">Batal</button><button class="btn pri" style="background:#D9483B;border-color:#D9483B" data-a="mok">${esc(ok)}</button></div>`); }
  function copyText(text, input) {
    const ok = () => toast('Tersalin'), fail = () => { if (input) { input.select(); toast('Tekan Ctrl+C / Cmd+C untuk menyalin'); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail); else fail();
  }
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  /* ---------- list ---------- */
  async function loadList() {
    S.loading = true; S.error = ''; render();
    try { S.forms = await api('list'); } catch (e) { S.error = e.message; }
    S.loading = false; if (S.view === 'list') render();
  }
  function listHTML() {
    const forms = S.forms.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return `${canEdit ? `<span class="lab" style="margin-top:0">Buat survei baru</span><div class="tpls">
      <button class="tpl" data-a="new" data-t="blank"><i>KOSONG</i><b>Survei kosong</b><span>Susun sendiri dari nol</span></button>
      <button class="tpl" data-a="new" data-t="csat"><i>CSAT</i><b>CSAT layanan</b><span>Rating 1–5 + alasan, langsung masuk laporan CSAT</span></button>
      <button class="tpl" data-a="new" data-t="tech"><i>FIELD</i><b>Kunjungan teknisi</b><span>7 pertanyaan, logika lompat, CID & WO</span></button>
      <button class="tpl" data-a="new" data-t="nps"><i>NPS</i><b>NPS pelanggan</b><span>Skor 0–10 + alasan</span></button></div>` : ''}
    <div class="bar" style="margin:18px 0 8px"><span class="lab" style="margin:0">Semua survei</span><span class="sp"></span><button class="btn ghost" data-a="reload">Muat ulang</button></div>
    ${S.error ? `<div class="err">${esc(S.error)}</div>` : S.loading ? '<div class="empty">Memuat survei…</div>' : !forms.length ? '<div class="empty">Belum ada survei.' + (canEdit ? ' Pilih salah satu template di atas.' : '') + '</div>' :
      `<div class="scroll" style="background:var(--gx-sf);border:1px solid var(--gx-ln);border-radius:4px"><table><thead><tr><th>Survei</th><th class="num">Pertanyaan</th><th class="num">Respons</th><th>Status</th><th>Diubah</th><th></th></tr></thead><tbody>${forms.map(f => `<tr>
        <td><button class="linkb" data-a="open" data-id="${esc(f.id)}">${esc(f.title || 'Tanpa judul')}</button>${f.csat && f.csat.on ? ' <span class="badge b-csat">CSAT</span>' : ''}</td>
        <td class="num">${(f.questions || []).length}</td><td class="num">${f.responseCount || 0}</td>
        <td><span class="badge ${f.accepting ? 'b-on' : 'b-off'}">${f.accepting ? 'Aktif' : 'Ditutup'}</span></td>
        <td class="mut" style="white-space:nowrap">${esc(fmtDate(f.updatedAt))}${f.updatedBy ? '<br>' + esc(f.updatedBy) : ''}</td>
        <td style="white-space:nowrap;text-align:right"><button class="btn ghost" data-a="share" data-id="${esc(f.id)}">Bagikan</button> ${canEdit ? `<button class="btn ghost" data-a="dup" data-id="${esc(f.id)}">Duplikat</button> <button class="btn danger" data-a="del" data-id="${esc(f.id)}">Hapus</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`}`;
  }
  async function createForm(t) {
    const f = template(t);
    try { await api('save', { form: f }); } catch (e) { return toast('Gagal membuat: ' + e.message); }
    S.forms.push(f); openObj(f);
  }
  async function openForm(id) {
    let f = S.forms.find(x => x.id === id);
    try { f = await api('get', { id }); } catch (e) { if (!f) return toast(e.message); }
    openObj(f);
  }
  function openObj(f) {
    if (!f.csat) f.csat = { on: false, ratingQ: '', commentQ: '', whoQ: '' };
    S.form = f; S.view = 'edit'; S.tab = canEdit ? 'q' : 'r'; S.sel = f.questions[0] ? f.questions[0].id : null; S.resp = []; S.respFor = null; S.respErr = ''; S.rv = 'sum'; S.ri = 0; S.saveText = 'Tersimpan';
    render(); loadResp();
  }

  /* ---------- editor ---------- */
  function setSave(t) { S.saveText = t; const e = root.querySelector('#gxs-save'); if (e) e.textContent = t; }
  function dirty() { if (!canEdit) return; setSave('Menyimpan…'); clearTimeout(S.timer); S.timer = setTimeout(saveNow, 800); }
  async function saveNow() {
    clearTimeout(S.timer); S.timer = null;
    if (!S.form) return;
    if (S.saving) { S.again = true; return; }
    S.saving = true; const snap = clone(S.form);
    try { const r = await api('save', { form: snap }); if (S.form && S.form.id === snap.id) S.form.updatedAt = r.updatedAt; const i = S.forms.findIndex(x => x.id === snap.id); if (i >= 0) S.forms[i] = Object.assign(snap, { responseCount: S.forms[i].responseCount }); setSave('Tersimpan'); }
    catch (e) { setSave('Gagal menyimpan'); toast('Gagal menyimpan: ' + e.message); }
    S.saving = false; if (S.again) { S.again = false; saveNow(); }
  }
  const flush = async () => { if (S.timer) await saveNow(); };
  function editHTML() {
    const f = S.form, n = S.respFor === f.id ? S.resp.length : 0;
    const tabs = (canEdit ? [['q', 'Pertanyaan'], ['r', 'Respons'], ['s', 'Pengaturan']] : [['r', 'Respons']]);
    return `<div class="bar"><button class="btn ghost" data-a="back">← Semua survei</button><b style="font-size:15px">${esc(trunc(f.title || 'Tanpa judul', 70))}</b>${f.csat && f.csat.on ? '<span class="badge b-csat">Masuk laporan CSAT</span>' : ''}<span class="sp"></span>
      <span class="mut mono" id="gxs-save">${canEdit ? esc(S.saveText) : 'View only'}</span><button class="btn ghost" data-a="preview">Pratinjau</button><button class="btn pri" data-a="share" data-id="${esc(f.id)}">Bagikan</button></div>
      <nav class="tabs">${tabs.map(([k, l]) => `<button data-a="tab" data-t="${k}" class="${S.tab === k ? 'on' : ''}">${l}${k === 'r' && n ? '<span class="cnt">' + n + '</span>' : ''}</button>`).join('')}</nav>
      <div id="gxs-pane">${paneHTML()}</div>`;
  }
  function paneHTML() { return S.tab === 'q' ? qPane() : S.tab === 'r' ? rPane() : sPane(); }
  function renderPane() { const p = root.querySelector('#gxs-pane'); if (p) p.innerHTML = paneHTML(); else render(); }
  function render() { if (S.dead) return; root.innerHTML = S.view === 'list' ? listHTML() : editHTML(); }

  function qPane() {
    const f = S.form;
    return `<div class="col"><div class="box" style="border-top:3px solid #F9C900"><input class="in title" data-s="f" data-k="title" value="${esc(f.title)}" placeholder="Judul survei" aria-label="Judul survei">
      <textarea class="in" data-s="f" data-k="desc" rows="2" placeholder="Kata pengantar di layar pembuka" aria-label="Deskripsi">${esc(f.desc)}</textarea></div>
      ${f.questions.map(qCard).join('')}${f.questions.length ? '' : '<div class="empty">Belum ada pertanyaan.</div>'}
      <div class="bar" style="justify-content:center;margin-top:10px"><button class="btn pri" data-a="addmenu">+ Tambah pertanyaan</button></div></div>`;
  }
  function qCard(q, i) {
    const on = S.sel === q.id, T = TYPES[q.type] || TYPES.short, d = `data-id="${q.id}"`, csatTag = S.form.csat && S.form.csat.on && S.form.csat.ratingQ === q.id ? '<span class="badge b-csat">Skor CSAT</span>' : '';
    const h = `<article class="qc ${on ? 'on' : ''}" data-a="sel" ${d} id="gxs-q-${q.id}"><div class="qh"><span class="qn">${i + 1}</span><span class="chip">${T[1]} · ${T[0]}</span>${q.required ? '<span class="req">Wajib</span>' : ''}${q.logic ? '<span class="chip">Logika</span>' : ''}${csatTag}</div>`;
    if (!on) return h + `<p class="qtt">${q.title ? esc(q.title) : '<em>Pertanyaan tanpa judul</em>'}</p></article>`;
    return h + `<input class="in qtitle" data-s="q" ${d} data-k="title" value="${esc(q.title)}" placeholder="${q.type === 'statement' ? 'Judul teks' : 'Tulis pertanyaan'}" aria-label="Pertanyaan">
      <textarea class="in" rows="1" data-s="q" ${d} data-k="desc" placeholder="Deskripsi (opsional)" aria-label="Deskripsi">${esc(q.desc)}</textarea>${typeEditor(q)}
      <footer class="qf"><select class="ps" data-s="q" ${d} data-k="type" aria-label="Jenis pertanyaan">${Object.keys(TYPES).map(t => `<option value="${t}" ${t === q.type ? 'selected' : ''}>${TYPES[t][0]}</option>`).join('')}</select><span class="sp"></span>
      <button class="ib" data-a="up" ${d} aria-label="Naik">↑</button><button class="ib" data-a="down" ${d} aria-label="Turun">↓</button><button class="ib" data-a="dupq" ${d}>Duplikat</button><button class="ib danger" data-a="delq" ${d}>Hapus</button>
      ${q.type !== 'statement' ? `<label class="sw"><input type="checkbox" data-s="q" ${d} data-k="required" data-rr="1" ${q.required ? 'checked' : ''}><span></span>Wajib</label>` : ''}</footer></article>`;
  }
  function jumpSel(q, o, oi) {
    const qs = S.form.questions, idx = qs.findIndex(x => x.id === q.id);
    return `<select class="jump" data-s="o" data-id="${q.id}" data-oi="${oi}" data-k="jump" aria-label="Jika dipilih, lompat ke"><option value="">→ Lanjut berikutnya</option>${qs.slice(idx + 1).map((x, j) => `<option value="${x.id}" ${o.jump === x.id ? 'selected' : ''}>→ ${idx + j + 2}. ${esc(trunc(x.title || 'Tanpa judul', 30))}</option>`).join('')}<option value="_end" ${o.jump === '_end' ? 'selected' : ''}>→ Akhiri survei</option></select>`;
  }
  function typeEditor(q) {
    const d = `data-id="${q.id}"`, t = q.type;
    if (OPT.includes(t)) return `<div class="opts">${q.options.map((o, oi) => `<div class="opt"><span class="mk ${t}">${t === 'dropdown' ? oi + 1 + '.' : ''}</span><input class="in" data-s="o" ${d} data-oi="${oi}" data-k="label" value="${esc(o.label)}" aria-label="Opsi ${oi + 1}">${q.logic && t !== 'checkbox' ? jumpSel(q, o, oi) : ''}<button class="ib x" data-a="delopt" ${d} data-oi="${oi}" aria-label="Hapus opsi">×</button></div>`).join('')}
      ${q.allowOther ? `<div class="opt"><span class="mk ${t}"></span><span class="other">Lainnya (responden mengetik sendiri)</span><button class="ib x" data-a="noother" ${d} aria-label="Hapus Lainnya">×</button></div>` : ''}</div>
      <div class="row"><button class="link" data-a="addopt" ${d}>+ Tambah opsi</button>${t !== 'dropdown' && !q.allowOther ? `<button class="link" data-a="other" ${d}>+ Tambah "Lainnya"</button>` : ''}<button class="link" data-a="bulk" ${d}>Tempel banyak opsi</button></div>
      <div class="row"><label class="ck"><input type="checkbox" data-s="q" ${d} data-k="shuffle" ${q.shuffle ? 'checked' : ''}>Acak urutan opsi</label>${t !== 'checkbox' ? `<label class="ck"><input type="checkbox" data-s="q" ${d} data-k="logic" data-rr="1" ${q.logic ? 'checked' : ''}>Lompat ke pertanyaan berdasarkan jawaban</label>` : ''}</div>`;
    if (t === 'yesno') return `<div class="opts">${q.options.map((o, oi) => `<div class="opt"><span class="mk"></span><span class="other" style="border:0">${esc(o.label)}</span>${q.logic ? jumpSel(q, o, oi) : ''}</div>`).join('')}</div><div class="row"><label class="ck"><input type="checkbox" data-s="q" ${d} data-k="logic" data-rr="1" ${q.logic ? 'checked' : ''}>Lompat ke pertanyaan berdasarkan jawaban</label></div>`;
    if (t === 'scale') return `<div class="g2" style="margin-top:6px"><label><span class="lab">Dari</span><select class="ps" data-s="q" ${d} data-k="min" data-num="1" data-rr="1">${[0, 1].map(v => `<option ${+q.min === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label><span class="lab">Sampai</span><select class="ps" data-s="q" ${d} data-k="max" data-num="1" data-rr="1">${range(2, 10).map(v => `<option ${+q.max === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label><span class="lab">Label terendah</span><input class="in" data-s="q" ${d} data-k="minLabel" value="${esc(q.minLabel)}" placeholder="mis. Sangat tidak puas"></label><label><span class="lab">Label tertinggi</span><input class="in" data-s="q" ${d} data-k="maxLabel" value="${esc(q.maxLabel)}" placeholder="mis. Sangat puas"></label></div><div class="scl">${range(+q.min, +q.max).map(v => `<i>${v}</i>`).join('')}</div>`;
    if (t === 'rating') return `<label><span class="lab">Jumlah bintang</span><select class="ps" data-s="q" ${d} data-k="max" data-num="1" data-rr="1">${range(3, 10).map(v => `<option ${+q.max === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><div class="scl" style="color:#D4A20B;font-size:20px">${'★'.repeat(+q.max)}</div>${+q.max !== 5 ? '<p class="mut" style="margin-top:6px">Hanya rating 5 bintang yang bisa dihubungkan ke laporan CSAT.</p>' : ''}`;
    if (t === 'nps') return `<div class="scl">${range(0, 10).map(v => `<i>${v}</i>`).join('')}</div><div class="g2"><label><span class="lab">Label 0</span><input class="in" data-s="q" ${d} data-k="minLabel" value="${esc(q.minLabel)}"></label><label><span class="lab">Label 10</span><input class="in" data-s="q" ${d} data-k="maxLabel" value="${esc(q.maxLabel)}"></label></div>`;
    if (t === 'matrix') {
      const list = (arr, s, add, del, nm) => `<div><span class="lab">${nm}</span>${arr.map((v, i) => `<div class="opt"><input class="in" data-s="${s}" ${d} data-oi="${i}" value="${esc(v)}" aria-label="${nm} ${i + 1}"><button class="ib x" data-a="${del}" ${d} data-oi="${i}" aria-label="Hapus">×</button></div>`).join('')}<button class="link" data-a="${add}" ${d}>+ Tambah</button></div>`;
      return `<div class="g2">${list(q.rows, 'r', 'addrow', 'delrow', 'Baris (aspek yang dinilai)')}${list(q.cols, 'c', 'addcol', 'delcol', 'Kolom (pilihan)')}</div>`;
    }
    if (t === 'short' || t === 'long') return `<div class="prev">${t === 'short' ? 'Teks jawaban singkat' : 'Teks jawaban panjang'}</div><div class="row"><label class="ck">Batas karakter <input class="in box2" style="width:110px" type="number" min="1" data-s="q" ${d} data-k="maxLen" data-num="1" value="${esc(q.maxLen)}" placeholder="Tanpa batas"></label></div>`;
    if (t === 'number') return `<div class="row"><label class="ck">Minimal <input class="in box2" style="width:100px" type="number" data-s="q" ${d} data-k="min" data-num="1" value="${esc(q.min)}"></label><label class="ck">Maksimal <input class="in box2" style="width:100px" type="number" data-s="q" ${d} data-k="max" data-num="1" value="${esc(q.max)}"></label></div>`;
    if (t === 'statement') return '<p class="mut" style="margin-top:8px">Layar informasi tanpa jawaban, cocok untuk pembatas bagian.</p>';
    return `<div class="prev">${{ email: 'nama@email.com (format dicek)', phone: '08xx (format dicek)', date: 'Pemilih tanggal', time: 'Pemilih jam' }[t] || ''}</div>`;
  }
  function convertType(q, t) {
    if (!q || q.type === t) return;
    const n = newQ(t); n.id = q.id; n.title = q.title; n.desc = q.desc; n.required = t === 'statement' ? false : q.required;
    if (OPT.includes(t) && OPT.includes(q.type)) { n.options = q.options; n.allowOther = t !== 'dropdown' && q.allowOther; n.shuffle = q.shuffle; n.logic = t !== 'checkbox' && q.logic; }
    const qs = S.form.questions; qs[qs.findIndex(x => x.id === q.id)] = n;
  }
  function cleanRefs() {
    const ids = new Set(S.form.questions.map(q => q.id));
    S.form.questions.forEach(q => (q.options || []).forEach(o => { if (o.jump && o.jump !== '_end' && !ids.has(o.jump)) o.jump = ''; }));
    const c = S.form.csat; if (c) ['ratingQ', 'commentQ', 'whoQ'].forEach(k => { if (c[k] && !/^h:/.test(c[k]) && !ids.has(c[k])) c[k] = ''; });
  }
  function focusQ(id) { setTimeout(() => { const c = root.querySelector('#gxs-q-' + id); if (!c) return; c.scrollIntoView({ block: 'center', behavior: 'smooth' }); const i = c.querySelector('.qtitle'); if (i) i.focus({ preventScroll: true }); }, 60); }

  /* ---------- settings ---------- */
  function sPane() {
    const f = S.form, c = f.csat || (f.csat = { on: false }), qs = f.questions;
    const sw = (k, label, rr) => `<label class="sw"><input type="checkbox" data-s="f" data-k="${k}" ${rr ? 'data-rr="1"' : ''} ${f[k] ? 'checked' : ''}><span></span>${label}</label>`;
    const rq = qs.filter(csatRatingOK), cq = qs.filter(q => q.type === 'long' || q.type === 'short'), wq = qs.filter(q => ['short', 'email', 'phone', 'number'].includes(q.type));
    const sel = (k, list, none) => `<select class="ps" data-s="c" data-k="${k}" data-rr="1" style="width:100%"><option value="">${none}</option>${list.map(([v, l]) => `<option value="${esc(v)}" ${c[k] === v ? 'selected' : ''}>${esc(trunc(l, 70))}</option>`).join('')}</select>`;
    const qn = q => (qs.indexOf(q) + 1) + '. ' + (q.title || 'Tanpa judul');
    const hk = hiddenKeys(f);
    const csatProblem = c.on && !csatRatingOK(getQ(c.ratingQ)) ? '<div class="err" style="margin-top:10px">Pilih pertanyaan skor 1–5 (rating 5 bintang atau skala 1–5). Tanpa itu, respons belum masuk laporan CSAT.</div>' : '';
    return `<div class="col">
    <div class="box"><h4>Hubungkan ke laporan CSAT CX Intelligence</h4><p class="mut">Respons survei ini akan ikut dihitung di halaman CSAT, Executive overview dan perbandingan week/month/year: skor, distribusi rating, top-2-box dan komentar pelanggan.</p>
      <div style="margin-top:10px"><label class="sw"><input type="checkbox" data-s="c" data-k="on" data-rr="1" ${c.on ? 'checked' : ''}><span></span>Masukkan respons ke laporan CSAT</label></div>
      ${c.on ? `<div class="g2"><label><span class="lab">Pertanyaan skor CSAT (1–5)</span>${sel('ratingQ', rq.map(q => [q.id, qn(q)]), rq.length ? 'Pilih pertanyaan' : 'Belum ada rating 5 bintang / skala 1–5')}</label>
        <label><span class="lab">Komentar pelanggan</span>${sel('commentQ', cq.map(q => [q.id, qn(q)]), 'Tanpa komentar')}</label>
        <label><span class="lab">Identitas (kolom "who")</span>${sel('whoQ', hk.map(k => ['h:' + k, 'Dari link: ' + k.toUpperCase()]).concat(wq.map(q => [q.id, qn(q)])), 'Tidak ada')}</label></div>${csatProblem}
        <p class="mut" style="margin-top:10px">Jangan aktifkan untuk survei yang pelanggannya juga mengisi CSAT dari sistem lama di periode yang sama, supaya satu pengalaman tidak terhitung dua kali.</p>` : ''}</div>
    <div class="box"><h4>Data dari link (hidden fields)</h4><p class="mut">Nilai yang ikut terkirim lewat link tanpa ditanyakan ke pelanggan, misalnya CID dan nomor WO. Pisahkan dengan koma.</p>
      <input class="in box2" style="margin-top:8px" data-s="f" data-k="hidden" value="${esc(f.hidden || '')}" placeholder="cid, wo, agent" aria-label="Hidden fields">
      ${hk.length ? `<p class="mut mono" style="margin-top:8px;overflow-wrap:anywhere">${esc(link(f.id, true))}</p>` : ''}</div>
    <div class="box"><h4>Tampilan untuk responden</h4><span class="lab">Warna utama</span>
      <div class="sws">${SW.map(x => `<button class="swc ${f.color === x ? 'on' : ''}" style="background:${x}" data-a="color" data-c="${x}" aria-label="Warna ${x}"></button>`).join('')}<label class="swc cu ${SW.includes(f.color) ? '' : 'on'}"><input type="color" data-s="f" data-k="color" value="${safeColor(f.color)}" aria-label="Warna kustom"></label></div>
      <span class="lab">Latar</span><div class="seg">${[['light', 'Terang'], ['dark', 'Gelap'], ['color', 'Warna penuh']].map(([k, l]) => `<button data-a="bg" data-t="${k}" class="${f.bg === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div style="margin-top:12px">${sw('showLogo', 'Tampilkan logo GlobalXtreme')}</div><div>${sw('showProgress', 'Tampilkan progress bar')}</div></div>
    <div class="box"><h4>Layar pembuka dan penutup</h4>${sw('showWelcome', 'Tampilkan layar pembuka', 1)}
      ${f.showWelcome ? `<label><span class="lab">Teks tombol mulai</span><input class="in" data-s="f" data-k="startText" value="${esc(f.startText)}"></label>` : ''}
      <label><span class="lab">Judul layar terima kasih</span><input class="in" data-s="f" data-k="thanksTitle" value="${esc(f.thanksTitle)}"></label>
      <label><span class="lab">Pesan terima kasih</span><textarea class="in" rows="2" data-s="f" data-k="thanksMsg">${esc(f.thanksMsg)}</textarea></label></div>
    <div class="box"><h4>Respons</h4>${sw('accepting', 'Menerima respons', 1)}
      <label><span class="lab">Pesan saat survei ditutup</span><textarea class="in" rows="2" data-s="f" data-k="closedMsg">${esc(f.closedMsg)}</textarea></label>
      <div style="margin-top:10px">${sw('oneResponse', 'Batasi 1 respons per perangkat')}</div><p class="mut">Berbasis browser responden, bukan verifikasi identitas. Untuk mencocokkan ke pelanggan, pakai hidden field CID.</p></div></div>`;
  }

  /* ---------- responses ---------- */
  async function loadResp(force) {
    if (!S.form || (S.respFor === S.form.id && !force)) return;
    const id = S.form.id; S.respErr = '';
    try { const r = await api('responses', { formId: id }); if (!S.form || S.form.id !== id) return; S.resp = r; S.respFor = id; }
    catch (e) { S.respErr = e.message; }
    if (S.view !== 'edit') return;
    const tb = root.querySelector('.tabs'); if (tb) { const tmp = document.createElement('div'); tmp.innerHTML = editHTML(); tb.replaceWith(tmp.querySelector('.tabs')); }
    if (S.tab === 'r') renderPane();
  }
  function filtered() {
    const a = S.from ? new Date(S.from + 'T00:00:00').getTime() : -Infinity, b = S.to ? new Date(S.to + 'T23:59:59.999').getTime() : Infinity;
    return S.resp.filter(r => { const t = new Date(r.submittedAt).getTime(); return t >= a && t <= b; }).sort((x, y) => String(y.submittedAt).localeCompare(String(x.submittedAt)));
  }
  function hbars(entries, denom) { return '<div class="bars">' + entries.map(([l, c]) => { const p = denom ? Math.round(c / denom * 100) : 0; return `<div class="hb"><span class="l" title="${esc(l)}">${esc(l)}</span><span class="t"><i style="width:${p}%"></i></span><span class="v">${c} · ${p}%</span></div>`; }).join('') + '</div>'; }
  function sumCard(q, R) {
    const vals = R.map(r => (r.answers || {})[q.id]).filter(v => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
    const k = vals.length; let body = '';
    if (OPT.includes(q.type) || q.type === 'yesno') {
      const m = new Map(q.options.map(o => [o.label, 0]));
      vals.forEach(v => (Array.isArray(v) ? v : [v]).forEach(x => { let key = String(x); if (key.startsWith('Lainnya: ')) key = 'Lainnya'; m.set(key, (m.get(key) || 0) + 1); }));
      body = hbars([...m], k) + (q.type === 'checkbox' ? '<p class="mut" style="margin-top:8px">% dari responden yang menjawab; total bisa lebih dari 100%.</p>' : '');
      const others = vals.flatMap(v => Array.isArray(v) ? v : [v]).filter(x => String(x).startsWith('Lainnya: '));
      if (others.length) body += `<span class="lab">Jawaban "Lainnya"</span><ul class="txt">${others.slice(0, 30).map(x => `<li>${esc(String(x).slice(9))}</li>`).join('')}</ul>`;
    } else if (['scale', 'rating', 'nps'].includes(q.type)) {
      const lo = q.type === 'nps' ? 0 : q.type === 'rating' ? 1 : +q.min, hi = q.type === 'nps' ? 10 : +q.max, nums = vals.map(Number).filter(x => !isNaN(x)), c = nums.length;
      const avg = c ? nums.reduce((a, b) => a + b, 0) / c : 0;
      let st = `<div class="stats"><div><b>${fmtN(avg, 2)}</b><span>rata-rata (skala ${lo}–${hi})</span></div>`;
      if (q.type === 'nps') { const P = nums.filter(v => v >= 9).length, Dt = nums.filter(v => v <= 6).length; st += `<div><b>${c ? Math.round((P - Dt) / c * 100) : 0}</b><span>skor NPS</span></div><div><b>${pct(P, c)}</b><span>promoter 9–10</span></div><div><b>${pct(c - P - Dt, c)}</b><span>passive 7–8</span></div><div><b>${pct(Dt, c)}</b><span>detractor 0–6</span></div>`; }
      else st += `<div><b>${pct(nums.filter(v => v >= hi - 1).length, c)}</b><span>top-2-box (${hi - 1}–${hi})</span></div><div><b>${pct(nums.filter(v => v <= lo + 1).length, c)}</b><span>bottom-2-box (${lo}–${lo + 1})</span></div>`;
      const dist = range(lo, hi).map(x => [x, nums.filter(v => v === x).length]), mx = Math.max(1, ...dist.map(x => x[1]));
      body = st + `</div><div class="cols">${dist.map(([x, n]) => `<div><b>${n}</b><i style="height:${Math.round(n / mx * 100)}%"></i>${x}</div>`).join('')}</div>`;
    } else if (q.type === 'matrix') {
      body = `<div class="scroll" style="margin-top:10px"><table><thead><tr><th></th>${q.cols.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>${q.rows.map(r => { const tot = vals.filter(v => v && v[r]).length; return `<tr><td>${esc(r)}</td>${q.cols.map(c => { const n = vals.filter(v => v && v[r] === c).length; return `<td class="num">${n} <span class="mut">(${pct(n, tot)})</span></td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>`;
    } else body = `<ul class="txt">${vals.slice(0, 30).map(v => `<li>${esc(fmtAns(v))}</li>`).join('')}</ul>${k > 30 ? `<p class="mut" style="margin-top:6px">30 terbaru dari ${k}. Semua ada di Tabel dan file unduhan.</p>` : ''}`;
    return `<div class="box"><h4>${esc(q.title || 'Tanpa judul')}</h4><p class="mut">${k} dari ${R.length} responden menjawab</p>${body}</div>`;
  }
  function rPane() {
    const f = S.form, Q = f.questions.filter(q => q.type !== 'statement');
    if (S.respErr) return `<div class="err">${esc(S.respErr)}</div>`;
    if (S.respFor !== f.id) return '<div class="empty">Memuat respons…</div>';
    const R = filtered(), n = R.length, all = S.resp.length;
    let h = `<div class="bar" style="margin-bottom:12px"><span class="lab" style="margin:0">Dari</span><input type="date" class="in box2" style="width:auto" data-s="d" data-k="from" value="${S.from}" aria-label="Dari tanggal"><span class="lab" style="margin:0">Sampai</span><input type="date" class="in box2" style="width:auto" data-s="d" data-k="to" value="${S.to}" aria-label="Sampai tanggal">
      ${S.from || S.to ? '<button class="btn ghost" data-a="clr">Semua tanggal</button>' : ''}<span class="sp"></span>
      ${canEdit ? `<label class="sw"><input type="checkbox" data-s="f" data-k="accepting" data-rr="1" ${f.accepting ? 'checked' : ''}><span></span>${f.accepting ? 'Menerima respons' : 'Ditutup'}</label>` : ''}
      <button class="btn ghost" data-a="refresh">Muat ulang</button><button class="btn pri" data-a="xlsx" ${n ? '' : 'disabled'}>Unduh Excel</button><button class="btn" data-a="csv" ${n ? '' : 'disabled'}>Unduh CSV</button></div>`;
    if (!all) return h + `<div class="empty">Belum ada respons. Bagikan link survei untuk mulai mengumpulkan jawaban.</div>`;
    if (!n) return h + '<div class="empty">Tidak ada respons di rentang tanggal ini.</div>';
    const first = R[R.length - 1], last = R[0];
    h += `<div class="kpis"><div class="kpi"><b>${n}</b><span>respons${n !== all ? ' dari ' + all + ' total' : ''}</span></div><div class="kpi"><b style="font-size:15px">${esc(fmtDate(last.submittedAt))}</b><span>respons terakhir</span></div><div class="kpi"><b style="font-size:15px">${esc(fmtDate(first.submittedAt))}</b><span>respons pertama di rentang ini</span></div><div class="kpi"><b>${f.csat && f.csat.on && csatRatingOK(getQ(f.csat.ratingQ)) ? 'Ya' : 'Tidak'}</b><span>masuk laporan CSAT</span></div></div>
      <div class="seg" style="margin-bottom:12px">${[['sum', 'Ringkasan'], ['one', 'Per responden'], ['tbl', 'Tabel']].map(([k, l]) => `<button data-a="rv" data-t="${k}" class="${S.rv === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (S.rv === 'sum') return h + `<div class="col" style="max-width:none">${Q.map(q => sumCard(q, R)).join('')}</div>`;
    if (S.rv === 'one') {
      S.ri = Math.min(Math.max(S.ri, 0), n - 1); const r = R[S.ri], hk = hiddenKeys(f);
      return h + `<div class="box one"><div class="bar"><button class="btn ghost" data-a="ri" data-d="-1" ${S.ri === 0 ? 'disabled' : ''} aria-label="Sebelumnya">‹</button><b class="mono">${S.ri + 1} / ${n}</b><button class="btn ghost" data-a="ri" data-d="1" ${S.ri === n - 1 ? 'disabled' : ''} aria-label="Berikutnya">›</button><span class="mut">${esc(fmtDate(r.submittedAt))}</span><span class="sp"></span>${canEdit ? `<button class="btn danger" data-a="delresp" data-id="${esc(r.id)}">Hapus respons</button>` : ''}</div>
        <dl>${hk.map(k => `<dt>${esc(k)}</dt><dd>${esc((r.hidden || {})[k] || '—')}</dd>`).join('')}${Q.map(q => `<dt>${esc(q.title || 'Tanpa judul')}</dt><dd>${esc(fmtAns((r.answers || {})[q.id]))}</dd>`).join('')}</dl></div>`;
    }
    const cols = exportCols(f);
    return h + `<div class="tblw"><table><thead><tr>${cols.map(c => `<th>${esc(trunc(c.h, 60))}</th>`).join('')}</tr></thead><tbody>${R.map(r => `<tr>${cols.map((c, i) => { const v = c.v(r); return `<td>${esc(i === 0 ? fmtDate(r.submittedAt) : v === '' ? '—' : String(v))}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------- downloads ---------- */
  function fileBase() { const f = S.form; return fileSafe(f.title) + (S.from || S.to ? '_' + (S.from || 'awal') + '_' + (S.to || ymd(new Date())) : '_' + ymd(new Date())); }
  function dlCsv() {
    const f = S.form, cols = exportCols(f), R = filtered().reverse();
    const cell = v => { if (v instanceof Date) v = ymd(v) + ' ' + v.toTimeString().slice(0, 8); let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = '\uFEFF' + [cols.map(c => cell(c.h)).join(','), ...R.map(r => cols.map(c => { const v = c.v(r); return typeof v === 'number' ? String(v) : cell(v); }).join(','))].join('\r\n');
    download(fileBase() + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  }
  let xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxP) xlsxP = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = XLSX_SRC; sc.onload = () => res(window.XLSX); sc.onerror = () => { xlsxP = null; rej(new Error('Library Excel tidak bisa dimuat. Pakai Unduh CSV.')); }; document.head.appendChild(sc); });
    return xlsxP;
  }
  async function dlXlsx() {
    const f = S.form, cols = exportCols(f), R = filtered().reverse(), Q = f.questions.filter(q => q.type !== 'statement');
    let X; try { X = await loadXlsx(); } catch (e) { return toast(e.message); }
    const wb = X.utils.book_new();
    const ws = X.utils.aoa_to_sheet([cols.map(c => c.h), ...R.map(r => cols.map(c => c.v(r)))], { cellDates: true });
    ws['!cols'] = cols.map((c, i) => ({ wch: i === 0 ? 18 : Math.min(48, Math.max(12, c.h.length + 2)) }));
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: R.length, c: cols.length - 1 } }) };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    for (let i = 1; i <= R.length; i++) { const a = X.utils.encode_cell({ r: i, c: 0 }); if (ws[a]) ws[a].z = 'yyyy-mm-dd hh:mm'; }
    X.utils.book_append_sheet(wb, ws, 'Respons');
    // Summary: counts per option / score, same denominators as the Ringkasan tab.
    const sum = [['Pertanyaan', 'Jawaban', 'Jumlah', '% dari yang menjawab', 'Yang menjawab']];
    Q.forEach(q => {
      const vals = R.map(r => (r.answers || {})[q.id]).filter(v => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)), k = vals.length, t = q.title || 'Tanpa judul';
      const add = (lab, c) => sum.push([t, lab, c, k ? c / k : 0, k]);
      if (OPT.includes(q.type) || q.type === 'yesno') { const m = new Map(q.options.map(o => [o.label, 0])); vals.forEach(v => (Array.isArray(v) ? v : [v]).forEach(x => { let key = String(x); if (key.startsWith('Lainnya: ')) key = 'Lainnya'; m.set(key, (m.get(key) || 0) + 1); })); m.forEach((c, l) => add(l, c)); }
      else if (['scale', 'rating', 'nps'].includes(q.type)) { const lo = q.type === 'nps' ? 0 : q.type === 'rating' ? 1 : +q.min, hi = q.type === 'nps' ? 10 : +q.max, nums = vals.map(Number); range(lo, hi).forEach(x => add(String(x), nums.filter(v => v === x).length)); sum.push([t, 'Rata-rata', k ? nums.reduce((a, b) => a + b, 0) / k : 0, '', k]); if (q.type === 'nps') { const P = nums.filter(v => v >= 9).length, Dt = nums.filter(v => v <= 6).length; sum.push([t, 'Skor NPS', k ? Math.round((P - Dt) / k * 100) : 0, '', k]); } }
      else if (q.type === 'matrix') q.rows.forEach(row => { const rv = vals.filter(v => v && v[row]); q.cols.forEach(c => { const n = rv.filter(v => v[row] === c).length; sum.push([t + ' — ' + row, c, n, rv.length ? n / rv.length : 0, rv.length]); }); });
      else sum.push([t, '(jawaban teks, lihat sheet Respons)', k, '', k]);
    });
    const ws2 = X.utils.aoa_to_sheet(sum); ws2['!cols'] = [{ wch: 50 }, { wch: 34 }, { wch: 10 }, { wch: 20 }, { wch: 14 }];
    for (let i = 1; i < sum.length; i++) { const a = X.utils.encode_cell({ r: i, c: 3 }); if (ws2[a] && typeof ws2[a].v === 'number') ws2[a].z = '0.0%'; const b = X.utils.encode_cell({ r: i, c: 2 }); if (ws2[b] && sum[i][1] === 'Rata-rata') ws2[b].z = '0.00'; }
    X.utils.book_append_sheet(wb, ws2, 'Ringkasan');
    const info = [['Survei', f.title], ['Periode', (S.from || 'awal') + ' s.d. ' + (S.to || 'sekarang')], ['Jumlah respons', R.length], ['Diunduh', new Date()], ['Oleh', me.name || ''], ['Link', link(f.id)]];
    const ws3 = X.utils.aoa_to_sheet(info, { cellDates: true }); ws3['!cols'] = [{ wch: 18 }, { wch: 70 }]; if (ws3.B4) ws3.B4.z = 'yyyy-mm-dd hh:mm';
    X.utils.book_append_sheet(wb, ws3, 'Info');
    X.writeFile(wb, fileBase() + '.xlsx');
  }

  /* ---------- share ---------- */
  function shareModal(id) {
    const f = (S.form && S.form.id === id) ? S.form : S.forms.find(x => x.id === id); if (!f) return;
    const plain = pageUrl() + '?f=' + id, hk = hiddenKeys(f), withH = plain + hk.map(k => '&' + k + '={' + k.toUpperCase() + '}').join('');
    const wa = 'https://wa.me/?text=' + encodeURIComponent((f.title || 'Survei') + '\n' + plain);
    const embed = `<iframe src="${plain}" width="100%" height="600" style="border:0" title="${(f.title || 'Survei').replace(/"/g, '')}"></iframe>`;
    modal(`<h3>Bagikan survei</h3>${!f.accepting ? '<p class="note">Survei sedang ditutup. Aktifkan "Menerima respons" dulu.</p>' : ''}
      <span class="lab">Link untuk responden</span><div class="cp"><input class="in box2" id="gxs-l1" readonly value="${esc(plain)}"><button class="btn pri" data-a="copy" data-src="gxs-l1">Salin</button></div>
      ${hk.length ? `<span class="lab">Link dengan data pelanggan</span><div class="cp"><input class="in box2" id="gxs-l2" readonly value="${esc(withH)}"><button class="btn" data-a="copy" data-src="gxs-l2">Salin</button></div><p class="mut" style="margin-top:6px">Ganti ${hk.map(k => '{' + k.toUpperCase() + '}').join(', ')} dengan nilai asli per pelanggan, misalnya lewat template pesan WhatsApp atau DotAI.</p>` : ''}
      <div class="bar" style="margin-top:12px"><a class="btn ghost" href="${esc(wa)}" target="_blank" rel="noopener">Kirim via WhatsApp</a><a class="btn ghost" href="${esc(plain)}" target="_blank" rel="noopener">Buka form</a></div>
      <span class="lab">Sematkan di website</span><div class="cp"><input class="in box2" id="gxs-l3" readonly value="${esc(embed)}"><button class="btn ghost" data-a="copy" data-src="gxs-l3">Salin</button></div>
      <div class="mf"><button class="btn ghost" data-a="mclose">Tutup</button></div>`);
  }

  /* ---------- events ---------- */
  function onInput(e) {
    const t = e.target, s = t.dataset.s, k = t.dataset.k; if (!s) return;
    if (s === 'd') { S[k] = t.value; S.ri = 0; renderPane(); return; }
    if (!S.form || !canEdit) return;
    let obj;
    if (s === 'f') obj = S.form;
    else if (s === 'c') obj = S.form.csat || (S.form.csat = {});
    else {
      const q = getQ(t.dataset.id); if (!q) return;
      if (s === 'q') { if (k === 'type') { convertType(q, t.value); cleanRefs(); dirty(); renderPane(); return; } obj = q; }
      else if (s === 'o') obj = q.options[+t.dataset.oi];
    }
    if (!obj || !k) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.num) v = t.value === '' ? '' : Number(t.value);
    obj[k] = v; dirty();
    if (s === 'q' && (k === 'max' || k === 'min')) cleanRefs();
    if (t.dataset.rr) renderPane();
  }
  // Matrix row/column inputs use data-s="r" / "c" with data-oi; handled here (they carry no data-k).
  function onMatrixInput(e) {
    const t = e.target, s = t.dataset.s; if ((s !== 'r' && s !== 'c') || t.dataset.k || !canEdit) return false;
    const q = getQ(t.dataset.id); if (!q) return true;
    (s === 'r' ? q.rows : q.cols)[+t.dataset.oi] = t.value; dirty(); return true;
  }
  async function onClick(e) {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a, id = el.dataset.id, q = getQ(id), qs = S.form && S.form.questions;
    const ed = fn => { if (canEdit) fn(); };
    switch (a) {
      case 'reload': loadList(); break;
      case 'new': createForm(el.dataset.t); break;
      case 'open': openForm(id); break;
      case 'back': await flush(); S.view = 'list'; S.form = null; closeModal(); loadList(); break;
      case 'share': await flush(); shareModal(id); break;
      case 'dup': try { const f = clone(await api('get', { id })); f.id = uid(8); f.title = (f.title || 'Survei') + ' (salinan)'; if (f.csat) f.csat.on = false; f.createdAt = new Date().toISOString(); await api('save', { form: f }); toast('Survei diduplikat (link CSAT dimatikan di salinan)'); loadList(); } catch (err) { toast('Gagal: ' + err.message); } break;
      case 'del': confirmBox('Hapus survei ini beserta semua responsnya dari dashboard? Tab "Jawaban" di Survey DB tetap tersimpan sebagai arsip.', 'Hapus', async () => { await api('delete', { id }); S.forms = S.forms.filter(f => f.id !== id); render(); toast('Survei dihapus'); }); break;
      case 'mok': { const fn = S.pending; S.pending = null; closeModal(); if (fn) try { await fn(); } catch (err) { toast('Gagal: ' + err.message); } break; }
      case 'mclose': closeModal(); break;
      case 'copy': { const src = document.getElementById(el.dataset.src); if (src) copyText(src.value, src); break; }
      case 'preview': await flush(); window.open(pageUrl() + '?f=' + S.form.id + '&preview=1', '_blank', 'noopener'); break;
      case 'tab': S.tab = el.dataset.t; render(); if (S.tab === 'r') loadResp(); break;
      case 'sel': if (S.sel !== id) { S.sel = id; renderPane(); } break;
      case 'addmenu': modal(`<h3>Tambah pertanyaan</h3><div class="types">${Object.keys(TYPES).map(t => `<button data-a="add" data-t="${t}"><span class="ti">${TYPES[t][1]}</span>${TYPES[t][0]}</button>`).join('')}</div><div class="mf"><button class="btn ghost" data-a="mclose">Batal</button></div>`); break;
      case 'add': ed(() => { const nq = newQ(el.dataset.t), at = qs.findIndex(x => x.id === S.sel); qs.splice(at >= 0 ? at + 1 : qs.length, 0, nq); S.sel = nq.id; closeModal(); dirty(); renderPane(); focusQ(nq.id); }); break;
      case 'up': case 'down': ed(() => { const i = qs.findIndex(x => x.id === id), j = i + (a === 'up' ? -1 : 1); if (i < 0 || j < 0 || j >= qs.length) return; [qs[i], qs[j]] = [qs[j], qs[i]]; S.sel = id; dirty(); renderPane(); focusQ(id); }); break;
      case 'dupq': ed(() => { if (!q) return; const c = clone(q); c.id = uid(6); (c.options || []).forEach(o => { o.id = uid(5); }); qs.splice(qs.indexOf(q) + 1, 0, c); S.sel = c.id; dirty(); renderPane(); focusQ(c.id); }); break;
      case 'delq': ed(() => {
        if (!q) return; const i = qs.indexOf(q), snap = clone({ opts: qs.map(x => ({ id: x.id, options: x.options })), csat: S.form.csat });
        qs.splice(i, 1); cleanRefs(); S.sel = qs[Math.min(i, qs.length - 1)] ? qs[Math.min(i, qs.length - 1)].id : null; dirty(); renderPane();
        toast('Pertanyaan dihapus', 'Urungkan', () => { if (!S.form) return; S.form.questions.splice(i, 0, q); snap.opts.forEach(x => { const y = getQ(x.id); if (y && x.options) y.options = x.options; }); S.form.csat = snap.csat; S.sel = q.id; dirty(); if (S.tab === 'q') renderPane(); });
      }); break;
      case 'addopt': ed(() => { if (!q) return; q.options.push(opt('Opsi ' + (q.options.length + 1))); dirty(); renderPane(); setTimeout(() => { const ins = root.querySelectorAll(`#gxs-q-${q.id} .opt .in`), last = ins[q.options.length - 1]; if (last) { last.focus(); last.select(); } }, 30); }); break;
      case 'delopt': ed(() => { if (q && q.options.length > 1) { q.options.splice(+el.dataset.oi, 1); dirty(); renderPane(); } else toast('Minimal satu opsi'); }); break;
      case 'other': ed(() => { if (q) { q.allowOther = true; dirty(); renderPane(); } }); break;
      case 'noother': ed(() => { if (q) { q.allowOther = false; dirty(); renderPane(); } }); break;
      case 'bulk': if (q) modal(`<h3>Tempel banyak opsi</h3><p class="mut">Satu opsi per baris. Daftar ini menggantikan opsi yang ada.</p><textarea class="in box2" id="gxs-bulk" rows="8">${esc(q.options.map(o => o.label).join('\n'))}</textarea><div class="mf"><button class="btn ghost" data-a="mclose">Batal</button><button class="btn pri" data-a="bulkok" data-id="${q.id}">Terapkan</button></div>`); break;
      case 'bulkok': ed(() => { if (!q) return; const lines = document.getElementById('gxs-bulk').value.split('\n').map(s => s.trim()).filter(Boolean); if (!lines.length) return toast('Isi minimal satu opsi'); q.options = lines.map(l => q.options.find(o => o.label === l) || opt(l)); closeModal(); dirty(); renderPane(); }); break;
      case 'addrow': ed(() => { if (q) { q.rows.push('Baris ' + (q.rows.length + 1)); dirty(); renderPane(); } }); break;
      case 'addcol': ed(() => { if (q) { q.cols.push('Kolom ' + (q.cols.length + 1)); dirty(); renderPane(); } }); break;
      case 'delrow': ed(() => { if (q && q.rows.length > 1) { q.rows.splice(+el.dataset.oi, 1); dirty(); renderPane(); } }); break;
      case 'delcol': ed(() => { if (q && q.cols.length > 2) { q.cols.splice(+el.dataset.oi, 1); dirty(); renderPane(); } else toast('Minimal dua kolom'); }); break;
      case 'color': ed(() => { S.form.color = el.dataset.c; dirty(); renderPane(); }); break;
      case 'bg': ed(() => { S.form.bg = el.dataset.t; dirty(); renderPane(); }); break;
      case 'rv': S.rv = el.dataset.t; renderPane(); break;
      case 'ri': S.ri += +el.dataset.d; renderPane(); break;
      case 'clr': S.from = ''; S.to = ''; renderPane(); break;
      case 'refresh': S.respFor = null; renderPane(); loadResp(true); break;
      case 'csv': dlCsv(); break;
      case 'xlsx': el.disabled = true; dlXlsx().finally(() => { el.disabled = false; }); break;
      case 'delresp': confirmBox('Hapus respons ini? Tindakan ini tidak bisa dibatalkan.', 'Hapus', async () => { await api('deleteResponse', { id }); S.resp = S.resp.filter(r => r.id !== id); render(); toast('Respons dihapus'); }); break;
    }
  }
  const inputHandler = e => { if (onMatrixInput(e)) return; onInput(e); };
  root.addEventListener('click', onClick);
  root.addEventListener('input', inputHandler);
  root.addEventListener('change', e => { if (e.target.type === 'color') renderPane(); });
  const onKey = e => { if (e.key === 'Escape' && modalEl) closeModal(); };
  document.addEventListener('keydown', onKey);
  const onUnload = e => { if (S.timer) { saveNow(); e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);

  loadList();
  return {
    destroy() { S.dead = true; if (S.timer) saveNow(); closeModal(); document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); root.remove(); },
  };
}
