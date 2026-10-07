# Studio Service Center — sanitized implementation contract r3

This is the tracked, deployment-neutral version of the approved r3 contract for card `t_ae549bfa`. Module revision 1.1.0; host integration contract v1; JSON manifest `schemaVersion` 1; Service Center permission contract v1. The application release version follows upstream Studio 0.7.31 (`942bb78fa2e3722fe14e6778b0ff21d50662fa27`), not a feature release. This is an isolated-preview delivery **off by default** — it is not permission to cut over the formal Studio instance.

r3 supersedes conflicting r2 baseline, path-scope, navigation-placement, versioning and integration-ownership statements: the feature is a self-contained optional module with a thin typed host adapter, outermost rail entry only, same Studio window.

## Module shape and boundaries

- The module is a native Vue 3 / Naive UI Studio extension at `/#/service-center`, contributed to the existing outermost navigation rail and desktop/mobile shell after validated discovery. There is exactly one entry and no duplicate item in the settings sidebar. Use cards, category/search/favorites, a registration form, and versioned JSON import/export. No separate dashboard, iframe, theme framework, launcher, proxy, mobile relay, service lifecycle action or credential collection.
- Module-owned frontend lives under `packages/client/src/modules/studio-extensions/service-center/**`; module-owned server code lives under `packages/server/src/modules/studio/extensions/service-center/**`. A small generic registry/contract lives adjacent inside those `studio-extensions/` roots. The only concrete host dependency composition is `packages/server/src/bootstrap/studio-extensions.ts`.
- A card opens its exact registered HTTP(S) URL in a new tab with `noopener noreferrer`. Network labels explain whether a service needs Tailscale, LAN, public or local connectivity; backend probe status never implies the user's browser can reach the link.
- One catalog per Studio instance, stored under `config.appHome/service-center`. Runtime saves appear without restarting Studio. Do not seed production URLs in source or bundle private inventory; only use the authenticated import API against isolated preview state.
- Service fields are `id`, `name`, `description`, `url`, `icon`, `category`, `tags`, `network`, `enabled`, `sortOrder`, optional `healthUrl`, optional `healthCheckEnabled`. See `manifest.schema.json` in the server extension directory. Only HTTP(S) URLs without userinfo are accepted; both navigation and health URL query keys are restricted to the documented benign allowlist (see README). Unknown keys fail closed rather than guessing whether they contain credentials or signed-link material. Icons come from a fixed local set; no arbitrary SVG, HTML, remote favicon or executable action.
- Export contains just `{schemaVersion:1,services:[...]}`. Dates, health results, health approvals, editor grants, secrets and personal favorites are never imported/exported. A complete document is validated before write. Import preview is non-mutating; confirm merges by stable ID, preserves unmentioned entries, requires an explicit keep/overwrite decision for each conflict, and checks the expected monotonic catalog revision (409 on stale write). Invalid documents leave the catalog unchanged.

## Optionality, host contract and failure

- One explicit opt-in switch, `STUDIO_SERVICE_CENTER_ENABLED=1`, on the isolated server only; unset or any other value is off. There is no runtime hot-loading, config-supplied code/paths/URLs, remote JS or process-isolation promise.
- Registration is limited to an explicitly compiled trusted allowlist and validated by stable ID, exact version, namespace and route methods before mounting. A disabled, absent, incompatible or failed module exposes no feature API (404), no route and no rail entry, and performs no module data initialization; the Studio base app keeps working. Partial registration is rolled back and only the module ID is logged.
- Server host adapter converts the authenticated request identity into a bounded validated actor DTO, re-resolves the active user on every request, provides a bounded eligible-admin lookup for grants and a module-scoped absolute data root. Only that adapter may import Studio config/users/account repositories. Module code must not import host private `@/` or `modules/` business trees.
- Client host supplies the authenticated request facade, auth-invalidation subscription and locale/theme signals; the module never inspects token storage, private host stores or config. Routes are registered through `addRoute` with module-owned names; a built-in name or path collision, or any path outside `/<extension-id>` and any name not starting with `studio.`, fails closed. Logout/auth invalidation clears module route, navigation and per-user store state while server-owned data is retained.
- Authenticated direct navigation to the module path must await registration and resolve the deep link; a disabled path must not spin or bypass login.
- Module messages live in a local `useI18n` scope that inherits the host locale (including lazy language switching); they are not merged into the host global dictionaries. The rail label is rendered by a module-local entry component from bounded metadata, never raw HTML/SVG.

## Permissions and ownership

- All active authenticated users can read enabled catalog entries, export those entries, and save only their own favorites. Disabled entries and all editor-grant records are inaccessible to readers. No new global `UserRole`, global auth semantics, role defaults or replacement tokens.
- `super_admin` can manage catalog/health approvals and grant or revoke module editor access for an existing active `admin` ID. An ordinary `admin` without a grant is a Service-Center-only reader; a granted admin can edit the catalog but cannot manage grants. Server resolves user activity and grant on every relevant request; a revoked login token cannot continue writing. Grants and audit actor/target/time are persisted separately and never enter the manifest. Unknown/deleted/disabled targets fail closed. The user selector is visible only to super_admin.
- Forms and import target the same server registry. Favorites derive user ID from Studio authentication, never from a caller-supplied user ID. Treat capability flags as read-only UI hints; enforce every write at the server.

## Health-check policy

- Requests specify service ID, not an arbitrary URL or caller headers. An editor must explicitly approve the registered health URL before GET probes are allowed. Import is not approval; changes to a health URL invalidate prior approval.
- Validate URL scheme, host, DNS answers and destination before a connection; pin the validated address and preserve HTTPS hostname validation. Block metadata, link-local and special internal destinations, including mixed safe/unsafe DNS responses. Approved loopback/LAN/Tailscale routes remain possible. Do not follow redirects, forward authorization or cookies, expose response bodies/headers, or trigger probes just by listing/searching/opening a card.
- Bound concurrent probes, DNS/HTTP time, response bytes, cache and frequency. Return only status/state, checkedAt, and latency, distinguishing unapproved/untested/stale/disabled/redirected/timeout/unreachable from healthy. This is a backend observation only.

## Persistence and storage

- The module owns its private atomic storage: serialized writes, monotonic revisions and rollback on failed write, with mode-restricted files under `config.appHome/service-center`. The global host `SafeFileStore` is not modified; its content stays equal to upstream.
- Existing instance data keeps its shape (`catalog.json`, `editors.json`, `health-approvals.json`, `favorites/<id>.json`); no migration or copy of existing data, no Hermes Agent home, no new credential storage.

## API contract and canonical documents

- API namespace is `/api/studio/service-center`, mounted after the existing JWT middleware and before catch-all routes, and reflected in the host-facing `GET /api/studio/extensions` discovery which returns only installed modules with bounded `{id,version,apiBase,capabilities}` metadata.
- `scripts/generate-openapi.mjs` collects module-owned contracts generically through `scripts/studio-extension-openapi.mjs`: it executes only a real, non-symlinked `modules/studio/extensions/<id>/openapi.mjs` whose contract id matches its directory, and rejects any extension route outside `/api/studio/<id>/`, any path/operation-id collision, and any mutation of a host path or host schema. `docs/openapi.json` preserves every upstream path.
- `scripts/check-studio-extension-boundary.mjs` is the executable dependency boundary: allowed changed paths, required upstream-equal core files, tracked manifest/version and the module import-boundary scan.

## Scope, evidence and release gate

- Equality with upstream is required for `packages/client/src/router/index.ts`, `packages/client/src/components/layout/AppSidebar.vue`, all eleven `packages/client/src/i18n/locales/*.ts` files and `packages/server/src/modules/studio/public/safe-file-store.ts`. Built-in navigation entries keep their upstream array; the module uses a separate appended slot.
- Cover validation, atomicity, revisions, persistence restart, actual admin/grant/revoke with unchanged global roles, personal favorites, health SSRF/DNS/redirect/timeout/body limits, module off/absent/incompatible/init-failure, route collision, dependency boundary and API-contract consistency, plus a real isolated authenticated preview. Use separate fixture homes/ports; no gateways, jobs, production data or external service mutation.
- Deliver code/tests/schema/OpenAPI, source provenance, change catalog, screenshots, exact focused test/build results and private preview evidence. Push only the authorized feature branch to the authorized fork after review of private-data exposure; verify the exact remote SHA. Independent native QA reviews the same Kanban card. Formal Studio cutover needs separate Boss approval and is not part of this feature branch.
- Dashy (`Lissy93/dashy`, MIT) is a concept reference only for manifest/editing ideas; see `SOURCES.md`. No private service inventory, host path, credential or fixture state is committed to this branch.