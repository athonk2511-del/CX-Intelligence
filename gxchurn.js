// GlobalXtreme BI — Churn risk page data. Reads the Drive "Churn Model" set written by ml/churn_pipeline.py
// through the same Google sign-in path as the other CSV sets. Names are joined here, in the browser, from the
// Customers set for signed-in viewers only; they are never written anywhere.
const NUM = new Set(['term_len', 'net_monthly_fee', 'tenure_days', 'days_to_next_renewal', 'mega_holder', 'holder_live_accounts', 'holder_id',
  'prob', 'score_pct', 'expected_mrr_at_risk', 'logit', 'control_group', 'lat', 'lng', 'reason1_shap', 'reason2_shap', 'reason3_shap',
  'drv1_shap', 'drv2_shap', 'drv3_shap', 'drv4_shap', 'drv5_shap', 'drv6_shap', 'accounts', 'expected_churn', 'mrr_at_risk', 'control',
  'n', 'actual_true_churn', 'actual_rate', 'predicted_mean_prob', 'precision_top10', 'recall_top10', 'days_gap', 'tenure_months']);
const FILES = { scores: 'churn_scores_latest.csv', segments: 'churn_segments.csv', monitoring: 'churn_monitoring.csv', labels: 'churn_labels.csv', meta: 'churn_model_meta.json' };
const digits = v => String(v == null ? '' : v).replace(/\D/g, '');

function objects(rows) {
  if (!rows || !rows.length) return [];
  const head = rows[0].map(h => String(h).trim());
  const out = new Array(rows.length - 1);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], o = {};
    for (let j = 0; j < head.length; j++) {
      const k = head[j], v = r[j] == null ? '' : r[j];
      o[k] = NUM.has(k) ? (v === '' ? null : +v) : v;
    }
    out[i - 1] = o;
  }
  return out.filter(o => Object.keys(o).length > 1);
}

let memo = null;
export function clearChurn() { memo = null; }

export async function loadChurnRisk(D) {
  if (memo) return memo;
  const { files, error } = await D.churnFiles();
  if (error) return { empty: true, error };
  const by = n => files.find(f => f.name.toLowerCase() === n);
  if (!by(FILES.meta) && !by(FILES.scores)) return { empty: true, files: files.map(f => f.name) };
  const read = async (n, json) => {
    const f = by(n); if (!f) return null;
    const t = await D.driveFileText(f);
    return json ? JSON.parse(t) : objects(await D.parseCsvText(t));
  };
  const [meta, scores, segments, monitoring, labels] = await Promise.all([
    read(FILES.meta, true), read(FILES.scores), read(FILES.segments), read(FILES.monitoring), read(FILES.labels)]);
  if (!meta) return { empty: true, files: files.map(f => f.name) };
  const snap = meta.snapshot_date ? new Date(meta.snapshot_date + 'T00:00:00') : null;
  const ageDays = snap ? Math.floor((Date.now() - snap.getTime()) / 86400000) : null;
  (scores || []).forEach((r, i) => { r.cid = digits(r.cid); r._i = i; });
  memo = { meta, scores: scores || [], segments: segments || [], monitoring: monitoring || [], labels: labels || [], ageDays, names: null };
  return memo;
}

// Holder and company names by CID, from the already-loaded Customers set (complete set, so it waits for every file).
export async function loadNames(D) {
  const r = await D.gviz(D.TABS.customers, 'select F, A, X', true);
  const m = new Map();
  r.rows.forEach(([cid, name, company]) => { const k = digits(cid); if (k) m.set(k, { name: String(name || ''), company: String(company || '').replace(/^-$/, '') }); });
  return m;
}

// Drawer detail: last 90 days of tickets and work orders for one CID.
export async function loadAccountDetail(D, cid, snapshot) {
  const tail = digits(cid).slice(-6), want = digits(cid);
  const end = snapshot ? new Date(snapshot + 'T00:00:00') : new Date(), start = new Date(end.getTime() - 90 * 86400000);
  const out = { tickets: [], wo: [], account: null };
  const tasks = [
    D.gviz(D.TABS.tickets, `select D, O, P, Q, AD, S, X, F where F contains '${tail}'`).then(r => {
      out.tickets = r.rows.filter(x => digits(x[7]) === want).map(x => ({ date: D.parseAnyDate(x[0]), type: x[1], category: x[2], problem: x[3], status: x[4], created: x[5], solved: x[6] }))
        .filter(t => t.date && t.date >= start).sort((a, b) => b.date - a.date);
    }).catch(e => { out.ticketError = e.message; }),
    D.woQuery(`select B, F, H, Y, L where L contains '${tail}'`).then(r => {
      if (!r) return;
      out.wo = r.rows.filter(x => digits(x[4]) === want).map(x => ({ wo: x[0], status: x[1], created: D.parseAnyDate(x[2]), work: D.parseAnyDate(x[3]) }))
        .filter(w => w.created && w.created >= start).sort((a, b) => b.created - a.created);
    }).catch(e => { out.woError = e.message; }),
    D.loadCustomerDetail(want).then(a => { out.account = a; }).catch(() => {}),
  ];
  await Promise.all(tasks);
  return out;
}

export const PLAYS = {
  FIX_FIRST: { play: 'Technical recovery call', talk: 'Acknowledge the fault history. Check line health. Book a proactive visit or verify the area outage is resolved before talking about renewal.' },
  BILLING_HELP: { play: 'Billing support call', talk: 'Explain the outstanding amount and payment options. Offer grace-period guidance within policy. Make sure invoices reach the right email.' },
  RELOCATE: { play: 'Relocation offer', talk: 'Confirm the move. Offer service transfer to the new address and the relocation process, so it stays a relocation and not a churn.' },
  RENEWAL_CHECKIN: { play: 'Pre-renewal check-in', talk: '7–14 days before renewal. Ask about satisfaction. Remind them of the renewal date and payment channels. Mention longer-term plans if relevant.' },
  RIGHT_SIZE: { play: 'Plan fit review', talk: 'For downgrade or price signals: review usage and offer the right plan instead of losing the account.' },
  ENGAGE: { play: 'Relationship touch', talk: 'For silent accounts: a short WhatsApp check-in, MyGX onboarding, and a reminder of support channels.' },
};

// CSV export of the filtered list, built client-side for signed-in viewers.
export function exportCsv(rows, names, meta) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['rank', 'cid', 'uid', 'name', 'company', 'branch', 'area', 'segment', 'product', 'product_variant', 'net_monthly_fee', 'status_now', 'days_to_next_renewal',
    'risk_pct', 'tier', 'reason1', 'reason2', 'reason3', 'suggested_play', 'control_group'];
  const lines = ['# Churn risk export · snapshot ' + (meta.snapshot_date || '') + ' · model ' + (meta.model_version || '') + ' · exported ' + new Date().toISOString().slice(0, 16).replace('T', ' '), cols.join(',')];
  rows.forEach((r, i) => {
    const n = names && names.get(r.cid) || {};
    lines.push([i + 1, r.cid, r.uid, n.name, n.company, r.branch, r.area, r.segment, r.product, r.product_variant, r.net_monthly_fee, r.status_now, r.days_to_next_renewal,
      r.prob == null ? '' : (r.prob * 100).toFixed(1), r.tier, r.reason1_value, r.reason2_value, r.reason3_value, (PLAYS[r.action_code] || {}).play || r.action_code, r.control_group].map(esc).join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'churn-risk-' + (meta.snapshot_date || 'latest') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
