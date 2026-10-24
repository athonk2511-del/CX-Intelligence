# Changelog

## 2026-10-24 (tracking for everyone)

### Fixed

- **Technician tracking was set per browser:** the Traccar connection lived only in the admin's browser, so dispatchers saw simulated (demo) technicians. The connection an admin saves on Tracking setup is now kept on the Apps Script proxy and used by every screen with Customer map or IDS. An admin browser that already has a live connection shares it automatically the first time it opens the dashboard.
- Non-admins never see simulated technicians: without a shared live server they see none, with a note.
- IDS map shows a **Technicians** line: live from Traccar (online count), demo, or not set up.

## 2026-10-24 (roles)

### Added

- **Shared IDS plan:** one plan for everyone, kept by the Apps Script proxy (`apps-script/roles.gs`). Board, H+1, team names, crew, confirmations, statuses, breaks and settings are shared; every open screen picks up changes within about 10 seconds. Simultaneous changes are checked per part (settings, branch plan, each work order): the first is kept, card moves of the second are re-applied automatically, other overlapping changes are shown with a note. A screen with older work-order data reloads it before changing the plan. The change log shows who did what.
- **Role management** (new page, admins only): create users with their own access key, role Admin or Dispatcher, and the menus they may open. Disable, new key and remove take effect at once. Needs the Apps Script update in `ROLE_SETUP.md` (`apps-script/roles.gs`); until then every key works as before (owner = Admin).
- The proxy answers only the sheet tabs a user's menus need; AI notes are for admins only.
- Header shows who is signed in, with **Log out**.

### Changed

- **Dispatchers on IDS pages** see the map and the dispatch board only. The settings button becomes **Teams & crew**: number of available teams and the crew (team name, hub, shift, app ID). Other planner settings, KPI tiles, the cell table, the change log and AI notes stay with admins. Dispatchers read the sheet through the proxy (no Google sign-in).
- **Crew**: team names are editable in the crew setup (and still on the board).
- **Defer to H+1**: the column is now first and stays in view while the board scrolls; the board scrolls by itself while a card is dragged near its edge; a search box finds a deferred job by WO, CID, UID or name; **Move to** offers each team's *next stop* (right after jobs already started) or *last stop*.

### Fixed

- The planned lunch showed as "Break … · undefined" on every team; it now reads "Lunch 12:00–13:00 · 60 min · planned".

## 2026-10-24

### Changed

- **Official Bali hubs built in (`gxdispatch.js`):** GX HQ · Jl. Raya Kerobokan (-8.663833, 115.167354, default), GX GWK (-8.808184, 115.163520) and GX Gatsu (-8.634803, 115.249862). Every browser now starts from these hubs. One-time update: a Bali hub list saved earlier in a browser is replaced by these three, and team hub assignments are cleared because hub numbers changed (shifts, names and app IDs stay). Hubs added after the update are kept. Malang is unchanged.
- **IDS hubs (`gxdispatch.js`)**
  - Every team departs from and returns to the default hub (the first one: GlobalXtreme HQ Jl. Raya Kerobokan) unless another hub is assigned to it in Settings → Crew or on the board. There is no automatic hub switching.
  - Busy cells that hold an urgent VIP get the team that reaches them soonest. The other busy cells are matched to teams across the board, shortest drive from each team's own hub first, so hub teams serve the cells near their hub.
  - Teams needed per cell is estimated from the nearest hub that has teams assigned.
  - Removing a hub moves its teams back to the default hub and keeps the other assignments correct. The default hub cannot be removed.
  - Settings: "Bases" renamed "Hubs"; the default hub is labelled.

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
