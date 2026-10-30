# Changelog

## 2026-10-30 (mass outage location, map, automatic arrival and leaving)

### Added

- **Mass outage location.** The Mass outage form has a **Location** field: paste latitude, longitude from Google Maps (for example `-8.6638, 115.1673`, or a maps link with `@lat,lng` / `q=lat,lng`). Only points in Indonesia are accepted. It can also be added, changed or removed later on the outage card.
- **On the IDS map:** a red **!** marker ringed in the team colour, with a dashed circle for the outage area. The tooltip shows team, note, time range and status (on the way · arrives about 11:41 / handling since 11:45 · until 17:45 / should be there, no arrival yet / done). The live technician trackers on the same map show where the team in charge is. **Locate** on the card moves the map to the outage. The card also shows how far the team's tracker is from it.
- **Drive times to and from the outage are counted.** The team drives from the WO it finishes first (else the last WO it checked in at, else its hub); handling starts on arrival and lasts the handling time; the next WO's ETA is the outage end plus the drive **from the outage** to that WO. Without a location, nothing changes from before.
- **Automatic arrival and leaving** (Settings → Outage area, **300 m** by default, wider than a WO because an outage is a cable route / ODP / poles):
  - **Arrived**: the team's tracker is parked inside the area, after the WO it had to finish.
  - **Left**: two positions in a row outside the area, driving (or moving away in slow traffic), at least the Auto check-out minimum time after arrival. The leaving time is worked back from the first position outside. GPS jumps are ignored.
  - **Back on site**: parked inside the area again within the Back on site time: leaving undone, "Back at the outage since …" on the card. Not when the team has checked in at a WO since.
  - **Arrived** and **Left** are also hh:mm boxes on the card for the dispatcher (AUTO mark when set by the tracker). End now still ends the outage by hand.
- `index.html`: IDS and map module versions bumped so browsers load the new files.


## 2026-10-30 (mass outage handling)

### Added

- **Mass outage** button on every team, next to Break and Problem (board and list). A dispatcher sends the team to a mass outage (gangguan massal): called-at time (default now), handling time (default **6 h**, Settings → Mass outage, 0.5 to 12 h) and an optional area / ODP / ticket note (60 characters).
  - **A team on site finishes its WO first.** When the team is checked in at a WO (not checked out), the outage starts at that WO's check-out, or at its projected finish (with breaks inside it, never before now) until then. The card says "goes after finishing WWR-… (about 14:00)".
  - **A team on the way leaves its trip.** Jobs the team was driving to go back to Not started.
  - **The route shows a red striped MASS OUTAGE HANDLING card** (board) or row (list) after the job on site, with the note, time range, status ("handling now · until 20:00"), who sent the team, and the handling time, which can be changed on the card. **End now** ends it early; **Cancel** removes it before it starts. The team header shows Cancel / End mass outage.
  - **ETAs follow the existing formula:** every job not started yet comes after the outage: outage end + drive, then work time, breaks and the next drives as before. The planned lunch inside the outage is not added again. Nothing is reassigned by itself; the card counts the WO that now start after the team's last-start time and offers **Defer them to H+1** (internal reason, aging +200 tomorrow). A check-out of the team later recalculates the plan as usual.
  - Shared with every screen and recorded in the change log. One mass outage per team at a time.
- The drive after an outage is counted from the team's previous stop (the outage location is not on the map).
- `index.html`: IDS module version bumped so browsers load the new planner.


## 2026-10-30 (keep last night's plan)

### Fixed

- **Morning asked for a re-plan of a plan made the evening before.** When dispatchers arranged tomorrow's work on that day's board (without pressing Prepare plan first), the plan stayed dated that day. The next morning the board only offered Make today's plan, which built the routes again from scratch, so the order sent to the field changed.

### Added

- **"Yes: keep this plan for today (same order)"** on the morning card when the last plan is from an earlier day. The plan becomes today's plan with the same teams and the same order, no re-plan:
  - work orders checked out on that day are taken out (and not brought back while the data still lists them as open);
  - jobs started or checked in on that day but not finished get aging +200 (they slipped a day); jobs nobody touched keep their score;
  - customer confirmations, notes and hand moves stay; technician statuses, check-in/out times and breaks of that day are cleared;
  - closed work orders drop out and new ones join the end of a fitting route, as on any morning.
- **"No: make a new plan for today"** needs two clicks now (red "Click again: make a new plan (order will change)"), so the order sent to the field is not replaced by accident.
- **Evening reminder:** from 30 minutes before the last shift end, the Plan row shows "Planning tomorrow? Press Prepare plan first: this board is today's plan."
- Plans carry the planner version that made them (`2026-10-30a`), to tell from the shared plan which screens are up to date.
- `index.html`: IDS module version bumped so browsers load the new planner.


## 2026-10-29 (back on site, GPS jumps)

### Added

- **Back on site** (Settings → Back on site, 60 min by default): a WO checked out automatically goes back to **Checked in** when the technician is back and parked at the same WO within that time: two positions in a row inside the check-out radius (150 m), or one inside the check-in radius (50 m). The check-in time stays. The card warns "Back on site since 12:40 after leaving 12:27 (tracker 30 m away): check for a problem", and the change log records it. Once the technician really leaves, the job is checked out again by the usual rule with the new leaving time, and the card keeps "Left at 12:27, came back 12:40, then finished".
  - Not undone when the team has already checked in at another WO since (it moved on and only drove past), after a dispatcher set the status by hand (the dispatcher has taken over), or more than 3 times for one WO in a day.

### Changed

- **Automatic check-out needs two positions in a row outside the radius.** One stray GPS position never checks a job out. The leaving time is still taken from the first position outside, so the recorded time is not delayed.
- **GPS jumps are ignored** by automatic check-in, check-out and back on site: a position more than 300 m from the last good one at an implied speed above 130 km/h. Two jumpy positions that agree with each other count as a real move.
- `index.html`: IDS module version bumped so browsers load the new planner.


## 2026-10-29 (check-in/out times, breaks, notes, map list, automatic check-out)

### Added

- **Check-in and check-out as separate times.** A job shows when the technician arrived (check-in) and when he left (check-out), each in its own hh:mm box. The list has its own **Check-in** and **Check-out** columns; a board card shows both boxes. The check-in time stays after the check-out, and the card shows the time on site ("73 min on site"). A check-out without a check-in time is flagged "Check-in time missing". Rules: not later than now, not before the shift start, check-out not before check-in. Viewers see both times.
- **Breaks with a start time.** **Break** on a team now asks for the start time (prefilled with now); the break lasts the break length (Settings → Breaks, 60 min by default) from that start, and the box shows when the team is back. The break appears in the team's route as a striped **BREAK** card (board) or row (list) between the jobs before and after it, with "resting now · back 12:10" or "starts in 5 min". **End break** ends it early; a break set for later can be cancelled before it starts. Overlapping breaks are refused. ETAs after the break move back by its length.
- **Note on every work order.** **+ Note** on a card or list row; up to 140 characters, so it is always shown in full (about four lines on a card, under the customer in the list). Shared with every screen (dispatchers and viewers) with who wrote it and when; click the note to change it, empty it to remove it. A note stays with the WO until the WO is closed.
- **Automatic check-out** (Settings → Auto check-out), following the geofence-exit approach of field-service tools: a checked-in WO is checked out when its team's tracker (position at most 10 min old) is more than **150 m** away and driving (**10 km/h** or faster, or two positions in a row moving away, for slow traffic), at least **10 min** after the check-in. The exit radius is three times the 50 m check-in radius, so GPS drift while working never checks a job out. The check-out time is when the technician left: the first position outside minus the drive at the measured speed, or halfway from the last position on site when the speed says nothing. Marked AUTO with the tracker, distance and speed. Setting the job back to Checked in (technician returned) switches it off for that WO for the day. 0 m = off.

### Changed

- **Map list:** the row of team chips under the map is now one **Teams on map** button (colour dots, "4 of 4 · H+1, live technicians"). It opens a compact list of teams with job counts, All teams / No teams, H+1 jobs and Live technicians in one place, and folds away again (remembered per screen).
- **List layout** made narrower to fit the new columns: ETA and drive show on two lines, job type and hours on two lines, slightly tighter cells. The table fits 1366 px screens and wider without side scrolling.

### Fixed

- **Breaks inside a job with real times.** A break or problem that fell inside a job that was checked in or out was not counted again from the real times: the job kept its old finish, the jobs after it ignored the break, and a checked-out card could show "ETA +60 min: break". The timeline now recounts breaks from the real check-in and check-out times.

- `index.html`: IDS module version bumped so browsers load the new planner.


## 2026-10-29 (plan prepared the evening before)

### Fixed

- **IDS re-planned itself every morning.** A plan belonged to the calendar day the screen was opened. A plan made in the evening was dated that evening, so the first screen opened after midnight treated it as yesterday's plan: it threw the plan away and planned again from scratch. On top of that, every job in it got aging +200 (as if it had not been done the day before) and customer confirmations, statuses and check-in/out times were cleared. The order sent to the field the night before was lost.

### Changed

- **A plan now belongs to the working day it is made for.** A new day never replaces a plan by itself. The board changes only on Re-plan automatically, Rebalance now, a planning-setting Save, or the new Prepare plan button.
- **Prepare plan for [date]** (Plan row, dispatchers and admins; date defaults to tomorrow, can be set later, e.g. Monday after a day off). Two clicks: the button turns red, "Click again: close today, plan …".
  - Closes today's plan: jobs not done carry over with aging (internal reason), today's statuses, check-in/out times and customer confirmations are cleared. This is the same day-end step as before, now at the moment the dispatcher chooses.
  - Makes the plan for that day. Work orders checked out today are left out, even when the data still lists them as open.
  - Customer confirmations and hand moves made on the prepared plan in the evening are kept the next morning.
  - New work orders uploaded later are added at the end of a fitting team's route or to H+1, as during the day; the existing order is not changed.
- **A plan prepared ahead** shows its own date on the Plan row with "Prepared ahead · kept as it is until Re-plan". Technician statuses, check-out times, breaks and problems can be entered from its own day.
- **No plan prepared for today** (the last plan is from an earlier day): the board shows a note and **Make today's plan** instead of planning by itself. Viewers see the note until a dispatcher makes the plan. The very first plan of a branch is still made by itself.
- `index.html`: IDS module version bumped so browsers load the new planner.

**Recommended evening routine:** upload the work-order data first, then press Prepare plan, then follow up customers and adjust the board.

## 2026-10-27 (list layout)

### Added

- **Dispatch board · List layout:** a Google-Drive-style switch above the board (☰ list / ▦ board) chooses between the kanban board and a list. The choice is remembered per screen; the board stays the default.
- **The list** is one table with a section per team and an H+1 section (can be hidden) at the end.
  - Each team header shows its name (editable), jobs, work, drive, km, finish, hub, shift, tracker and Break / Problem.
  - Each job is a row: route number, WO, UID · CID, customer, area and problem with the card notes (ETA warnings, lunch, nearby, check-in/out), job type and work time, urgency colour, tier and score, ETA, drive, customer status, technician status with the check-out box, ↑ ↓, Move to and Locate.
  - Rows can be dragged to another position or onto another team's header. The nearby suggestion with **Move next** shows in the row.
  - Viewers get the same list read only.

## 2026-10-27 (map marks, editable job types)

### Changed

- **IDS map:** the status rings of the previous update are removed (too heavy on the map), together with the *Map ring* legend. Job boxes now change only in two cases:
  - **Checked out:** grey box at 20 % opacity with a green ✓, drawn under the other jobs.
  - **Visited, customer asks to reschedule:** a job checked in or checked out whose customer asks to reschedule turns yellow with a ↻ mark. Such a job stays in its route; it is not moved to H+1.
  - Both are explained on the *Legend* row. The tooltip of every box shows the technician status and the customer answer.
  - H+1 points are back to the orange ring for every reason.

### Added

- **Settings → Job types:** the fixed *Duration* row is replaced by an editable list, separate for IDS WWR and IDS WCM.
  - Each type has a name, work time (min), priority level (Critical +500, High +400, Medium +300, Low +100 to the job score; Critical and High VIP are worked first) and the words that recognise it in the WO category or problem text.
  - Types can be added (**+ Add job type**), removed and moved up or down. The first type whose words match is used.
  - *Other (no word matched)* is always last, and its work time and priority can be changed.
  - Starts from the current types, with any work times saved earlier. Saving a change re-plans the board, like other planning settings.

## 2026-10-27 (status rings on the map)

### Added

- **IDS map · status ring:** a job's numbered box gets a white gap and a thick coloured ring by its status, so the map shows at a glance where each job stands. The team colour stays inside.

  | Ring | Status |
  |---|---|
  | Green + ✓ | Checked out |
  | Amber | Checked in, or In Progress in the data |
  | Blue | On the way |
  | Red | Customer asks to reschedule |
  | Purple | Customer did not answer |
  | Black | Customer confirmed |
  | None (thin dark border) | Not started, not contacted |

  The technician status wins over the customer answer.
- H+1 points deferred at the customer's request get a thick red ring; internal deferrals keep the orange ring.
- The status also appears in the tooltip of each box. A **Map ring** legend row is shown on the board.

## 2026-10-26 (trackers per team, automatic check-in)

### Added

- **Tracker per team** (Teams & crew):
  - The *App ID* box is now **Tracker**: a list of the live Traccar devices ("Tracker A (68095456) · online"), or "No tracker". A tracker picked for two teams is marked. When tracking is not live, the identifier can still be typed.
  - Assigning trackers or naming teams (e.g. "Jenius Zega") does not re-plan.
  - Each team column shows its tracker and state ("tracker Tracker A · online 2 min ago" or "no tracker").
  - On the IDS map a team's tracker is filled with the team colour and carries the team name as a tag, matching its route line and job numbers. Hiding a team on the map hides its tracker too.
- **Automatic check-in** (Settings → Auto check-in, default 50 m):
  - When a team's tracker is within the radius of a job of that team's route that is *Not started* or *On the way*, the job becomes **Checked in** at the tracker's fix time.
  - The tracker must be parked: 5 km/h or slower, or two positions in a row inside the radius. A drive-by does not count.
  - Positions older than 10 minutes are ignored, and simulated (demo) technicians never check in.
  - The card shows "Checked in 10:39 · automatic, tracker Tracker A 30 m away". The change log records it.
  - A dispatcher can always change the status. When a job is set back by hand, it is not checked in automatically again that day.
- The check-in time (automatic, or set by hand with *Checked in*) is now used for the ETA: the job ends at check-in + its work time, or later if it is still running.

## 2026-10-26 (viewer role)

### Added

- **Role management · Viewer:** a read-only role.
  - On IDS pages a viewer sees the map and the board (ETAs, card colours, customer and technician status, check-out times, nearby labels), with a **View only** badge. It follows every change of the dispatchers within about 10 seconds.
  - No drag, Move to, ↑↓, status or confirmation selects, check-out box, Break/Problem, team-name editing, hub selects, Re-plan, Tidy, Rebalance, Teams & crew or Settings.
  - A viewer screen never builds or changes a plan. Without a plan for today it shows "No plan for today yet".
  - The proxy refuses plan, tracking and AI changes from a viewer key.
  - Role management counts viewers separately; the header shows "Name · Viewer".
- Needs the new `apps-script/roles.gs` (paste and deploy a new version).

## 2026-10-26 (no surprise re-plans)

### Changed

- **The IDS board is re-planned only when someone chooses it.** A dispatcher's schedule no longer changes by itself. Re-plans happen only on:
  - **Save** in Settings / Teams & crew, when a planning setting changed;
  - **Re-plan automatically**;
  - **Rebalance now**;
  - the first plan of a new day.
- **Save** re-plans only when a planning setting changed (teams, hubs, shifts, durations, SLA, …). Saving team names or app IDs keeps the board as it is.
  - When the plan has manual changes, the first click shows "These settings re-plan the board and replace N manual changes", and the button turns red: **Click again: save and re-plan**.
  - The change log records who re-planned.
- **12:00 rebalance** is now an offer on the board (**Rebalance now** / **Keep current plan**), never automatic.
- **Check-out** no longer re-runs the whole plan. The order of every route is kept. Only jobs that can no longer start in time move to another team (at the end) or to H+1, and a team that finishes early takes work from H+1 at the end of its route.
- **Road drive times** arriving after the plan was made update the ETAs only. A brand-new plan that nobody has touched yet (first 3 minutes) is still re-run with them.

### Fixed

- Opening Settings without changing anything no longer shows "Unsaved changes" (the hub list of the branch counted as a change). Drafts kept by the previous version are dropped once.

## 2026-10-25 (save settings)

### Added

- **IDS settings · Save:** a **Save** button at the top and the bottom of Settings (admins) and Teams & crew (dispatchers). It replaces "Apply and re-plan"; Cancel is now **Discard changes** / **Close**.
- Typed changes are kept in the browser until they are saved or discarded. Closing the panel, the tab or the dashboard no longer loses them. On return an **Unsaved settings changes · Save · Discard** bar appears next to the Settings button.
- After saving, the status reads **Settings saved for everyone · hh:mm** once the shared plan has them. It shows why if they could not be shared (offline, proxy not updated).

### Fixed

- Saving sends only the fields changed in the panel, on top of the latest shared settings, so an admin save no longer undoes a dispatcher's team or crew change made meanwhile (and the other way round).
- Shared settings are compared in one canonical form (defaults filled in, keys sorted). A setting added in a newer version, or a different key order, no longer counts as a change, so screens no longer re-send the settings when they open.

## 2026-10-25 (nearby first, card colours)

### Added

- **IDS · Nearby first** (Settings → Nearby):
  - After each job, a job not yet started within **500 m** (`nearM`) is done next, so the technician does not drive away and come back.
  - Safeguards: no job may miss its SLA because of it, urgent VIP (Wiredown / Power) are never delayed, every job that fitted the working day still fits, and a job with a higher score waits at most **60 min** more (`nearDelay`).
  - The card says "Nearby: 268 m from the previous stop". The team line shows what it saves, for example "nearby first saves 29 min · 9.8 km".
  - Applied on every automatic plan, re-plan, 12:00 rebalance, check-out recalculation and Tidy route. Set 0 m to switch it off.
- **Suggestions for plans changed by hand:**
  - Nothing is reordered automatically. The card of a nearby job asks "WWR… is 268 m away. Do this job right after it?", with the delay it causes to a higher-priority job, and a **Move next** button.
  - Suggestions keep the SLA and urgent-VIP safeguards, but not the 60 min limit: the dispatcher decides.
- **Card colours by urgency** (legend on the board):

  | Colour | Label | Meaning |
  |---|---|---|
  | Red | Act now | SLA breached, will miss its SLA on this route, or urgent VIP |
  | Orange | Due soon | SLA due within the near-breach hours (default 3 h) |
  | Yellow | Due today | SLA due before the end of today's working hours |
  | Green | Due tomorrow | SLA due during the next working day |
  | Blue | Safe · negotiable | SLA due later: can be rescheduled with the customer |

  Checked-out jobs are grey.

## 2026-10-25 (check-out time)

### Added

- **IDS · Check-out time:** setting a job to *Checked out* shows a **Check-out** box (hh:mm, prefilled with the current time) for the dispatcher to type the real time. It must lie between the team's shift start and now.
- Every check-out change recalculates the plan at once, not only at the 12:00 rebalance:
  - The job shows its actual finish ("Checked out 11:30, 26 min later than projected"). The ETAs after it, the team's working time and its finish move with it.
  - Plans without manual changes are re-run in full (like the 12:00 rebalance; started and checked-out jobs stay with their team).
  - Plans with manual changes keep each team's order. Jobs that no longer fit move to another team or H+1. A team that finishes earlier takes more work from H+1 (internal reason only; jobs deferred by hand or at the customer's request stay).
  - The change log says what moved, for example "Team 1 +1, H+1 −1".
- A job *Checked in* (or In Progress) that runs past its projected finish now pushes the next ETAs back automatically; a job *On the way* cannot arrive before now. The card shows "Still working: … min past the projected finish".
- Started jobs are ordered as they really happened: checked out (by check-out time), then the job in progress, then the one the team is driving to.
- The check-out time is part of the shared plan and resets at the start of the next day. Changing the status away from Checked out removes the time.

## 2026-10-25 (work orders for dispatchers)

### Fixed

- **WWR / WCM work orders missing on IDS:** dispatchers read work orders from the old Google Sheet while admins read the Drive CSV files. The two screens disagreed, and the shared plan dropped work orders the sheet did not have, for everyone. Dispatchers now read the same Drive CSV files (work orders and customers) through the Apps Script proxy, without Google sign-in. Needs the new `apps-script/roles.gs` (see ROLE_SETUP.md, step 4: authorize Drive access).
- Work orders removed by that mismatch come back automatically the first time an updated screen opens IDS (one-time repair of the shared plan).
- A screen that cannot read the work-order files (proxy not updated, Drive error) no longer plans from partial data: the IDS board is hidden with the reason, and the shared plan is left unchanged.

### Changed

- The proxy gives each user only the CSV data sets their menus need (IDS and Customer map: customers and work orders).

## 2026-10-24 (map toggles)

### Added

- **IDS map · Show on map:** a checkbox per team (route, jobs and its live technician), All / None, H+1 rings and Live technicians. Remembered per screen; does not change the shared plan.
- Live technicians are linked to a team when the crew **App ID** equals the Traccar device identifier (or the device name equals the team name); the marker label shows the team.
- **Tracking setup · Shared with every user:** shows whether the Traccar connection is shared, why not, and a **Share this connection with everyone** button.

### Fixed

- Sharing the Traccar connection no longer fails silently: admins see the reason on the IDS Technicians line and on Tracking setup; dispatchers see why tracking is unavailable.
- Route lines of teams that leave from GX GWK or GX Gatsu were never drawn (looked up with the default hub).

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
