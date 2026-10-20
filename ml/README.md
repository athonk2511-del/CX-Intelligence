# Churn risk pipeline (XGBoost)

Predicts, for every live retail account, the probability of **true churn within 60 days**. The dashboard page *Growth & churn → Churn risk* reads the output from Google Drive.

## Setup and run (Google Colab, owner account)

1. Open `ml/run_in_colab.ipynb` in Colab with the Google account that owns the CSV folder.
2. Run the cells. They mount Drive, clone this repo, install `requirements.txt`, set `drive_root`, run the tests and then `python -m ml.churn_pipeline all`.
3. Refresh the dashboard. The page reads the new files through the normal Google sign-in.

Modes:

- `train`: builds snapshots, tunes, evaluates, applies the publish gate, and saves the model and its meta in `Churn Model/models/`.
- `score`: loads the latest **accepted** model, scores today's snapshot, and writes the dashboard files and monitoring.
- `all`: runs `train` and then `score`.

The full run should take well under 15 minutes on free Colab. Everything is vectorised; the only per-account loop is the regex segment classifier.

### Optional: scheduled runs

Use GitHub Actions in a **separate private repo**, with a Google service account that can read and write only the CSV folder. Never schedule this from the public dashboard repo, because Action logs and artifacts are public.

## Drive folder structure

```
<drive_root>/
├─ Tickets/*.csv
├─ Customers/*.csv
├─ Work Orders/*.csv
├─ CSAT/*.csv
└─ Churn Model/                 written by the pipeline, read by the dashboard
   ├─ churn_scores_latest.csv
   ├─ churn_scores_YYYYMMDD.csv (history, never overwritten)
   ├─ churn_segments.csv
   ├─ churn_labels.csv
   ├─ churn_monitoring.csv
   ├─ churn_model_meta.json
   └─ models/                   model JSON, per-version meta, registry.json (not read by the dashboard)
```

## Config (`config.yaml`)

| key | meaning | default |
|---|---|---|
| `label.horizon_days` | prediction horizon | 60 |
| `label.relocation_window` | canonical window for relocation and replacement (days before/after the termination date) | 90 / 60 |
| `label.dashboard_window` | the Retail page rule, reported side by side | 14 / 14 |
| `label.backlog_months` | a termination whose grace ended before this many months back is backlog | 12 |
| `population.non_retail_pattern` | plans excluded from the retail model | Intracity, DIA, Partner ISP |
| `holder.max_key_accounts` | phones and emails shared by more accounts than this are not used as identity | 30 |
| `holder.mega_holder_live` | live accounts that make a mega-holder | 30 |
| `features.ticket_flags` | regex per ticket feature on Category / Problem / Type / Status / Via | see file |
| `features.forbidden` | tickets that never reach features (leakage) | Termination, Dismantle, Deposit Refund, Change Ownership |
| `features.csat` | CSAT column letters; leave null to skip | null |
| `current_value_check.max_tvd` | drop a current-value field when churned vs live distributions differ more than this | 0.45 |
| `model.grid` | hyper-parameter grid | as specified |
| `tiers` | High = top 5%, Medium = next 10% | 5 / 15 |
| `control_share` | % of High-tier accounts held out from outreach | 15 |
| `gate` | publish gate: XGBoost must beat LR on PR-AUC, and recall at top 10% must be ≥ 0.40 | |
| `stale_days` | the page warns when scores are older than this | 14 |
| `segments` | Appendix C keyword lists | |

## Method

- **Termination date:** the later of Grace and Expiration.
- **Classes**, checked in this order:
  1. `change_ownership`
  2. `swap`: a live account of the same name, phone or email at the same coordinate
  3. `relocation`: same identity, a different coordinate, and a start date inside the window
  4. `replacement_other`: any other account of the same identity starting inside the window
  5. `backlog`: grace ended more than 12 months before the scoring date
  6. `true_churn`: everything else
- **Snapshots:** the 1st of each month, needing at least 90 days of ticket history before and a fully observed 60-day outcome after.
  - Population: started before the snapshot, retail only, not excluded by status, and not terminated before the snapshot.
  - Labels: `y = 1` for true churn inside the horizon. Replacements inside the horizon are dropped from that snapshot.
- **Leakage controls:**
  - Termination-category tickets and Dismantle / Deposit Refund / Change Ownership tickets are removed before features are built (asserted in code).
  - Status, Grace, Expiration and Sum Of Price never enter the matrix (asserted).
  - Every event window ends the day before the snapshot.
  - Holder counts are taken as of the snapshot.
- **Model:** XGBoost with `hist` trees and native categorical splits. Native categoricals keep branch, product and segment as one column each instead of sparse one-hot trees. `scale_pos_weight` is either √(neg/pos) or neg/pos, whichever scores the better validation PR-AUC. The grid is chosen on validation PR-AUC, with early stopping after 100 rounds. There is one monotone constraint: `first_cycle` can only lower risk.
- **Split:** train on all snapshots except the last two. Validate on the second-to-last and test on the last. A rolling backtest is also run.
- **Baselines:** L2 logistic regression (median imputation, scaling, one-hot), and the rule score `renewal_within_horizon×2 + Low priority + tenure>90d + no complaint for 90d`.
- **Calibration:** isotonic, fitted on the validation snapshot. Tier churn rates from the test snapshot give the second expected-churn estimate.
- **Explainability:** TreeSHAP contributions from XGBoost (`pred_contribs`). This is the same algorithm as the `shap` package, without the extra dependency at run time.
- **Publish gate:** if it fails, the run is recorded as `rejected` in `models/registry.json`. The previous accepted model keeps scoring, and the page shows a warning.

## How to read the page

- **KPI row:**
  - Accounts scored
  - High-risk count
  - Expected true churn, as Σ calibrated probability, with the tier-rate estimate as a range
  - MRR at risk, as Σ probability × net fee
  - Out-of-time recall at the top 10%, against logistic regression
  - Live accounts that already filed a termination request (handled outside the model)
- **Who is at risk:** the call list. The default order is tier, then days to renewal, then risk. Control-group accounts are marked and must **not** be contacted. Click a row to see the drivers, the tickets, the work orders and the suggested play.
- **Risk by branch and segment:** where the High and Medium accounts sit.
- **Why accounts are at risk:** global drivers, mean |SHAP|. This is predictive association, not cause.
- **When churn happens:** expected churn by days to renewal, and historical true churn by months since activation.
- **From terminations to true churn:** the label bridge per month, with both the 14-day and the 90/60-day windows.
- **Is the model working?:**
  - out-of-time metrics against the baselines
  - calibration
  - live monitoring of past runs, including treated vs control
  - the drift badge
- **Segments:** inferred customer type. Verify before using it for B2B campaigns.

## Model card

| | |
|---|---|
| Purpose | Rank live retail accounts by 60-day true-churn risk so the retention team calls the right customers before renewal |
| Owner | Head of Customer Service & CX, GlobalXtreme |
| Data | Customers, Tickets and Work Orders CSV exports (12 months), plus CSAT only when linkable |
| Label | True churn = a termination that is not a swap, relocation, replacement or backlog, within 60 days of the snapshot |
| Metrics | ROC-AUC, PR-AUC, Brier, and precision / recall / lift at 1/5/10/20%, on the last out-of-time snapshot and on rolling folds. Reference: ROC 0.88, PR-AUC 0.17, recall@10% 61%, base rate 1.2% (Jan–Sep 2026) |
| Limits | Current-value fields (priority, variant, fee, discount, industry). Renewal dates derived from the start date. Mega-holders. Small samples outside Bali. Intracity excluded. CSAT only when linkable |
| Use | Prioritising outreach. It is not a basis for judging individual sales staff, and plays must follow current policy and SLA |
| Privacy | The scores file has CID and UID only. Names are joined in the browser for signed-in viewers. No data, models or keys in this repo |

## Privacy checks

- `.gitignore` excludes CSV, Parquet, pickle and model JSON files.
- `ml/hooks/pre-commit` blocks staged data. Install it with `cp ml/hooks/pre-commit .git/hooks/ && chmod +x .git/hooks/pre-commit`.
- `pytest ml/tests` fails if any data file is tracked under `ml/`.
