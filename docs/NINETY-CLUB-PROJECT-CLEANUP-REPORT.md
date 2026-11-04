# Ninety Club project cleanup and repository audit

Updated 5 November 2026. Scope: recursive inventory of `E:\Projects\tambolagame`, Git tracked and ignored files, runtime/build/test/CI references, dependency references, Docker configuration, migrations and documentation. The repository contained about 24,875 files and 4,078 directories including dependencies and local ignored data; Git status expanded to 488 paths after `.tmp/` was ignored (the earlier collapsed status count differed by directory aggregation).

## Repository structure retained

- `client/`: Vite/React frontend, assets, client build configuration and lockfile.
- `server/`, `src/`: backend services, API, Socket.IO and application logic.
- `db/` and migration assets: schema history and upgrade scripts (retained in order).
- `tests/`: Node regression, authorization, security and integration tests.
- `scripts/`: owner tooling, security checks, migrations and operational utilities.
- `docs/`: current readiness, audit chronology, acceptance evidence and project documentation.
- `deploy/`, Docker files, root/client package manifests and lockfiles, GitHub workflows and environment templates.
- `chrome-evidence/`: retained acceptance screenshots supporting the earlier player/host Chrome run.

## Cleanup performed

- Added `.tmp/` to `.gitignore`. It contains local reconstruction scripts, screenshots and prompt material; it remains on disk and is excluded from Git.
- Removed unused root dependency `path@0.12.7`; Node's built-in `path` module supplies these imports.
- Removed unused client development dependencies `webpack` and `webpack-cli`; no source, scripts, CI or build configuration referenced them, and the Vite production build succeeds.
- Updated both package lockfiles through npm uninstall.
- Confirmed generated client `dist` output and local runtime data are ignored rather than source-controlled.
- No source, migration, user data, screenshots, unique historical audit report, or uncertain file was deleted or reorganized. Dependency/reference review did not prove any additional candidate safe to remove. Historical reports remain separate to preserve chronology and unique evidence.

## Files deliberately preserved

`.preflight` (about 709 MB), `.pgdata` (about 201 MB), backups, `.tmp-sarvam-audition*` voice samples, logs, and local fixtures were preserved. They may contain unique recovery, test, or user evidence; no content was removed. `.env` remains ignored and was not staged. No credentials or secret values are included in this report.

## Verification after cleanup

- Full Node test suite: 759 tests, 20 suites, all passed.
- Client lint and production Vite build: passed.
- Security probes: 51/51 passed.
- Secret scan: 675 files inspected, passed.
- Root and client `npm audit`: zero vulnerabilities.
- Docker production image built; isolated production-mode container became ready on loopback with a new disposable `finalbuild` schema. It was stopped and removed after readiness verification.
- Original isolated acceptance app remained healthy. Migrations through 027 were reported current in the acceptance environment.

## Classification and limits

Required production source, development/build configuration, tests/CI, current documentation, historical evidence, fixtures, dependency trees, generated build output and sensitive local files were reviewed. No additional files were confidently classified as duplicate/obsolete or abandoned. Unused asset candidates and several large ignored local data directories remain uncertain and preserved. Secret scanning passed; `.env` and local DB directories remain potentially sensitive and excluded from Git.

## Hygiene outcome

The project remains organized in its established layout. This cleanup was intentionally limited to two proven-unused packages and preventing temporary artifacts from being staged. No claim is made that all ignored machine-local data has been purged. Exact deployment readiness blockers and acceptance limits are recorded in `NINETY-CLUB-PRODUCTION-READINESS-GAPS.md` and `NINETY-CLUB-AUDIT-STATUS-2026-11-05.md`.
