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

- **Password reset for plain-username accounts.** "Forgot your password?"
  emails the username, so it only works when the username is an email
  address. A separate, optional email address per user would cover the
  rest; today an admin resets those passwords.
- **Passkeys.** Two-step sign-in uses authenticator-app codes. Passkeys
  (WebAuthn) would be phishing-resistant and quicker on a phone.

## Money & locale

- **Multi-currency / non-GBP support.** Amounts, rates and formatting are
  hardcoded to GBP and `en-GB` (`client/src/util.js`, `client/src/pdf.js`:
  `£`, "pence per mile"). Supporting other currencies would need a
  per-user or per-org currency setting threaded through calc, PDF and UI.
- **Localization (i18n).** All UI strings and the generated PDF are English
  only; there's no translation layer.

## Reporting & export

- **Per-employer/cost-centre tagging.** Useful for anyone claiming mileage
  from more than one organisation in the same period.
- **Year-end / tax-year summary report**, distinct from the rolling claim
  periods, for self-assessment or annual expense reporting.

## Quality & operations

- **Linting.** No ESLint/Prettier configuration is present, so style and
  common bug patterns aren't checked automatically. It could run alongside
  the tests in `.github/workflows/ci.yml`.
- **Server-side test coverage for auth edge cases.** `server/test/` covers
  the happy paths (login, sync, fuel, receipts, vehicles) well; token expiry, replay,
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
- **Journey import from a calendar.** Journeys can be imported from a CSV
  file; reading them from calendar entries would save retyping for people
  who plan visits there.

---

Have a suggestion not listed here? [Open a feature request](https://github.com/christopherdally/mileage-tracker/issues/new?template=feature_request.md) —
see [Contributing](README.md#contributing) in the README.
