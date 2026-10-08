# Service Center 2.0.1

`/#/service-center` is an optional authenticated Studio extension (module version 2.0.1, host contract version 1). It is **off by default**; enable with `STUDIO_SERVICE_CENTER_ENABLED=1` in the server environment and restart the server. The authenticated `GET /api/studio/extensions` returns contract version 1 and only successfully installed modules. The client uses this discovery, not a hardcoded route: a disabled, incompatible or failed module adds no navigation or page, and registration is refused if the route path or name would collide with an existing Studio route. The registration form and manifest import/export use the same module-owned catalog. See [SC02 contract](SC02.md), [historical r3 contract](SPEC.md), [extension contract](../harness/studio-extensions.md), [source registry](SOURCES.md), [change catalog](CHANGELOG.md), and the [generic v2 example manifest](manifest.example.json). The authoritative wire contract is `packages/server/src/modules/studio/extensions/service-center/manifest.schema.json`, enforced by its TypeScript validator and projected into generated `docs/openapi.json`.

A public release is **not** implied by this source branch. There are no built-in real-service URLs, credentials, fixture users or target approvals. A new instance presents two editable category templates, 私有服務 (`private-services`) and 公網服務 (`public-services`), with no nodes or registered services; merely reading never writes them. Super administrators grant catalog editing to active admins from the local permission form; other admins can read enabled records and save only their own favorites. Health checks require a separate explicit editor approval and never establish browser reachability.

Schema v2 has `{schemaVersion:2,categories,nodes,services}`. Up to200 categories are supported to preserve the full legal v1 range; category names compare exactly so distinct case or Unicode spelling is retained. Node and entrance aliases retain their normalized uniqueness rules. Each service references a category and deployment node by ID (or `null`), and has one to eight named `endpoints` with a stable default endpoint ID. Each endpoint declares its URL, network (`local`, `lan`, `tailscale`, `public`) and login (`unknown`, `required`, `none`). These are editor declarations, not a browser or credential probe. Selecting an alternate entrance changes only the link on the current page. `local` denotes the deployment host, not the phone or browser you are viewing from. Category tabs, location/network filters and search operate on the selected entrance; the Info panel lists all entrances and the separate backend-check state.

The server accepts a v1 manifest for import and normalizes it without guessing deployment or network. It exports v2. A v2 import may reference categories/nodes already present without re-declaring them; preview reports entity-scoped conflicts and confirmation requires a keep/overwrite choice for every conflicting ID. A first authorized write to a valid persisted v1 catalog keeps the exact old `catalog.json` bytes in private `catalog-v1.backup.json` (0600) before atomically replacing the catalog; read, invalid writes and stale revisions do not migrate it. The migration keeps existing favorites, editor grants, health approval for unchanged targets, service IDs and revision progression. Restart after migration loads v2 without duplicating records. The old 1.1.0 module cannot read v2: rollback requires stopping the new module and restoring the exact matching pre-upgrade catalog and module data backup before starting 1.1.0. Do not swap binaries alone or attempt a destructive v2-to-v1 conversion. Production backup, deployment and rollback remain a separate approval gate.

Navigation and health URLs accept only ordinary ASCII query keys `view`, `category`, `tag`, `q`, `page`, `sort`, `lang`, `id`, `name`, `filter`, `tab`, `ref`, and `highlight` (case-insensitive). All other keys fail closed, including signed URLs, vendor-specific credential names, encoded/nested aliases and unknown service-specific parameters; a service depending on another query key requires an explicit security review and validator update. Fragments can be plain ASCII anchors or hash paths (for example `#overview` or `#/tools/status`), but cannot contain parameters, encoded separators, spaces or other punctuation; this prevents query-style credentials from bypassing the query-key guard. URL userinfo and non-HTTP(S) schemes are also rejected. Import and runtime edits use the same validation; previously saved records are not silently rewritten.

## Focused checks

```sh
npm run test -- tests/server/service-center.test.ts tests/server/service-center-migration.test.ts tests/server/service-center-health.test.ts tests/server/studio-extension-registry.test.ts tests/client/service-center.test.ts tests/client/studio-extension-registry.test.ts
npm run test -- tests/server/studio-extension-openapi.test.ts tests/server/studio-extension-boundary.test.ts
node scripts/check-studio-extension-boundary.mjs
npm run test:e2e -- tests/e2e/service-center.spec.ts
npm run harness:check
npm run build
```

`tests/e2e/service-center-live.spec.ts` is opt-in. It uses an actual isolated Koa API, Web UI authentication with three throwaway fixture users, and a real Vite-rendered page; it does not mock Service Center endpoints. Its fixture helper imports only auth/users/schema and the narrow extension adapter, not Studio's full bootstrap. It must never be pointed at the user's live Web UI state or a public backend. Start it only on free ports, in a private scratch directory, with no inherited auth secret, and never commit its tokens/state/screenshots. A reproducible example (replace the scratch variable with your own safe directory):

```sh
preview="$(mktemp -d "$TMPDIR/sc-preview.XXXXXX")"
mkdir -p "$preview/state" "$preview/uploads" "$preview/screenshots"
env -u AUTH_JWT_SECRET -u AUTH_TOKEN STUDIO_SERVICE_CENTER_ENABLED=1 HERMES_WEB_UI_HOME="$preview/state" HERMES_WEBUI_STATE_DIR="$preview/state" UPLOAD_DIR="$preview/uploads" PORT=18671 BIND_HOST=127.0.0.1 npx vite-node tests/helpers/service-center-preview.ts
# In a second shell, only after the API is ready:
HERMES_WEB_UI_BACKEND_PORT=18671 HERMES_WEB_UI_FRONTEND_PORT=18672 HERMES_WEB_UI_VITE_CACHE_DIR=node_modules/.vite/service-center-preview npx vite --host 127.0.0.1 --port 18672 --strictPort
# In a third shell, after both services are ready:
PLAYWRIGHT_PORT=18672 SERVICE_CENTER_PREVIEW_TOKEN_FILE="$preview/state/preview-tokens.json" SERVICE_CENTER_SCREENSHOT_DIR="$preview/screenshots" npm run test:e2e -- tests/e2e/service-center-live.spec.ts
```

The opt-in test writes throwaway `live-*` records; do not use it against a curated preview catalog unless you intend to remove those fixtures by authenticated API afterward. Restart only that isolated preview process against the same private state directory to verify persistence. A same-host Tailscale browser check is not proof from another device; validate the target device separately before asserting reachability. No live service is launched, repaired, restarted or checked automatically by importing a manifest.
