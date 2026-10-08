# Personal Agent changelog

## PA01 / engine 0.1.0 / module 0.1.0 / protocol v1 — 2026-10-08

- Added the transport-neutral `packages/personal-assistant/` engine with canonical protocol v1 JSON Schema as the single source of truth.
- Implemented receiver-owned root allowlist, owner-scoped grants with immediate revoke on open connections, bounded filename+UTF-8 search with signed cursors, bounded read+hash, create-only vs expected-hash atomic overwrite with real readback, and owner-confirmed single-file soft delete with a restorable receipt.
- Added durable payload-bound operation receipts with unknown-state recovery that never redispatches a mutation on another transport or device.
- Added the Studio `personal-agent` extension module and `/api/studio/personal-agent/*` OpenAPI contract, registered off by default and composed from bootstrap; the Service Center module is unchanged.
- Added a scoped stdio MCP pilot exposing search/read/write/delete/operation-status with no credential in stdout, results or logs.
- Verified through real same-machine two-node loopback protocol acceptance plus the official MCP client, with independent target-root readback. Physical Windows/host-to-host behavior remains explicitly unverified.

## PA00 / isolation harness 1.0.0 / specification r6 — 2026-10-08

- Created feature worktree from pinned fork baseline, leaving production checkout and Composer WIP unchanged.
- Added exact-owner Lab lifecycle with independent state/home, random nondefault login, private Bridge endpoint, no gateway/MCP/skill/discovery side effects and no shared production proxy.
- Executed baseline build, authenticated/unauthenticated API smoke and real start/stop/restart with unchanged production Bridge/control-file fingerprints.
- Fixed seed script timer exit and prevented the Tailscale mirror listener from being mistaken for the Lab process owner.
- Captured real baseline UI in a separate browser context. No personal mode, remote files, native installer or cross-device completion is claimed by PA00.
- Locked sequential vertical slices, module version 0.1.0 target, file protocol v1 and independent same-card review.
