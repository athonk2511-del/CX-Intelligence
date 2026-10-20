# Changelog

## 2026-10-19

### Added

- **Churn risk (XGBoost)**
  - `ml/` pipeline: labelling, point-in-time snapshots, features, training with baselines, calibration, publish gate, scoring, monitoring and drift.
  - Tests, Colab notebook and model card.
  - New page **Growth & churn → Churn risk**, with a call list, detail drawer, CSV export, drivers, timing, label bridge, model checks, segments, and method & limits.
  - New `gxchurn.js` loader. `gxcsv.js` recognises a Drive subfolder named `Churn Model` as set `churn`.
  - Executive overview: one-line churn-risk summary on the growth card.
- **Data sync:** CSV files load one at a time, newest first, with a progress bar. The open page updates after each file.
- **IDS:** anchor blocks (cell + 8 neighbours, ≥ 4 h of work), floaters, SLA-first ordering (working hours, paused on reschedule), and a 12:00 rebalance.

### Changed

- The proxy fallback retries dropped requests. The map loads in two parallel requests at a time instead of six.
- Module versions bumped.
