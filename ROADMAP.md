# Roadmap

Ideas for where the project could go next. Nothing here is committed or
scheduled — it's a backlog of suggestions, some gathered by scanning the
current codebase for gaps, others requested by people using the app. Open
an issue if you'd like to pick one up or propose something new.

## Requested by users

This section tracks feature requests that came from people using the app,
as opposed to the rest of this file, which is ideas gathered by scanning
the codebase. There's nothing here yet — this is a new public project and
no one has filed a feature request issue so far.

**Have an idea?** [Open a feature request](https://github.com/christopherdally/mileage-tracker/issues/new?template=feature_request.md)
describing what you're trying to do and what's in the way. Requests that
get traction (reactions, duplicates, follow-up comments) get listed here
with a link back to the issue, so this section becomes a running record of
what people have actually asked for — not just what seemed like a good
idea while reading the code.

## Accounts & security

- **Self-service password reset.** Today only an admin can reset a password
  (`npm run create-admin`, or Settings → Users). There's no "forgotten
  password" email flow, which also means the app currently has no outbound
  email integration at all.
- **Two-factor authentication.** Sessions are long-lived (`SESSION_DAYS`,
  default 60) to support offline use, which raises the value of an optional
  second factor for admins in particular.
- **Audit log for admin actions.** User creation/deletion, password resets,
  and backup restores aren't currently logged anywhere an admin can review
  later.
- **Distributed-safe rate limiting.** The login rate limiter
  (`server/src/http.js`) is an in-memory fixed window keyed by IP. It resets
  on restart and won't coordinate across replicas if the app is ever scaled
  horizontally — fine for a single-container deployment, a gap if that
  changes.

## Money & locale

- **Multi-currency / non-GBP support.** Amounts, rates and formatting are
  hardcoded to GBP and `en-GB` (`client/src/util.js`, `client/src/pdf.js`:
  `£`, "pence per mile"). Supporting other currencies would need a
  per-user or per-org currency setting threaded through calc, PDF and UI.
- **Localization (i18n).** All UI strings and the generated PDF are English
  only; there's no translation layer.
- **Multiple vehicles per user.** The schema stores a single free-text
  `vehicle` field per user (`server/src/schema.sql`). Drivers who use more
  than one vehicle for business journeys currently have to record it in the
  journey description instead of selecting a vehicle per trip.

## Reporting & export

- **CSV/spreadsheet export.** Journeys, fuel and claim data can currently
  only leave the app as a formatted PDF. A raw CSV export would make it
  easier to feed into accounting software or a spreadsheet.
- **Per-employer/cost-centre tagging.** Useful for anyone claiming mileage
  from more than one organisation in the same period.
- **Year-end / tax-year summary report**, distinct from the rolling claim
  periods, for self-assessment or annual expense reporting.

## Quality & operations

- **Continuous integration.** There's no CI configuration (`.github/workflows`
  is empty) — `npm test` in `client/` and `server/` only runs locally today.
  Running the existing unit and end-to-end test suites on every push/PR
  would catch regressions earlier.
- **Linting.** No ESLint/Prettier configuration is present, so style and
  common bug patterns aren't checked automatically.
- **Server-side test coverage for auth edge cases.** `server/test/` covers
  the happy paths (login, fuel sync, receipts) well; token expiry, replay,
  and the admin-deactivation-signs-out-other-devices path don't have
  dedicated tests yet.
- **Health/readiness metrics.** `/api/health` reports whether the database
  is reachable; there's no structured metrics or logging output for
  monitoring a production deployment (request latency, backup success/
  failure, sync volume).

## Nice to have

- **Push notifications** for backup failures or a nearing claim-period
  deadline, now that the app is already a PWA.
- **Shared/team rate presets**, so an admin can publish a rate that new
  users inherit by default instead of each person entering their own.
- **Bulk journey import** (e.g. from a CSV or a calendar) for people
  migrating from a spreadsheet.

---

Have a suggestion not listed here? [Open a feature request](https://github.com/christopherdally/mileage-tracker/issues/new?template=feature_request.md) —
see [Contributing](README.md#contributing) in the README.
