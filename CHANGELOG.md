# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

## [1.0.0] - 2026-10-13

Initial public release.

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

[Unreleased]: https://github.com/christopherdally/mileage-tracker/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/christopherdally/mileage-tracker/releases/tag/v1.0.0
