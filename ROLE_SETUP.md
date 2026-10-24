# Role management and shared IDS plan: setup

The dashboard is a static page, so the real gatekeeper is the Apps Script proxy. Role management therefore has two halves:

- **Dashboard** (this repository): shows each user only the menus given to them. Dispatchers on an IDS page see the map, the dispatch board and team setup (available teams and crew).
- **Apps Script proxy**: knows which user an access key belongs to, and answers only the sheet tabs that user's menus need. A dispatcher key cannot read CSAT, chat or other tabs, even outside the dashboard.
- **Shared IDS plan**: the proxy also keeps one IDS plan (WWR and WCM) for everyone. A change on one screen shows on every other screen within about 10 seconds.

Until step 1–4 are done, the dashboard keeps working as before: every existing key is treated as the owner (Admin).

## 1. Add the role code to the proxy

Apps Script editor of the proxy → **+** next to Files → **Script** → name it `roles` → paste the whole of `apps-script/roles.gs` from this repository → Save.

## 2. Rename your existing functions

In your existing proxy file, rename only the function names:

- `function doGet(e)` → `function doGetData_(e)`
- `function doPost(e)` → `function doPostData_(e)` (only if you have a doPost, for example from AI_SETUP.md)

Do not change anything inside them. The new `doGet` / `doPost` in `roles.gs` check the user first and then call your original functions.

## 3. Script property GX_DATA_KEY

Project Settings → Script properties → **Add script property**:

- Property: `GX_DATA_KEY`
- Value: one of your existing owner access keys

After the role check, data requests from role-managed users are passed to your original code with this key, so your original key check keeps working unchanged. The key never leaves Apps Script.

`GX_USERS` and `GX_IDS_…` are created by the dashboard. Do not edit them by hand.

## 4. Deploy a new version

Deploy → Manage deployments → edit the current deployment → Version: **New version** → Deploy. Keep "Who has access: Anyone". The URL stays the same.

## 5. Add users

Open the dashboard with your owner key → **Role management** → **+ Add user**:

1. Name, for example `Dispatcher Bali · Andi`.
2. Role: **Dispatcher** (only the ticked menus) or **Admin** (everything, including Role management).
3. Menus: a new dispatcher starts with *IDS · WWR wiredown* and *IDS · WCM maintenance*.
4. **Create user and key**. Copy the key and send it to the user privately. It is shown once.

The user opens the dashboard, types the key once, and sees only their menus. Dispatchers read the sheet through the proxy, so they need no Google sign-in and no access to the Drive folder.

**Disable** stops a key at once, **New key** replaces it, **Remove** deletes the user.

## Good to know

- Owner keys (the keys your original code accepts) are always Admin and are not listed on the page.
- What a user may read is decided per menu: IDS and Customer map read the Customers and Tickets tabs; Tickets is always allowed because every page reads it for the period list. The Tickets tab holds full ticket rows, so a dispatcher key can read ticket data, but not CSAT, chat, FRT/RT, DotAI or human-handled tabs unless those menus are given.
- AI consultant notes are for admins only.

## Shared technician tracking

- The Traccar connection an admin saves on **Tracking setup** is kept on the proxy (`GX_TRACK`) and used by every screen with Customer map or IDS. Only admins can change it.
- An admin browser that already has a live Traccar connection shares it automatically the first time it opens the dashboard after this update.
- The read-only Traccar token reaches the browsers of users with those menus. Use the read-only "dashboard" Traccar user with an expiry date, and generate a new token if it leaks.

## Shared IDS plan

- One plan per work-order type (WWR, WCM) for everyone. Board, H+1, team names, crew, customer confirmations, technician statuses, breaks and problems are shared. Map view preferences (opacity, branch chip) stay per screen.
- Every open IDS screen checks for changes every 10 seconds. The board shows **Shared plan · last change … by …**.
- Two people changing the same thing at the same moment: the first one to arrive is kept. Card moves (drag, Move to, ↑↓) of the second person are re-applied on top automatically; for other changes the second person sees the new version and a short note to redo it if still needed.
- A screen whose work-order data is older than the data the plan was built from reloads its data first, so it never removes new work orders or brings back closed ones.
- The first screen that opens IDS after the update seeds the shared plan from its own browser. After that, every screen starts from the shared plan.
- The change log records who made each change.
- Only users with the IDS menus (and admins) can read or change the plan. Dispatchers can change the number of teams and the crew, not other planner settings.
