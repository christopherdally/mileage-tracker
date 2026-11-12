# AI agent rules

Project-specific rules for AI agents (Claude, Codex, etc.) working on this repo.

## Versioning

- **Increase the version number once on every calendar day that changes are
  made.** The first change of the day bumps it; a day with changes never ends
  without a bump.
- **Only once per day**, even if there are multiple changes that day, and
  even across multiple commits or PRs landing that day.
- If the version has already been bumped today, fold any further same-day
  changes into that day's `CHANGELOG.md` entry instead of bumping again.
- A bump means updating the version everywhere it appears, so they all
  match: the root, `client/`, `server/` and `e2e/` `package.json` files, the version
  badge and the `/api/health` example in `README.md`, and a new dated entry
  in `CHANGELOG.md` (moving what was under `[Unreleased]` into it).
