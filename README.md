# Request Hub

A standalone replacement for the Monday "Request Hub" Vibe app. It does **not**
migrate any data — Monday stays the source of truth. The app writes new requests
directly into your existing Monday boards through a single serverless function
that holds the API token server-side.

## What's in the box

```
request-hub/
├─ api/
│  └─ monday.js        ← the ONLY place the Monday token lives (env var)
├─ public/
│  └─ index.html       ← the whole front end (dashboard + form + tables)
├─ vercel.json         ← lets Monday iframe-embed the app
├─ package.json
└─ .env.example
```

- **Front end** (`public/index.html`): dashboard with 4 KPI cards
  (Active / In Review / In Progress / Completed) + recent-submissions feed; one
  dynamic intake form whose fields change by category; five tracking tables with
  search, status filter, and "load more" pagination.
- **Serverless proxy** (`api/monday.js`): one function, four actions —
  `create-routed-request`, `dashboard-counts`, `recent-submissions`,
  `list-board-items`. The browser calls this function; the function calls Monday.
- The Monday token is read from `process.env.MONDAY_API_TOKEN` and is never sent
  to the browser.

## Routing (category → board)

| Category    | Board                          | Board ID     | Default status |
|-------------|--------------------------------|--------------|----------------|
| Procurement | Procurement Requests           | 18415967514  | New Request    |
| Uniform     | Uniform Requests               | 18415985409  | New Request    |
| Creative    | creative request new           | 18421786819  | New            |
| Print       | Print Requests                 | 18421786829  | New            |

All four boards live in the **Lemonade Hospitality** workspace. The Creative and
Print boards were created fresh for this app; Procurement and Uniform point at
existing boards. All column IDs are wired in `api/monday.js` under the `BOARDS`
map. (The old Event and Design tabs were removed; their Monday boards still
exist but nothing routes to them.)

### Print tab specifics

The Print form is conditional: choosing **Type = Menus** reveals a multi-select
of outlets (Julene breakfast, Julene bar, Citrus Shack, Lovebirds, Sandbar) so
one request can cover several outlets; choosing **Type = Other** reveals a free-
text "what to print" field instead. Quantity is always required. Since there's no
title field, the item name is auto-generated (e.g. `Menus — Citrus Shack, Lovebirds`).

---

## Deploy to Vercel

### Option A — Vercel dashboard (no terminal)

1. Put this folder in a Git repo (GitHub/GitLab/Bitbucket) and push it.
2. Go to https://vercel.com → **Add New… → Project** → import the repo.
3. Framework preset: **Other**. Leave build command empty; output is served as-is
   (static `public/` + `api/` functions). Click **Deploy**.
4. After the first deploy, add the token: **Project → Settings → Environment
   Variables** → add `MONDAY_API_TOKEN` = your token (see below) →
   **Save** → **Redeploy** so the function picks it up.

### Option B — Vercel CLI

```bash
npm i -g vercel
cd request-hub
vercel                       # first deploy (answer the prompts)
vercel env add MONDAY_API_TOKEN   # paste the token when asked; choose Production
vercel --prod                # redeploy to production with the token
```

You'll get a URL like `https://request-hub-xxxx.vercel.app`. That's the app.

### Generating the Monday API token

You do this yourself. In Monday: **your avatar → Developers → My Access Tokens**
(or Admin → API for a service-account token). Copy the token. It needs read +
write access to all five boards. Paste it into the `MONDAY_API_TOKEN` env var in
Vercel. Do not put it anywhere in the code or the repo.

### Quick smoke test after deploy

Open these in a browser (should return JSON, not an error):

- `https://YOUR-URL.vercel.app/api/monday?action=dashboard-counts`
- `https://YOUR-URL.vercel.app/api/monday?action=recent-submissions`

Then open the app root and try submitting a test request; confirm it lands on the
right Monday board, then delete the test item in Monday.

---

## Embed back into Monday

Once deployed, put the app inside Monday using the **native Embed widget** — no
Vibe subscription needed.

**As a dashboard tile:**
1. Open (or create) a dashboard → **Add widget → Embed everything / Embed**
   (also listed as "iFrame" in some accounts).
2. Paste your Vercel URL (`https://YOUR-URL.vercel.app`).
3. Resize the tile. Done.

**As a board view:**
1. On any board, click the **+** next to the view tabs → **Apps → Embed** (or
   "Embed / iFrame").
2. Paste the Vercel URL and save the view.

`vercel.json` already sets `Content-Security-Policy: frame-ancestors 'self'
https://*.monday.com`, so Monday is allowed to frame the app.

---

## Tuning

- **Add/remove form fields:** edit `CATEGORIES` in `public/index.html` (labels,
  types, options) and keep the matching entry in `BOARDS` in `api/monday.js`
  (column ID + `kind`).
- **KPI card buckets:** the boards use different status vocabularies, so
  `api/monday.js` normalizes each status label into Active / In Review /
  In Progress / Completed by keyword in `bucketForStatus()`. Cancelled/Rejected
  are excluded from all cards. Edit the keyword rules there to retune.
- **Account slug for deep links:** `ACCOUNT_SLUG = 'hbcapital'` in
  `api/monday.js` builds the "open in Monday" links.

## Notes / limits

- Attachments/file columns are intentionally not part of the intake form (file
  upload to Monday needs a separate multipart flow). Add later if needed.
- `create-routed-request` uses `create_labels_if_missing: false`, so status /
  dropdown values must already exist on the board (they do, per current setup).
- Dates must be `YYYY-MM-DD` (the form's date input already produces this).
