# Mileage Tracker

A self-hosted, mobile-first app for logging business mileage and producing monthly claim PDFs.

- **Installable phone app (PWA)** that works with no signal. Journeys are saved on the phone and sync when you're back online.
- **Syncs across devices** through your own PostgreSQL database.
- **Daily entry** by odometer readings (start and end) or by miles, with an optional different rate per journey.
- **Rates that change over time.** Each person keeps their own pence-per-mile rates with start and end dates. Adding a new rate offers to end the previous one the day before.
- **PDF claim** for any dates: this claim period, last period, or custom dates. Claim periods can start on any day of the month (e.g. 26th to 25th). The PDF shows the workings: miles × rate for each rate period, the rates in force, every journey, and signature lines.
- **Fuel log with receipts.** Record what you paid at the pump (amount, litres, odometer, where) and attach receipt photos or PDFs, even offline. Photos are shrunk on the phone, stored in the database (so they're in every backup) and viewable on all your devices. Reports and the PDF compare fuel paid with the mileage claimed; the photos themselves stay out of the PDF.
- **No sign-up.** Sign in with an email address (or a plain username). Admins create accounts, reset passwords, disable or delete users. Anyone given a password by someone else must choose their own at first sign-in.
- **Backups** with `pg_dump` to the server, to S3 (or any S3-compatible storage), or both. Daily schedule, manual backups, download and one-click restore from the admin screen.

## Deploying on Dokploy

See **[DOKPLOY.md](DOKPLOY.md)**: a Compose deployment (`docker-compose.dokploy.yml`, app + Postgres) or the `Dockerfile` with a Dokploy-managed database.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, JWT_SECRET and ADMIN_PASSWORD at minimum
openssl rand -hex 24      # good POSTGRES_PASSWORD
openssl rand -base64 48   # good JWT_SECRET

docker compose up -d --build
```

Open `http://<server>:3000` and sign in with `ADMIN_USERNAME` (default `cdallywales@gmail.com`) and `ADMIN_PASSWORD`. The first admin is created only when the database has no users, and is asked to choose a new password straight away.

### HTTPS (needed on phones)

Phones only install the app and enable offline mode over HTTPS. The included Caddy service gets a certificate automatically:

1. Point a DNS record (e.g. `mileage.example.com`) at the server and open ports 80 and 443.
2. In `.env` set `DOMAIN=mileage.example.com` and `TRUST_PROXY=true`.
3. `docker compose --profile https up -d --build`

Then on the phone, open the site and choose **Add to Home Screen** (iPhone: Share menu; Android: browser menu or the install prompt).

If you already run nginx or Traefik, proxy to the `app` container on port 3000 instead and set `TRUST_PROXY=true`.

## Using it

| Tab | What it's for |
| --- | --- |
| Log | Odometer of miles this claim period, the amount so far, fuel paid, and a form to add a journey or fuel. The start reading fills in from your last end reading. |
| Journeys | Every journey by month. Tap one to edit or delete it. |
| Fuel | Fill-ups with receipt photos, and fuel paid compared with the claim for this period. |
| Rates | Your pence-per-mile rates with start and end dates. Warns about overlaps. |
| Report | Choose dates, see the workings, download or share the PDF. Set which day your claim periods start. |
| Settings | Sync status, your name and vehicle (shown on the PDF), password, and for admins: Users and Backups. |

**How the amount is worked out:** journeys are grouped by the rate that applies on their date (or their own custom rate). Each group is *total miles × pence per mile*, rounded to the penny once. The claim is the sum of the groups. Journeys on dates with no rate are listed but not claimed, and flagged in red.

## Offline and sync

- Everything is stored on the phone (IndexedDB) first, so saving never waits for the network.
- The app syncs on start, a moment after each change, when the connection returns, when you reopen it, and every 2 minutes.
- If the same journey is edited on two devices, the most recent edit wins. Deletes sync to every device.
- Sign-ins last `SESSION_DAYS` (default 60) so the app keeps working offline. Changing a password, or an admin disabling an account, signs out every other device.
- After a backup is restored, each device downloads a fresh copy on its next sync. Edits that were still waiting on a phone are kept and uploaded.

## Backups

Configure in `.env`:

| Setting | Meaning |
| --- | --- |
| `BACKUP_TARGET` | `local`, `s3` or `both` |
| `BACKUP_TIME` | Daily time, e.g. `02:00` (uses `TZ`). `off` to disable. |
| `BACKUP_KEEP` | Number of backups kept in each place (oldest removed) |
| `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 settings |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | For Backblaze B2, Wasabi, Cloudflare R2, MinIO and others |

Local backups live in the `backups` Docker volume. From **Settings → Backups** an admin can back up now, download any backup, or restore one (type `RESTORE` to confirm; a safety backup of the current data is taken first).

Restore from the command line instead:

```bash
docker compose cp ./mileage-2026-10-13_01-00-00-000-ab12cd.dump app:/tmp/restore.dump
docker compose exec app sh -c 'pg_restore --clean --if-exists --no-owner --single-transaction -d "$DATABASE_URL" /tmp/restore.dump'
docker compose exec db psql -U mileage -c "UPDATE meta SET value = gen_random_uuid()::text WHERE key='data_epoch'"
```

The last line tells devices to re-download.

## Admin tasks

- **Locked out?** Create or reset an admin from the server:
  `docker compose exec app npm run create-admin -- admin 'new-password'`
- **Add a person:** Settings → Users → Add user, then give them their username and password.
- **Someone left:** untick "Can sign in" to keep their records, or delete the user to remove their journeys and rates too.

## Development

Requirements: Node 20+, PostgreSQL 14+ (and `pg_dump`/`pg_restore` on the PATH for backups).

```bash
# client
cd client && npm install && npm test && npm run build
cp -r dist ../server/public

# server
cd ../server && npm install
DATABASE_URL=postgresql://user:pass@localhost/mileage \
JWT_SECRET=$(openssl rand -base64 48) ADMIN_PASSWORD=adminpass123 BACKUP_DIR=./backups \
npm start
```

### Project layout

```
server/            Node API (built-in http, scrypt passwords, signed tokens; only dependency is pg)
  src/api.js       Login, users, sync, backups endpoints
  src/backup.js    pg_dump / pg_restore, local + S3, daily schedule
  src/schema.sql   Tables; applied automatically at start
client/            React PWA built with esbuild
  src/store.js     IndexedDB offline store
  src/sync.js      Two-way sync engine
  src/calc.js      Claim maths (shared by screens and PDF)
  src/pdf.js       PDF claim (pdf-lib, generated on the phone)
  src/receipts.js  Receipt photos: shrink, store offline, fetch from server
  test/            Unit tests for the maths and PDF
server/test/       End-to-end API tests (api.test.mjs, fuel.test.mjs)
DOKPLOY.md         Dokploy deployment guide
```

### API

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/login` | anyone (rate limited) |
| GET / PUT | `/api/auth/me` | signed in |
| POST | `/api/auth/password` | signed in |
| POST | `/api/sync` | signed in (journeys, rates, fuel) |
| PUT / GET | `/api/files/:id` | signed in, own receipts only (photo or PDF, max 10 MB) |
| GET / POST | `/api/users` | admin |
| PATCH / DELETE | `/api/users/:id` | admin |
| GET / POST | `/api/backups` | admin |
| GET | `/api/backups/:id/download` | admin |
| POST | `/api/backups/:id/restore` | admin |

There is intentionally no sign-up endpoint.
