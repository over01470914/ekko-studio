# Personal Agent changelog

## PA01 / engine 0.1.0 / module 0.1.0 / protocol v1 — 2026-10-08

- Reworked `files.ts`/`receiver.ts` onto a minimal internal POSIX N-API adapter (`native/posix.c`, `src/posix.ts`): path resolution and every mutation now run on directory file descriptors (`openat`/`fstatat`/`linkat`/`renameat`/`unlinkat`/`fdopendir`), so a root/parent/leaf swap cannot redirect a read or write outside the allowlist. The previous absolute-string path plus `realpath` recheck had a TOCTOU window; it is gone rather than patched. A missing/unloadable adapter fails closed with `PLATFORM_UNVERIFIED` (503) before any state is created.
- Post-apply outcomes now stay `unknown`: create/overwrite/delete mark the operation uncertain before crossing the first target-changing syscall, and a failed receipt write no longer masks a committed mutation as `rejected`; restore takes a durable reservation (`restored=2`) so a crash or cleanup failure is never retried.
- Fixed the default bounded read of long multi-byte UTF-8 text: an implicit upper bound now backs off to a complete code-point boundary and reports the real `byteLength`/full-file hash/`truncated`, while an explicit misaligned range or offset still fails.
- Restore's generated OpenAPI 200 now declares the actual `PersonalResponse` envelope, with an executable route/schema consistency test.
- Extended the tracked two-node acceptance to drive all four operations plus status through the official `@modelcontextprotocol/client` (owner-minted delete confirmation, no self-approval) with independent receiver disk readback, and hardened the native identity comparison to exact 64-bit inode values.
- Added `tests/personal-assistant/safety-regressions.test.ts`: real-syscall race regressions against the rebuilt artifact, not a mocked filesystem.

- Reconciled architecture amendment r7 into `SPEC.md`: personal mode is a gateway/client for the same existing central Naya, requires no local model/provider/profile setup, cannot manage the central runtime, and PA00's dummy lab config is defensive compatibility only. PA01's receiver/MCP scope is unaffected.
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
