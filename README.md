# GroupHub

GroupHub is a moderated directory of **WhatsApp and Telegram group invite links**. Visitors browse approved groups by platform, category, country and language. Anyone can submit a group, but it stays **pending** until a moderator approves it in the admin panel at `/admin`.

## Features
- **Public site** (`/`): platform tabs, category chips, search, filters, Load more, featured groups pinned first, a report button on every card, and a submit form that checks invite links as you type.
- **Admin panel** (`/admin`): password login, stats, and Pending / Approved / Reported / Rejected tabs. Moderators can approve, reject, edit, delete, feature or unfeature groups, view reports and clear them.
- **Security:**
  - Invite links are validated on the server.
  - All user content is escaped when shown.
  - Strict Content-Security-Policy.
  - httpOnly + SameSite=Strict session cookie, with a CSRF token on admin actions.
  - Login is rate-limited and passwords are hashed with scrypt.
  - Submissions and reports are rate-limited.
  - Only `public/` is web-accessible.
- **Adult (18+) category:** hidden from the default listing and from "All categories". The API only returns these groups with `?includeAdult=1`, which the site requests after the visitor passes an 18+ age gate (remembered in `localStorage`). Cards show an 18+ badge, and the submit form explains the rules (no minors, no non-consensual or illegal content; every listing is reviewed).
- **Storage:** PostgreSQL (e.g. Supabase) when `DATABASE_URL` is set. Tables are created automatically on startup (SQL in `db/schema.sql`). Without `DATABASE_URL`, data goes to a JSON file (`data/grouphub.json`). With `SEED_SAMPLES=1`, an empty database gets 15 **sample** groups that use fake invite codes.

## Requirements
Node.js 18 or newer.

## Setup
```bash
npm install
cp .env.example .env          # then edit .env
```

### Set the admin password
Pick one option:

1. **Plain password** (simplest). In `.env`, set `ADMIN_PASSWORD=<at least 10 characters>`. The server hashes it in memory at startup.
2. **Pre-hashed** (recommended for production). Generate a hash, then set `ADMIN_PASSWORD_HASH` instead of `ADMIN_PASSWORD`:
   ```bash
   npm run hash-password -- "your long random password"
   # → scrypt$<salt>$<hash>   put this in ADMIN_PASSWORD_HASH
   ```

If neither is set, or the password is shorter than 10 characters, admin login stays disabled.

## Run
```bash
# load .env and start (or use your host's env settings)
set -a; . ./.env; set +a
npm start
# site:  http://localhost:8000
# admin: http://localhost:8000/admin
```
Use `npm run dev` to auto-restart while editing.

## Environment variables
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | – | Admin login (see above) |
| `NODE_ENV` | – | Set to `production` behind HTTPS (adds the Secure cookie flag and HSTS) |
| `TRUST_PROXY` | – | Set to `1` behind one reverse proxy so rate limits see real client IPs |
| `DATABASE_URL` | – | Postgres connection string. When set, Postgres is used instead of the JSON file. SSL is on (`rejectUnauthorized: false`, as Supabase's pooler needs). |
| `DATABASE_SSL` | – | Set to `disable` only for a local Postgres without SSL |
| `DATABASE_POOL_MAX` | `5` | Max Postgres connections |
| `DB_FILE` | `data/grouphub.json` | JSON database file (used only when `DATABASE_URL` is unset) |
| `SEED_SAMPLES` | – | `1` = insert 15 sample groups if the database is empty |
| `STATS_TZ` | `Asia/Kolkata` | Time zone for the daily traffic stats in the admin panel |
| `IP_HASH_SALT` | random per start | Salt for hashing submitter/reporter IPs; set it so report de-duplication survives restarts |

## Traffic stats (admin → Traffic)
First-party and privacy-friendly: no cookies, no third-party analytics. `public/beacon.js` (homepage and group pages only) sends one page view per load to `POST /api/collect`, plus a heartbeat every 60s while the tab is visible.
- **Not counted:** `/admin`, `/api`, static files, `/healthz` (UptimeRobot), `robots.txt`, `sitemap.xml`, `sw.js`, 404 pages, bots (by user-agent) and automated browsers.
- **Visitors:** the browser keeps a random ID in localStorage, or the server falls back to IP + user-agent if storage is blocked. Only a salted HMAC of that ID is stored, and the salt rotates daily, so raw IPs and IDs are never saved. Each visitor counts once per day. All-time visitors = first-ever visits.
- **Online now:** distinct visitors seen in the last 5 minutes. Kept in memory only, so it resets on restart.
- **Storage:** hits are buffered and flushed about once a minute (and on shutdown) into `stats_daily`, `stats_visitors` and `stats_pages`. Per-day hashes and page counts are pruned after 90 days; daily totals are kept.

## Project layout
```
server.js            Express app: public API, admin auth + API, security headers
lib/validate.js      Invite-link and field validation (allow-lists)
lib/store.js         JSON-file storage with atomic writes (fallback)
lib/pg-store.js      PostgreSQL storage (used when DATABASE_URL is set)
lib/seed.js          Sample groups (SEED_SAMPLES=1)
lib/spam.js          Spam words/rules used by auto-approve (edit freely)
lib/render.js        Server-side homepage, group pages, 404 + sitemap.xml
views/group.html     Group page template (header/footer/styles come from public/grouphub.html)
public/card-render.js Card markup shared by server and browser
lib/avatar.js        Fetches group profile pictures (allowlisted hosts only)
test/                Unit tests (npm test) with saved sample pages
db/schema.sql        Postgres tables (run automatically; can also be pasted into Supabase)
render.yaml          Render Blueprint
lib/hash-password.js Helper for ADMIN_PASSWORD_HASH
public/              Public site (grouphub.html, grouphub.js, group.js, favicon.svg)
admin/views/         Login and dashboard pages (served only by /admin)
admin/assets/        Admin CSS/JS
data/                Database (git-ignored)
```

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/groups` | – | Approved groups, featured first (Adult only with `?includeAdult=1`) |
| POST | `/api/groups` | – | Submit a group (status becomes `pending`; 10 per hour per IP) |
| POST | `/api/groups/:id/report` | – | Report an approved group (20 per hour per IP) |
| GET | `/api/meta` | – | Allowed categories, countries, languages, report reasons |
| POST | `/admin/login`, `/admin/logout` | – | Session login (5 failed attempts per 15 minutes per IP) |
| GET | `/api/admin/stats`, `/api/admin/groups?status=pending\|approved\|reported\|rejected` | admin | Dashboard data |
| PATCH / DELETE | `/api/admin/groups/:id` | admin + CSRF | Edit, change status, feature, or delete a group |
| POST | `/api/admin/groups/:id/clear-reports` | admin + CSRF | Clear a group's reports |

## Notes and limits
- Admin sessions and rate limits are kept in memory. That's fine for a single instance (like Render's free plan), but a restart or sleep/wake logs admins out and resets rate limits. To run more than one instance, move sessions and rate limits to Redis or Postgres.
- **Auto-approve (admin top bar switch, default OFF):** when ON, a new submission that passes validation goes live immediately, and its picture is fetched in the background.
  - **Exceptions:** **Adult** groups always wait in Pending. So do submissions that trip the spam check in `lib/spam.js` (editable list of words such as forex, signals, earn daily, investment, loan, betting, casino, 100% profit; links in the description; too many emojis; mostly capital letters). The Pending row shows why it was held.
  - **Review:** auto-approved groups get an **⚡ Auto** tag. Approved → **Auto-approved only** lists them, and **✓ Mark reviewed** clears the tag.
  - **Storage:** the setting lives in the database (Postgres `settings` table, or the JSON file), so it survives restarts.
  - Rate limits, duplicate checks and link validation are unchanged.
- **Group pictures:** when an admin approves a group, the server fetches the group's profile picture in the background. Approval never waits for it.
  - **Sources:** WhatsApp and Telegram pictures come from the invite page's `og:image`. Discord pictures come from the invite API (`discord.gg/…` links).
  - **Storage:** the picture is resized to a 256×256 WebP with `sharp` (an optional dependency). Without sharp, originals up to 300 KB are kept as-is. Pictures are stored in Postgres (`group_images` table) or `data/images/` (JSON store), because platform image URLs expire. They're served from `/img/group/<id>?v=<version>` with a one-year cache and an ETag.
  - **No picture:** if there isn't one (or the fetch fails), the card shows a coloured letter avatar. The admin row shows why.
  - **Admin controls:** each approved row has **🖼 Refresh picture**. **🖼 Fetch missing pictures** in the top bar backfills every approved group that has no picture yet.
  - **Safety:** the fetcher only requests https URLs on fixed hosts:
    - Pages and APIs: `chat.whatsapp.com`, `t.me`, `telegram.me`, `discord.com`
    - Images: `pps.whatsapp.net`, `cdn*.telesco.pe`, `telegram.org`, `cdn.discordapp.com`
    It also follows at most 3 re-checked redirects, times out after 8 s, caps images at 2 MB and only accepts JPEG/PNG/WebP/GIF.
  - **Limitations:** WhatsApp only shows the picture for valid invites of groups that have one. Revoked invites and many Community invites show a generic image, which we skip. Telegram shows nothing for private or invalid invites, and its default logo is skipped. Platforms can change their pages or rate-limit at any time.
- **SEO:**
  - **Server-rendered homepage:** `GET /` is rendered on the server (`lib/render.js`) with the first page of WhatsApp cards, the hero stats and a "Recently added" list of up to 60 real approved groups (no Adult, no samples). All of it is escaped HTML, so crawlers see content without running JS; the browser JS then takes over with the same card markup (`public/card-render.js`). The page is cached for 60 s and the cache is cleared on any group change.
  - **Group pages:** every approved group has its own page at `/group/<slug>-<id>` (slug from the name, id is stable). Wrong or old slugs (for example after a rename) 301 to the current URL; `/group/<id>` works too. Pending, rejected and unknown groups get a 404 page. Each page has its own title, description, canonical, Open Graph image (the group picture when there is one) and a BreadcrumbList. Adult groups get `noindex` and the 18+ gate; sample groups get `noindex`. Homepage card titles and **Join** buttons link to these pages, and old `/#group/<id>` links redirect to them. Admin rows have **↗ View page**. Pages are cached for 60 s and cleared on any change.
  - **Other files:** `/sitemap.xml` lists the homepage plus every approved, non-Adult, non-sample group page with `lastmod`. It is cached for 60 s and cleared on any change. `/robots.txt` blocks `/admin` and `/api/`.
  - **Structured data:** JSON-LD for WebSite (with a `?q=` SearchAction, which the page supports) and Organization (opaque logo `icon-512.png`).
  - **Redirect:** `/grouphub.html` 301-redirects to `/`.
- **Ads (Monetag):** public pages (`/`, group pages, the group 404 page) load `public/monetag.js` first in `<head>`, which adds Monetag's OnClick tag (`https://al5sm.com/tag.min.js`, zone 12075937); a `monetag` verification meta tag is in the same heads. Only these pages get the relaxed CSP: `script-src` allows `al5sm.com` plus `'wasm-unsafe-eval'` (the tag compiles WebAssembly), and `connect-src` allows `https:` because Monetag rotates its ad-server domains. Admin pages and the API keep the strict CSP. Google AdSense was removed (no AdSense script, meta or `ads.txt`).
- Health check: `GET /healthz` returns `{ ok: true, db: "postgres" | "json" }`, or 503 if the database is unreachable.
- Sample groups are marked "Sample" and use fake invite codes. Delete them in the admin panel before launch.
- GroupHub is not affiliated with WhatsApp or Telegram.

## Deploy: Render (free) + Supabase (Postgres) + GoDaddy domain
Render's free web services have no persistent disk, so the JSON file would be wiped on every deploy and restart. Use Supabase's free Postgres instead.

### 1. Create the database (Supabase)
1. Sign up at https://supabase.com and click **New project**. Choose a region close to your Render region, and save the **database password** somewhere safe.
2. When the project is ready, click **Connect** at the top of the dashboard.
3. Under **Connection string**, pick **Session pooler** (port **5432**) and copy the URI. It looks like:
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-<n>-<region>.pooler.supabase.com:5432/postgres`
   - Replace `[YOUR-PASSWORD]` with your database password. If the password contains characters like `@ # / ?`, URL-encode them.
   - Don't use the *Direct connection*. It's IPv6-only and Render can't reach it.
   - The *Transaction pooler* (port **6543**) also works and allows more connections. Session pooler is the simpler default.
4. Optional: open **SQL Editor**, paste `db/schema.sql` and run it. The app also creates the tables automatically on first start. The schema enables Row Level Security, which blocks Supabase's public REST API from reading or changing the tables; the app keeps full access.

### 2. Create the admin password hash (on your computer)
```bash
npm install
npm run hash-password -- "a long random password you will remember"
# copy the printed scrypt$... value
```

### 3. Create the web service (Render)
**Option A, Blueprint (uses `render.yaml`):** Render dashboard → **New → Blueprint** → connect GitHub and pick `nika-kirann/Grouphub`. Render reads `render.yaml` and asks for the secret values (`DATABASE_URL`, `ADMIN_PASSWORD_HASH`).

**Option B, by hand:** **New → Web Service** → pick the repo, then set:
- Runtime **Node**, Branch **main**, Build command `npm ci`, Start command `node server.js`
- Instance type **Free**
- Health check path `/healthz` (under Advanced)

**Environment variables** (Service → Environment):

| Key | Value |
|---|---|
| `DATABASE_URL` | the Supabase Session pooler URI from step 1 |
| `ADMIN_PASSWORD_HASH` | the `scrypt$...` value from step 2 |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `NODE_VERSION` | `20` |
| `SEED_SAMPLES` | `0` (or `1` to start with sample groups) |
| `IP_HASH_SALT` | any long random string (the Blueprint generates one) |

Render sets `PORT` itself; the app listens on it. Deploy, then open `https://<service>.onrender.com/healthz`. It should show `{"ok":true,"db":"postgres"}`. Then log in at `/admin`.

### 4. Use your GoDaddy domain
1. In Render: your service → **Settings → Custom Domains → Add Custom Domain**. Add `yourdomain.com`, then add `www.yourdomain.com`.
2. In GoDaddy: **My Products → your domain → DNS** (Manage DNS):
   - **www:** add or edit a **CNAME** record. Name `www`, Value `<service>.onrender.com` (your Render URL without `https://`).
   - **Root (@):** edit the existing **A** record for `@` (or add one). Value = the IP shown on Render's custom-domain screen (currently `216.24.57.1`).
   - Delete any other `A` records for `@`, any **AAAA** records, and any GoDaddy **Forwarding** or parked-page settings for the domain.
   - Set TTL to the lowest option (e.g. 600 seconds / 1/2 hour) to speed up checking.
3. Back in Render, click **Verify** on each domain. DNS can take from a few minutes up to 48 hours. Render then issues free HTTPS certificates automatically and redirects HTTP to HTTPS.

### Free-tier limits to know
- **Render free** instances **sleep after about 15 minutes without traffic**. The next visit takes up to about a minute to wake up, and admin sessions and rate limits reset on wake (data in Supabase is safe). Free services also have a monthly usage allowance.
- **Supabase free** projects are **paused after about a week of no database activity**. Un-pause them from the Supabase dashboard. The free plan has a 500 MB database limit.
- For an always-on site, upgrade the Render instance to a paid plan.

