# Avatar r3.1 — direct takeover, incumbent API compatibility

Revision: 3.1 (client integration; Studio package 0.7.33 unchanged)
Date: 2026-10-10 Asia/Shanghai
Owner: Naya, explicitly authorized direct takeover; previous task chain archived.

## Delivered approach

Use the approved 50 IP as Logo 128px lossless WebP assets (475126 bytes, largest 14782). Random selection on Account, global Profile, room Agent edit and shared-room guest entry loads only the selected hashed same-origin asset using `fetch(cache:'force-cache')`; successful selected-image promises are reused and failed ones evicted. No gallery prefetch, no AI call, no fifty-image Base64 bundle. Unknown IDs and >16KiB responses fail closed.

To avoid a Studio/Bridge restart just for avatars, this frontend revision uses existing image-only APIs. It converts the single selected WebP to an image data URL at persistence time; these small selected avatars remain inline in legacy list responses. This is explicitly **not** deployment of the staged server URL-reference/migration endpoints. Backend/API contracts and auth are unchanged. Subsequent server URL-reference rollout is not needed for this revision to function and is not claimed complete. Current selected avatar snapshots add roughly 145KB globally and 121KB for the target room rather than 6.91MB and 5.74MB.

Global profile/user writes used native authenticated MCP APIs. Room agent/member migration used explicit owner-authorized avatar-only host maintenance with exact invite-code→room ID/owner binding, a private before snapshot, a single SQLite CAS transaction and non-avatar field equality checks (the same SQL semantics as the staged avatar-only native storage setter). No full Agent PUT, executor replacement, service restart, auth mutation, or message-content change. Verified nine active agents via native GET; the removed legacy local Naya row was also updated to prevent old history image references.

Offline originals and before snapshots remain in the private maintenance directory and are not served by Studio. All 12 current profile SOUL avatar blocks point to the new canonical profile catalog without changing role authority or recovery rules.

## Changed client paths

- packages/client/src/utils/avatar-library.ts
- packages/client/src/api/hermes/profiles.ts
- packages/client/src/api/studio/auth.ts
- packages/client/src/views/hermes/SharedGroupChatView.vue
- packages/client/src/components/hermes/group-chat/GroupChatPanel.vue
- tests/client/avatar-library-compat.test.ts
- docs/change-catalog/avatar-library-r3-takeover.md

Other r3 client consumers/assets are from the previously independently tested 84da976 source. Server source from that candidate remains staged, not promoted into the live server artifact. Publish versioned client chunks first and HTML last, retaining previous chunks for existing tabs; private full client backup supports rollback. Server dist hash/listener/Bridge PID must remain unchanged.

## Focused evidence

Seven tests pass across avatar-library-compat, avatar-library and profile-avatar-library: no fetch on module import, selected-only fetch, in-memory reuse, force-cache, unknown-ID rejection, byte limit and existing rendering/resolver checks. Vite client build passed. Native list readback SHA-256 checked all twelve installed WebP avatars and nine active room agent images. Local and Tailscale hashed icon fetch matches original SHA256 and returns image/webp; incumbent static handler has max-age=0 with Last-Modified, so normal browser requests may revalidate (304). Selected-image fetch uses force-cache plus application reuse; do not falsely claim immutable HTTP cache headers are live.

Final browser/network and exact payload receipts are retained under /Users/garbagod/.hermes/maintenance/avatar-r3-takeover, not committed because they can contain private room data. No full unrelated tests or server rebuild/restart required.
