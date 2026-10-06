# Service Center change catalog

## 2026-10-07 (Asia/Taipei) — card `t_ae549bfa`

- Repository baseline: `200f0eec8aa5da1521958759cf5ab4c365835d6d`; feature branch `feat/service-center`. Root Studio app remains 0.7.26. New Studio Service Center module 1.0.0, JSON manifest schemaVersion 1, Service-Center-local permission contract v1; approved specification r1 → r2. No formal release, merge, production cutover, agent or cloud service change.
- Server: `packages/server/src/modules/studio/{contracts,controllers,repositories,routes,services}/service-center/`, `packages/server/src/bootstrap/routes.ts`; per-instance atomic revisioned catalog, import preview/confirm/export, per-user favorites, separate audited editor grants, explicit bounded health approvals. `packages/server/src/modules/studio/public/safe-file-store.ts` retains its text-write compatibility with and without an explicit file mode.
- Client: `packages/client/src/{api/studio,stores/studio,components/studio/service-center,views}/`, minimal `router/index.ts`, layout sidebar/rail and every existing locale via `i18n/service-center.ts`. Native cards, localized filters/editor/import/grant controls, exact safe new-tab links, truthful backend-only health status.
- Contract/doc: `packages/server/src/modules/studio/contracts/service-center/manifest.schema.json`, `scripts/generate-openapi.mjs`, `docs/openapi.json` (11 Service Center operations), this directory's `README.md`, `SPEC.md`, `SOURCES.md` and `manifest.example.json`; focused `tests/server/service-center*.test.ts`, `tests/client/service-center.test.ts`, `tests/e2e/service-center*.spec.ts`, `tests/helpers/service-center-preview.ts`. The example contains generic names/URLs only. Dashy attribution and exact concept-only scope: [SOURCES.md](SOURCES.md); no Dashy code copied.

### Verified commands (all exit 0)

- `npm run test -- tests/server/service-center.test.ts tests/server/service-center-health.test.ts tests/client/service-center.test.ts tests/server/safe-file-store-backup-fallback.test.ts` — 4 files / 14 tests passed.
- `npm run test -- tests/server/safe-file-store.test.ts` — 4 existing atomic file-store tests passed, including rollback when the second file write fails.
- `npm run test:e2e -- tests/e2e/service-center.spec.ts` — 3 mocked-API browser tests passed.
- `PLAYWRIGHT_PORT=18672 SERVICE_CENTER_PREVIEW_TOKEN_FILE=<private fixture path> SERVICE_CENTER_SCREENSHOT_DIR=<private screenshots path> npm run test:e2e -- tests/e2e/service-center-live.spec.ts` — 2 real isolated JWT/API/browser tests passed; fixture records subsequently removed through authenticated API. Repeated live runs were used to diagnose a prior transient Vite process exit and a non-idempotent text locator; only the later green run is cited.
- `npm run harness:check` — passed, including public API documentation harness.
- `npm run build` — passed; generated OpenAPI has 11 Service Center operations. Vite reports its existing large-chunk warning. `git diff --check` passed.

### Isolated runtime and limits

- Existing ports were checked before the isolated API/Vite preview. Three throwaway real-role fixture accounts (super_admin, ungranted admin, granted admin) proved denial, grant/revoke with the same token, saved catalog, favorites isolation, editor UI readback, and desktop/compact rendering. Catalog import from private inventory contained 11 confirmed browser interfaces; private manifest export matched exactly. Six local candidates and three excluded cloud sites are recorded with reasons in a private scratch artifact, never in this branch. Redirecting public cloud links were followed to actual HTTPS HTML applications before inclusion; no dead endpoint was restarted.
- Isolated preview-only API restart preserved all 11 records and catalog revision, with no full Studio bootstrap or gateway/cron/agent dispatch. The final desktop/editor/compact screenshots and focused command logs are private acceptance artifacts outside the public checkout.
- An accessible same-host/local preview is not evidence of remote Windows/mobile reachability. No real remote-device or production cutover test was run; target-account service logins, unavailable sites and formal Studio behavior remain untouched. Broad coverage was not used as the final gate: a prior attempt reported unrelated suite failures and the affected safe-file-store fallback was re-verified with its focused regression test. No production write or paid API was used.
