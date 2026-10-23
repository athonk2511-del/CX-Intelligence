# Changelog

## 2026-10-23

### Changed

- **IDS planner (`gxdispatch.js`)**
  - A cell with more than 3 open WO (setting `gridMin`), or any urgent VIP, gets its own anchor team. Busy cells are staffed in order of their total job score.
  - 10% of the teams (setting `floatPct`) are kept as floaters for isolated WO. A team sent to a quiet cell only for an urgent VIP becomes a floater afterwards.
  - Anchor teams with hours left take WO from the 8 neighbouring cells only.
  - Every team with hours left picks up WO on the way back to its base: closer to base, at most 30 min extra drive per stop (`homeDetour`).
  - Working-hours rule per team shift: each team has its own shift start and end (Crew settings; default 09:00–17:00). A WO may start up to 60 min before that team's shift end (`lastBefore`) and may finish after it. The planned lunch moves with the shift.
  - Route order: started jobs, urgent VIP (Wiredown, Power), then highest score first (ties: nearest stop), non-urgent VIP after the existing work, then customers who did not answer, then way-back jobs.
  - Job score adds an SLA-overdue booster: +300 once breached, +200 per working day past the SLA.
  - Drive times by car: OSRM route or straight line at 35 km/h, times a traffic factor per zone (tourist centre ×2.0, dense ×1.7, medium ×1.4, open land ×1.2; zones from customer density per cell).
  - Planned lunch of 60 min, 3 h after shift start (12:00 for the 09:00 shift), is taken out of every team day and shown in ETAs.
  - Fixed: reducing the number of teams no longer piles started jobs onto the last team; jobs that can no longer start in time go to H+1.
- **Tracking (`gxtrack.js`):** Test connection works with Traccar tokens (`/api/session` gets the token as a query parameter); pasted tokens are trimmed.
- `index.html`: IDS module version bumped so browsers load the new planner.

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
