# Service Center change catalog

## 2026-10-07 (Asia/Taipei) — r3 run 5, card `t_ae549bfa`

- Module version `1.1.0`; host contract v1, manifest `schemaVersion` 1 and the module permission contract v1 are unchanged. Upstream base `942bb78fa2e3722fe14e6778b0ff21d50662fa27` (Studio 0.7.31) is the merge base in this checkout.
- Generic, non-hardcoded OpenAPI collection: `scripts/studio-extension-openapi.mjs` discovers `modules/studio/extensions/<id>/openapi.mjs`, refuses a symlinked or directory contract file, requires the contract id to match its directory, and `scripts/generate-openapi.mjs` now rejects any scanned extension route outside `/api/studio/<id>/`, any path/operation-id collision, and any extension mutation of a host path or host schema. A missing extension route fails generation instead of emitting a partial document.
- Executable dependency boundary: `scripts/check-studio-extension-boundary.mjs` asserts the upstream ancestor, the allowed changed paths, the required upstream-equal `router/index.ts`, `AppSidebar.vue`, `safe-file-store.ts` and eleven locale files, the tracked manifest `schemaVersion` and module manifest, and that module sources import only their own files plus the shared registry seam — no host `@/` or `modules/` business imports.
- Client route registration now refuses a route outside `/<extension-id>`, a name that does not start with `studio.`, a duplicate name and any path already registered by the host. `SafeFileStore` writes UTF-8 without a caller-supplied file `mode`, matching the host seam contract.

### Verified commands (exit 0, this run)

- `node scripts/check-studio-extension-boundary.mjs` — `{changed: 50, upstreamEqual: 14, moduleSourcesChecked: 20}`.
- `npm run test -- tests/server/service-center.test.ts tests/server/service-center-health.test.ts tests/server/studio-extension-registry.test.ts tests/server/studio-extension-openapi.test.ts tests/server/studio-extension-boundary.test.ts tests/client/service-center.test.ts tests/client/studio-extension-registry.test.ts tests/client/i18n-coverage.test.ts` — 8 files / 45 tests passed.
- `npm run test:e2e -- tests/e2e/service-center.spec.ts tests/e2e/service-center-live.spec.ts` — mocked browser suite 5 passed (2 opt-in live tests skipped without the isolated fixture).
- Isolated real fixture (`STUDIO_SERVICE_CENTER_ENABLED=1`, private scratch state, ports 19671/19672): `PLAYWRIGHT_PORT=19672 SERVICE_CENTER_PREVIEW_TOKEN_FILE=<private> SERVICE_CENTER_SCREENSHOT_DIR=<private> npm run test:e2e -- tests/e2e/service-center-live.spec.ts` — 2 real JWT/API/browser tests passed (desktop + 390px compact); screenshots stay in private scratch.
- `npm run openapi:generate` — 458 endpoints / 58 tags, extension operations inside `/api/studio/service-center/`.
- `npm run harness:check` and `npm run build` — passed, including public API doc harness and server bundle; existing Vite large-chunk warning only. `git diff --check` clean.

## 2026-10-07 (Asia/Taipei) — r3 extension boundary, card `t_ae549bfa`

- Reconciled with upstream Studio 0.7.31. Service Center is now off by default behind `STUDIO_SERVICE_CENTER_ENABLED=1`; only the authenticated, versioned extension discovery advertises an installed module. The client adds routes/navigation only after validated discovery and resets on auth changes. Upstream Connections navigation icon and API Relay remain intact.
- Moved server domain, schema and OpenAPI metadata under `modules/studio/extensions/service-center/` with a module-private atomic store; existing instance data paths and wire schema remain unchanged. Moved client view/store/API/components/messages under `modules/studio-extensions/service-center/`. Host adapters alone know the private auth, config, users and client runtime. See [extension contract](../harness/studio-extensions.md).
- Added default-off, failure, compatibility, auth, route, reset and browser regression coverage. The preceding 1.0.0 entry documents the original r2 implementation and paths at that time; it is preserved as history, not the current import map. No formal release, remote push or production enablement is implied.

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
