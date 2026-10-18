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
- **Storage:** a JSON file (`data/grouphub.json`). It's created on first run with 15 **sample** groups that use fake invite codes.

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
| `DB_FILE` | `data/grouphub.json` | Database file. In production it must be on a persistent disk. |

## Project layout
```
server.js            Express app: public API, admin auth + API, security headers
lib/validate.js      Invite-link and field validation (allow-lists)
lib/store.js         JSON-file storage with atomic writes
lib/hash-password.js Helper for ADMIN_PASSWORD_HASH
public/              Public site (grouphub.html, grouphub.js, favicon.svg)
admin/views/         Login and dashboard pages (served only by /admin)
admin/assets/        Admin CSS/JS
data/                Database (git-ignored)
```

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/groups` | – | Approved groups, featured first |
| POST | `/api/groups` | – | Submit a group (status becomes `pending`; 10 per hour per IP) |
| POST | `/api/groups/:id/report` | – | Report an approved group (20 per hour per IP) |
| GET | `/api/meta` | – | Allowed categories, countries, languages, report reasons |
| POST | `/admin/login`, `/admin/logout` | – | Session login (5 failed attempts per 15 minutes per IP) |
| GET | `/api/admin/stats`, `/api/admin/groups?status=pending\|approved\|reported\|rejected` | admin | Dashboard data |
| PATCH / DELETE | `/api/admin/groups/:id` | admin + CSRF | Edit, change status, feature, or delete a group |
| POST | `/api/admin/groups/:id/clear-reports` | admin + CSRF | Clear a group's reports |

## Notes and limits
- Sessions and rate limits are kept in memory, so restarting the server logs admins out. For more than one server instance, use Redis or a database.
- The JSON store suits a small directory. For more traffic, switch `lib/store.js` to SQLite or Postgres.
- Sample groups are marked "Sample" and use fake invite codes. Delete them in the admin panel before launch.
- GroupHub is not affiliated with WhatsApp or Telegram.
