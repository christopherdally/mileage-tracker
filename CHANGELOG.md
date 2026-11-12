# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-11-12

### Added

- Import journeys from a CSV file (Journeys → Import), for anyone moving over
  from a spreadsheet. It needs a Date column and Miles (or start and end
  odometer readings); Journey and Vehicle columns are used if present, dates
  are read day-first, and a file from the app's own CSV export works as it
  is. It shows what will be added and which rows can't be before anything is
  saved, and leaves out journeys that are already logged.
- Multiple vehicles per user. Settings has a list of vehicles; with two or
  more, journeys and fuel entries get a Vehicle picker (defaulting to the one
  used last), the start reading carries on from that vehicle's last journey,
  and a report can cover all vehicles or one. A PDF that mixes vehicles says
  which was used for each entry and adds a miles-by-vehicle table. The old
  single free-text vehicle becomes each user's first vehicle and their
  existing entries are attached to it the first time the server starts.
- CSV export of the journeys and fuel behind a report, from the Report tab.
- Two-step sign-in. Anyone can turn it on in Settings with an authenticator
  app; signing in then needs a 6-digit code or one of ten one-off recovery
  codes. Admins can turn it off for someone who has lost both, and
  `create-admin` does the same for a locked-out admin.
- "Forgot your password?" on the sign-in screen, which emails a link that
  works once for an hour. Needs `APP_URL` and `SMTP_HOST` to be set and is
  hidden otherwise; it covers accounts whose username is an email address.
- Activity log for admins (Settings → Activity log): user creation, changes
  and deletion, backups made, downloaded and restored, and password and
  two-step changes, with who, when and from which address. Kept for two
  years and preserved across a restore.
- Continuous integration (GitHub Actions): client unit tests and build, API
  tests against PostgreSQL, and a browser test of the whole app including the
  receipt scanner. `npm test` now works in `server/`, and `e2e/` holds the
  browser test.

### Changed

- Admins set a vehicle only when creating a user; after that each person
  manages their own vehicles in Settings.
- Sign-in attempt limits are counted in the database instead of in memory, so
  they survive a restart and hold across more than one server. Wrong
  two-step codes and password reset requests have their own limits.
- The server now depends on `nodemailer` (for reset emails) as well as `pg`.
- Restoring a backup re-applies the schema, so a backup taken by an older
  version works straight away.

### Fixed

- On the Fuel tab, closing the scan review or a receipt preview also closed
  the fuel form underneath and discarded what had been entered.

- Receipt scanning never started: the scanner library was imported in a way
  the bundle didn't support, and its worker, WASM core and language data were
  fetched from a CDN that the app's Content-Security-Policy blocks. The
  scanner is now bundled and served by the app itself.
- Litres are now read from lines that also carry a unit price, such as
  `42.31 LITRES @ 139.9 P/L`.

## [1.0.0] - 2026-10-16

First tagged release.

### Added

- Installable, offline-first PWA for logging business mileage, with two-way
  sync across devices through a self-hosted PostgreSQL database.
- Daily journey entry by odometer readings or by miles, with per-journey rate
  overrides.
- Pence-per-mile rates with start/end dates, supporting rate changes over
  time.
- PDF claim generation for any date range, showing the full workings (rate
  periods, every journey, totals, signature lines).
- Fuel log with receipt photos/PDFs, shrunk and stored offline, compared
  against the mileage claim.
- Admin-managed accounts (no public sign-up): create, disable, delete users
  and reset passwords.
- Database backups (`pg_dump`) to local disk, S3-compatible storage, or both,
  on a daily schedule, with one-click restore from the admin screen.
- Separate monthly cutoffs for fuel and mileage reporting
  (`105e2ad`, `7137dc3`).
- 24-month journey history and OCR-based fuel receipt scanning
  (`233be54`).
- Personal report archive: upload and keep past monthly claim PDFs,
  optionally backed by S3 (`3bf5530`).
- Dokploy deployment guide, Docker Compose setup, and optional Caddy-managed
  HTTPS profile for installing the PWA on phones.
- The running app version is now shown at the bottom of Settings, and
  returned by `GET /api/health` (`{"ok":true,"version":"1.0.0"}`), so it's
  easy to tell which release is deployed.
- Screenshots of the Log, Journeys, Fuel, Rates, Report and Settings screens
  in the README.
- `package.json`, `CHANGELOG.md` and `ROADMAP.md` at the project root.
- A feature request issue template (`.github/ISSUE_TEMPLATE/feature_request.md`),
  a "Feature requests" section in the README, and a "Requested by users"
  section in `ROADMAP.md` to track what people actually ask for.
- A copyright notice in Settings, linking to lifespansoftware.com and the
  GitHub repository.

### Changed

- Documentation overhaul for public release: expanded README (getting-started
  overview, environment variable reference, troubleshooting, contributing,
  license), `.env.example`, `.gitignore`, and an MIT `LICENSE`.
- Replaced the hardcoded personal default admin login (`cdallywales@gmail.com`)
  with a generic `admin@example.com` placeholder in server code, Dokploy
  config/docs, and tests.

### Fixed

- `docker-compose.yml` published the app on host port `3001` but mapped it to
  container port `3001`, while the app actually listens on `3000`; the quick
  start now works out of the box (`3000:3000`).

[Unreleased]: https://github.com/christopherdally/mileage-tracker/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/christopherdally/mileage-tracker/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/christopherdally/mileage-tracker/releases/tag/v1.0.0
