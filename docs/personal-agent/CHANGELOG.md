# Personal Agent changelog

## PA00 / isolation harness 1.0.0 / specification r6 — 2026-10-08

- Created feature worktree from pinned fork baseline, leaving production checkout and Composer WIP unchanged.
- Added exact-owner Lab lifecycle with independent state/home, random nondefault login, private Bridge endpoint, no gateway/MCP/skill/discovery side effects and no shared production proxy.
- Executed baseline build, authenticated/unauthenticated API smoke and real start/stop/restart with unchanged production Bridge/control-file fingerprints.
- Fixed seed script timer exit and prevented the Tailscale mirror listener from being mistaken for the Lab process owner.
- Captured real baseline UI in a separate browser context. No personal mode, remote files, native installer or cross-device completion is claimed by PA00.
- Locked sequential vertical slices, module version 0.1.0 target, file protocol v1 and independent same-card review.
