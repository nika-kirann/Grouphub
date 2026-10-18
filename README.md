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
| `IP_HASH_SALT` | random per start | Salt for hashing submitter/reporter IPs; set it so report de-duplication survives restarts |

## Project layout
```
server.js            Express app: public API, admin auth + API, security headers
lib/validate.js      Invite-link and field validation (allow-lists)
lib/store.js         JSON-file storage with atomic writes (fallback)
lib/pg-store.js      PostgreSQL storage (used when DATABASE_URL is set)
lib/seed.js          Sample groups (SEED_SAMPLES=1)
db/schema.sql        Postgres tables (run automatically; can also be pasted into Supabase)
render.yaml          Render Blueprint
lib/hash-password.js Helper for ADMIN_PASSWORD_HASH
public/              Public site (grouphub.html, grouphub.js, favicon.svg)
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

