# Studio Service Center — sanitized implementation contract r2

This is the tracked, deployment-neutral version of the approved r2 contract for card `t_ae549bfa`. Module revision 1.0.0; JSON manifest schemaVersion 1; permission contract v1. The application release version remains 0.7.26. This feature is an isolated preview, not permission to cut over the formal Studio instance.

## Product and boundaries

- Native Vue 3 / Naive UI Studio module at `/#/service-center`, reachable from the existing sidebar and desktop Web shell. Use cards, category/search/favorites, registration form, versioned JSON import/export. No separate dashboard, iframe, theme framework, launcher, proxy, mobile relay, service lifecycle or credential collection.
- A card opens its exact registered HTTP(S) URL in a new tab with `noopener noreferrer`. Network labels explain whether a service needs Tailscale, LAN, public or local connectivity; backend probe status never implies the user's browser can reach the link.
- One catalog per Studio instance, stored under `config.appHome/service-center`. Runtime saves appear without restarting Studio. Do not seed production URLs in source or bundle private inventory; only use the authenticated import API against isolated preview state.
- Service fields are `id`, `name`, `description`, `url`, `icon`, `category`, `tags`, `network`, `enabled`, `sortOrder`, optional `healthUrl`, optional `healthCheckEnabled`. See `manifest.schema.json` in the server contracts directory. Only HTTP(S) navigation URLs without userinfo or credential-like query keys are accepted. Icons come from a fixed local set; no arbitrary SVG, HTML, remote favicon or executable action.
- Export contains just `{schemaVersion:1,services:[...]}`. Dates, health results, health approvals, editor grants, secrets and personal favorites are never imported/exported. A complete document is validated before write. Import preview is non-mutating; confirm merges by stable ID, preserves unmentioned entries, requires an explicit keep/overwrite decision for each conflict, and checks the expected monotonic catalog revision (409 on stale write). Invalid documents leave the catalog unchanged.

## Permissions and ownership

- All active authenticated users can read enabled catalog entries, export those entries, and save only their own favorites. Disabled entries and all editor-grant records are inaccessible to readers. No new global `UserRole`, global auth semantics, role defaults or replacement tokens.
- `super_admin` can manage catalog/health approvals and grant or revoke module editor access for an existing active `admin` ID. An ordinary `admin` without a grant is a Service-Center-only reader; a granted admin can edit the catalog but cannot manage grants. Server resolves user activity and grant on every relevant request; a revoked login token cannot continue writing. Grants and audit actor/target/time are persisted separately and never enter the manifest. Unknown/deleted/disabled targets fail closed. The user selector is visible only to super_admin.
- Forms and import target the same server registry. Favorites derive user ID from Studio authentication, never from a caller-supplied user ID. Treat capability flags as read-only UI hints; enforce every write at the server.

## Health-check policy

- Requests specify service ID, not an arbitrary URL or caller headers. An editor must explicitly approve the registered health URL before GET probes are allowed. Import is not approval; changes to a health URL invalidate prior approval.
- Validate URL scheme, host, DNS answers and destination before a connection; pin the validated address and preserve HTTPS hostname validation. Block metadata, link-local and special internal destinations, including mixed safe/unsafe DNS responses. Approved loopback/LAN/Tailscale routes remain possible. Do not follow redirects, forward authorization or cookies, expose response bodies/headers, or trigger probes just by listing/searching/opening a card.
- Bound concurrent probes, DNS/HTTP time, response bytes, cache and frequency. Return only status/state, checkedAt, and latency, distinguishing unapproved/untested/stale/disabled/redirected/timeout/unreachable from healthy. This is a backend observation only.

## Scope, evidence and release gate

- Source boundaries: Studio routes/controllers/services/repositories/contracts; Vue view/cards/editor/store/API; only minimal sidebar/router/i18n/bootstrap and OpenAPI wiring. Add strings to every locale; no unrelated changes to agent, auth, desktop packaging or release paths.
- Cover validation, atomicity, revisions, persistence restart, actual admin/grant/revoke with unchanged global roles, personal favorites, health SSRF/DNS/redirect/timeout/body limits, UI flow, and a real isolated authenticated preview. Use separate fixture homes/ports; no gateways, jobs, production data or external service mutation. Seed verified browser interfaces only, record excluded unreachable/retired/API-only entries privately, and confirm public HTTPS destinations are actual applications rather than just redirects.
- Deliver code/tests/schema/OpenAPI, source provenance, change catalog, screenshots, exact focused test/build results and private preview evidence. Push only the authorized feature branch to the authorized fork after review of private-data exposure; verify exact remote SHA. Independent native QA reviews the same Kanban card. Formal Studio cutover needs separate Boss approval and is not part of this feature branch.
