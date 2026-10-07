# Service Center 1.1.0

`/#/service-center` is an optional authenticated Studio extension (module version 1.1.0, host contract version 1). It is **off by default**; enable with `STUDIO_SERVICE_CENTER_ENABLED=1` in the server environment and restart the server. The authenticated `GET /api/studio/extensions` returns contract version 1 and only successfully installed modules. The client uses this discovery, not a hardcoded route: a disabled, incompatible or failed module adds no navigation or page, and registration is refused if the route path or name would collide with an existing Studio route. The registration form and manifest import/export use the same module-owned catalog. See [sanitized r3 contract](SPEC.md), [extension contract](../harness/studio-extensions.md), [source registry](SOURCES.md), [change catalog](CHANGELOG.md), and the [generic example manifest](manifest.example.json). The authoritative wire contract is `packages/server/src/modules/studio/extensions/service-center/manifest.schema.json`, enforced by its TypeScript validator and projected into generated `docs/openapi.json`.

A public release is **not** implied by this source branch. There are no built-in real-service URLs, credentials, fixture users or target approvals. An instance starts with an empty catalog. Super administrators grant catalog editing to active admins from the local permission form; other admins can read enabled records and save only their own favorites. Health checks require a separate explicit editor approval and never establish browser reachability.

Navigation and health URLs accept only ordinary ASCII query keys `view`, `category`, `tag`, `q`, `page`, `sort`, `lang`, `id`, `name`, `filter`, `tab`, `ref`, and `highlight` (case-insensitive). All other keys fail closed, including signed URLs, vendor-specific credential names, encoded/nested aliases and unknown service-specific parameters; a service depending on another query key requires an explicit security review and validator update. Fragments can be plain ASCII anchors or hash paths (for example `#overview` or `#/tools/status`), but cannot contain parameters, encoded separators, spaces or other punctuation; this prevents query-style credentials from bypassing the query-key guard. URL userinfo and non-HTTP(S) schemes are also rejected. Import and runtime edits use the same validation; previously saved records are not silently rewritten.

## Focused checks

```sh
npm run test -- tests/server/service-center.test.ts tests/server/service-center-health.test.ts tests/server/studio-extension-registry.test.ts tests/client/service-center.test.ts tests/client/studio-extension-registry.test.ts
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
