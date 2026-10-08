# Personal Agent changelog

## PA01 / QA-07 / public package artifact — 2026-10-08

- Emit the already-declared `packages/personal-assistant/dist/index.cjs` main/default export and its source map alongside the existing native ABI 2 companion; retain the standalone node/MCP build. No manifest/version, wire, dependency, native safety or authorization change.
- Add a real consumer regression through main and package self-export, also relocated with only manifest/schema/dist and no source/repository fallback. Exercise receiver search/read/create/expected-hash overwrite/owner-confirmed delete/status/restore, independent disk readback, conflict, live revoke and persistent unknown/no redispatch; absent native fails closed before state.
- TDD: 5 failing missing-entry cases before fix, then 5 passed on Node26.7.0 and Lab Node24.21.0. Focused 92/92 across 9 files (40 existing safety regressions); original QA package probe 3/3 and revision controls 8/8 plus 4/4 real races preserved on both Node versions. Both official MCP gates still pass 11 calls. Same-card independent QA acceptance remains required.
- Full build/typecheck/native/OpenAPI/harness gates pass, existing Service Center routes are unchanged, and exact-owner Lab module-off smoke remains healthy. Physical-host/Windows, installer/UI and live central Naya verification remain outside PA01.

## PA01 / QA-06 / internal native ABI 2 — 2026-10-08

- Bound each native transfer to the final verified file revision: exact `dev`/`ino`, size, nanosecond `mtime`/`ctime` and bounded bytes. `openat(O_NOFOLLOW)` reopens on the anchored directory fd, compares bytes and named/opened revisions, then performs `linkat`/`renameat`. An edit completed before native entry cannot replace or delete an unapproved regular-file revision.
- Applied the same boundary to staging and owner restore. Proven pre-apply mismatches return `FILE_CHANGED`/409, remove unused staging/trash receipts or release the restore reservation, and retain the newer bytes. Cleanup after a successful link remains outside that rejection seam, so post-apply failures stay durable `unknown` with no redispatch.
- Require internal ABI 2 before receiver state creation; old/unbound adapters fail closed with `PLATFORM_UNVERIFIED`. Wire protocol, package/module versions, auth/grants and SQLite schema are unchanged.
- Added real cross-process replacement, same-inode edits, restored-mtime and same-bytes/different-inode regressions. Focused checks: 87/87 (40 safety tests). QA's original executable probe now preserves all four newer revisions; its eight positive controls still pass. Both tracked and QA official-SDK two-node MCP gates pass with 11 calls each.
- Verified macOS/POSIX loopback only. Linux, physical Windows, separate hosts, UI/installer and live central Naya remain unverified; POSIX rename is not a filesystem-wide compare-and-swap.

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
