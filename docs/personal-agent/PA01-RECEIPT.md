# PA01 receipt — bounded cross-device file core, receiver and MCP

Card: `t_ca822df3` (naya-native-kanban/v1). Slice: PA01 only. Owner of the acceptance
decision remains Naya; this document records what was actually built and executed.

## Implemented (real code, exercised)

- `packages/personal-assistant/` is a transport-neutral pure package (no Studio, Electron
  or private DB/auth import). It owns the canonical protocol schema at
  `packages/personal-assistant/protocol.schema.json` (protocol v1, module `0.1.0`,
  engine `0.1.0`) and the receiver-owned bounded operations.
- Receiver (`src/receiver.ts`, `src/files.ts`, `src/posix.ts`, `native/posix.c`, `src/receipts.ts`):
  - root allowlist bound at configuration time by exact 64-bit `dev`/`ino` + `realpath`, then
    reached through an anchored descriptor chain: each path segment is re-typed with
    `fstatat(AT_SYMLINK_NOFOLLOW)` and opened with `openat(..., O_NOFOLLOW)`, and the resulting
    `fstat` identity must match, so resolution and the operation that follows share one
    descriptor instead of an absolute path string. A caller never supplies an absolute root
    during an operation;
  - explicit owner-scoped grants with independent `search`/`read`/`write`/`delete`
    capabilities and a monotonic `grantRevision`; revocation is rechecked from durable
    state on every request, including an already-open connection;
  - filename + UTF-8 content search with bounded depth/entries/bytes/time and a
    HMAC-signed cursor bound to query, mode, limit, workspace and grant revision;
  - bounded read with real byte range, full-file SHA-256, honest `truncated`, and refusal
    to parse binary as Office/PDF;
  - create-only vs `expectedSha256` overwrite with a per-path lock, `O_NOFOLLOW` +
    `nlink === 1`, dirfd-relative `linkat`/`renameat` replacement, directory fsync and real
    readback; the operation is marked uncertain before the first target-changing syscall so a
    post-apply failure reports `unknown`, never `rejected`;
  - single regular-file soft delete gated on `expectedSha256`, an owner-minted
    single-use confirmation bound to target/path/operation, private trash, restorable
    receipt and a real restore readback; restore takes a durable reservation and moves the
    file with `linkat`+`unlinkat` on the anchored trash/target descriptors;
  - durable payload-hash-bound operation receipts in SQLite (`node:sqlite`), a
    single-instance lock file, and `unknown` for any reservation that was never
    completed; an unknown operation is never redispatched on another transport/device;
  - stable reason codes only; no OS exception, path, credential or file body is reflected.
- Studio server module (`packages/server/src/modules/studio/extensions/personal-agent/`)
  with the `/api/studio/personal-agent/*` namespace, installed through the existing
  extension registry and OpenAPI collector. One fixed module id, **off by default**
  (`STUDIO_PERSONAL_AGENT_ENABLED=1` gates it); absent/off/incompatible leaves the core
  and the existing Service Center module untouched.
- MCP (`src/mcp.ts`) with a scoped stdio transport and `personal_search`, `personal_read`,
  `personal_write`, `personal_delete`, `personal_operation_status`. The MCP transport can
  only call the four file operations and status; the delete confirmation and grant
  mutation stay on the receiver owner's local control channel, so a sender cannot mint its
  own delete approval. No credential appears in stdout, tool results or logs.

## Same-machine protocol verification (real, not physical E2E)

`node scripts/personal-agent-acceptance.mjs` starts **two independent local Node
processes** with separate state roots and separate fixture workspaces, then drives them
over the real loopback HTTP receiver and the **official `@modelcontextprotocol/client`**
over stdio:

- search (`granite` content match on `report.txt`), bounded read (`granite 內容 alpha`,
  matching SHA-256), create-write, owner-confirmed soft delete, restore;
- independent target-root readback inside the target fixture proves the mutation really
  hit the target workspace (`created` = `real two-process write`, then `restored` = the same
  bytes);
- MCP `initialize`/`tools/list` plus 11 real tool calls through the official SDK: search,
  read, create, `expectedSha256` overwrite, owner-minted-confirmation delete,
  `personal_operation_status` for each mutation, and a read of the owner-restored file. Every
  result is checked against the receiver's own disk contents (independent readback), and the
  tracked script asserts no generated credential or private root appears in tool results;
  the separate QA official-SDK gate additionally checks captured child logs for generated
  credentials. A mismatch exits non-zero.
- Identity differentiation on two real fixtures: the identical relative path `same.txt`
  resolved to `target-identity-content` on `target-device/target-workspace` and
  `sender-identity-content` on `sender-device/sender-workspace` (`distinct=true`), so
  routing follows verified identity rather than hostname or path.

This is same-machine loopback protocol acceptance. It is **not** a physical Windows,
separate-host or remote-network check, and it does not assert Windows escape semantics.

## Architecture amendment r7 reconciliation

Boss correction r7 is recorded in the tracked contract (`SPEC.md` → *Central Naya mode →
Amendment r7*) and catalog: every personal-mode instance is only a gateway/client for the
same existing central Naya; no local model/provider/profile/memory setup and no local
Agent/Bridge lifecycle; a gateway close cannot stop central runtime; PA00's dummy lab
config was defensive full-bootstrap compatibility, not a second assistant. **PA01's pure
file core, receiver, MCP toolset and bounded receiver-authorized tool execution are
unchanged and remain valid under r7** — file nodes stay plain execution endpoints with no
inference loop. Client-only personal-mode startup and central transport are PA02/PA03
scope and are not claimed here.

## Explicitly unverified / honest limitations

- Physical Windows/macOS cross-machine behavior, UNC/ADS/reparse/junction semantics and a
  real second host are **not** verified here. The receiver fails closed on `win32`
  (`PLATFORM_UNVERIFIED`) rather than claiming POSIX `O_NOFOLLOW` implies Windows safety.
- Only the macOS/POSIX implementation was executed; Linux support is not verified by this run.
- No personal UI or installer was implemented; no central Naya connection or real user file
  was touched. Fixtures are generated under the private scratch dir. Credential-free evidence and selected
  fixture state are retained for review; this is not real user data.
- Crash-atomicity across the filesystem/SQLite boundary is not claimed: a crash between
  the trash rename and the receipt update leaves the operation `unknown` for a human to
  inspect, never an automatic retry.
- For QA-06, Lab port `4362` was stopped through the exact-owner script (PID `36219`,
  `portReleased=true`, `productionFingerprintsUnchanged=true`) before rebuilding.
  Production Bridge was already PID `54908` before this run; the earlier `80660` must not
  be used as evidence of continuity for this run.

Recorded QA-06 module-off isolation on the isolated Lab
(`python3 scripts/personal-lab-module-off-smoke.py`, re-run after the QA-06 build):
`health=ok`, `webui_version=0.7.31`, discovery `401` unauthenticated and `200` authenticated
with `extensions=[]`, `personal-agent` absent, and `/api/studio/personal-agent/state` `404`
while the flag is off. At that observation the Lab was running as exact-owned PID `67414`, started by
this worker through `scripts/personal-lab.py` (status verified against the owner record
before start); production Bridge `54908` was `ready` at the recorded stop/start/status observations.
No production lifecycle operation was performed. Honest
fingerprint note: this worker wrote no profile/config/memory, and `~/.hermes/config.yaml` and
`~/.hermes/memories/MEMORY.md` are byte-identical to the PA00 handoff values. `~/.hermes/SOUL.md`
does **not** match the earlier PA01-run value (`69f70d95…` → `1feaa6c2…`), but it already held
the new value when this run's Lab started and is byte-stable across this run's Lab start and
status checks; the change predates this run and was not made by this worker, so no
"unchanged throughout" claim is made for it. The Lab's Agent Bridge is `unreachable` by
design/empty isolate and was not attached to production.

- Receiver containment rework (QA run 2 findings QA-01..QA-05): path resolution and all
  mutations moved onto a package-internal POSIX N-API adapter
  (`packages/personal-assistant/native/posix.c` + `src/posix.ts`) that operates on
  directory file descriptors (`openat`/`fstatat`/`linkat`/`renameat`/`unlinkat`/`fdopendir`).
  A real root/parent/leaf symlink swap can no longer redirect a read, stage bytes outside the
  allowlist, or mutate an outside path, because validation and the operation share the same
  anchored descriptor instead of an absolute path string. `/dev/fd` subpaths and `chdir`
  were measured on this host and do not work, and a `realpath` recheck was rejected as it
  only narrows the TOCTOU window. The adapter is built by
  `scripts/personal-agent-native.mjs` with the local compiler and installed Node N-API
  headers; it contains no shell, adds no dependency, and a missing or unloadable adapter
  fails closed (`PLATFORM_UNVERIFIED`, 503) before any private state is created.
- Post-apply transaction semantics fixed: the operation is marked uncertain before the first
  target-changing syscall, a failing receipt write can no longer re-label a committed
  mutation as `rejected`, and restore takes a durable `restored=2` reservation so a crash or
  cleanup failure reports `unknown` and is never retried (previously an injected EIO on
  cleanup reported `rejected` while the file was committed).
- Default bounded read of long multi-byte UTF-8 text now backs off to a complete code-point
  boundary and reports real `byteLength`/full-file hash/`truncated`; an explicit misaligned
  range or offset still fails (`INVALID_RANGE`).
- Restore OpenAPI 200 now declares the actual full `PersonalResponse` envelope, verified by an
  executable route/schema consistency test rather than a source comparison.
- Native identity comparison uses exact 64-bit `dev`/`ino` (BigInt) rather than a lossy double;
  the pre-existing private installation receipt stays byte-identical because a binding whose
  device/inode does not round-trip through a JSON-safe integer fails closed at configuration.
- `tests/personal-assistant/safety-regressions.test.ts` adds 22 real-syscall regressions run
  against the rebuilt `dist` artifact — root/parent/leaf swaps scheduled at the actual
  `openat`/`linkat`/`renameat` boundary, persistent-swap staging containment, post-apply
  unknown across restart for fsync/readback/receipt failure, native-absent fail-closed, and
  64-bit inode identity. No mocked filesystem.

## QA-06 exact-revision rework (candidate, not QA approval)

QA independently rejected review HEAD `030b73c2088aafd2689f0aa9607d63a2feb517e3` because
dirfd containment alone did not bind a regular leaf's version to the native mutation. The
unmodified QA executable was first rerun on that HEAD: all eight controls passed, but four
real editor processes replaced or edited the approved overwrite/delete target after the
last TS hash read and before native entry. All four unapproved versions were mutated
(`exit 1`). This run fixes the version boundary, not merely its reported outcome.

- `fileRevision` carries exact BigInt device/inode, size, nanosecond `mtime`/`ctime` and the
  already-verified bounded bytes to internal native ABI **2**. Native `linkAt`/`renameAt`
  reopen relative to the anchored directory fd with `O_NOFOLLOW`, compare regular/nlink
  metadata and actual bytes, recheck the named/opened revisions, then apply. Overwrite
  binds both staged source and expected-hash target; delete and restore bind their source
  and require an absent destination. A missing/old ABI is refused before state creation.
- Only native's proven **pre-apply** `REVISION_MISMATCH` maps to `FILE_CHANGED`/409 with
  durable `rejected`. Newer target bytes remain in place; unused staging is removed; a
  rejected delete removes its unused trash DB row; rejected restore releases its reservation.
  The wire/auth/grant/confirmation contracts and SQLite schema are unchanged.
- Cleanup after a successful create link is outside the pre-apply rejection catch. Cleanup,
  fsync, readback and receipt failures after mutation remain `unknown`, including an
  `EEXIST`-coded cleanup failure. An uncertain mutation is never automatically redispatched.
- Regression evidence: initial **14 fail / 22 pass**, then **36/36** after native revision
  binding. Final safety suite is **40/40** (22 prior + 18 added): real separate-process
  replacement/in-place/restored-mtime/same-byte different-inode changes at overwrite,
  delete and restore, changed create/overwrite staging, bounded actual-byte comparison
  with matching stat metadata, old-ABI refusal, and post-link cleanup classification.
  All eight focused files pass: **87/87**.
- The **same QA executable**, not a substitute probe, now exits **0**: eight positive
  controls pass, all four race hooks trigger real editor processes, all four operations
  return `FILE_CHANGED`/409 and status `rejected`, and independent disk readback preserves
  each newer revision (`unapprovedRevisionMutated=false` for all four).
- Both tracked two-node acceptance and QA's official-SDK gate exit **0**, with 11 real
  MCP calls each. The QA gate also proves same-name identity separation, hash conflict,
  owner-confirmation binding, live-session revocation and real `SIGKILL`/reopen
  `unknown` with no redispatch. Normal tool results/logs are credential-free.
- `npm run build`, `npm run harness:check`, server `tsc --noEmit`, and OpenAPI generation
  exit **0**. Regeneration changes no OpenAPI bytes: 5 personal routes / 31 canonical
  Personal definitions; 11 Service Center routes equal PA00 baseline. All three built
  native artifacts (package, standalone, server) have the same SHA-256.

This verifies completed regular-file edits **before native entry**. POSIX `renameat` is
not a filesystem-wide compare-and-swap; this receipt does not claim arbitrary concurrent
writers after the final native check or filesystem/SQLite crash atomicity. No hash or
confirmation requirement was relaxed. Only macOS/POSIX same-machine fixtures were exercised;
same-card QA must independently accept before PA02/PA03 can proceed.

Credential-free run evidence:
`/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa01-qa06-run5-K5g07e/`
(`focused.log`, `baseline-probes.log`, `independent-rework-probes.json`,
`reworked/independent-rework-probes.json`, `build.log`, `harness.log`, `typecheck.log`,
`openapi.log`, `acceptance.log`, `official-mcp-all-operations.json`, `official-mcp.log`,
`module-off.log`, `lab-status.log`). The real `module-off-login-baseline.png` captures only
the existing unauthenticated Lab login (no new personal UI or functional UI acceptance).
The QA executable remains at
`/Users/garbagod/.hermes/profiles/qa/cache/scratch/pa01-qa-t_ca822df3-run4/independent-rework-probes.cjs`;
the official-SDK QA executable is in the sibling `pa01-qa-t_ca822df3-run2` directory.

## QA-07 public package artifact rework (candidate, not QA approval)

QA rejected review HEAD `2480d579de8b4825e70db8d1c26b653f336f161c` for a missing
declared runtime artifact: `package.json` main/default export referenced `dist/index.cjs`,
but the build emitted JavaScript only into the repository's standalone directory.
The original QA probe reproduced both `MODULE_NOT_FOUND` failures while its standalone
receiver control passed. No file-protocol, authorization or native revision rule changed.

- `scripts/personal-agent-build.mjs` now also bundles the public entry into
  `packages/personal-assistant/dist/index.cjs` with its own source map, beside the existing
  ABI 2 native companion. The checked-in main/exports/version remain unchanged. The
  canonical JSON Schema is bundled and remains available through its declared schema export.
- `tests/personal-assistant/public-entry.test.ts` builds through the named command and
  starts fresh real Node consumers through directory main and package self-export. Both
  are also exercised after copying only manifest/schema/dist to a private, source-free
  package directory with no repository output or node_modules fallback. Each consumer
  executes search/read/create/expected-hash overwrite/owner-confirmed delete/status/restore
  with independent disk hash/readback, conflict, immediate revoke and durable unknown
  across reopen with no redispatch. A missing native companion fails closed before state.
- TDD: **5/5 failed** with `MODULE_NOT_FOUND` before the build fix, then **5/5 passed**.
  The same public consumer tests pass on Node **26.7.0** and Lab Node **24.21.0**. Final
  focused verification is **92/92 across 9 files**, retaining all **40** safety regressions.
  QA's unchanged package probe passes all three main/export/standalone controls on both Nodes.
- QA's unchanged revision probe passes **8/8 controls + 4/4 real editor races** on both
  Node versions; newer revisions remain untouched. Both tracked and QA official-SDK gates
  pass **11 real MCP calls** with independent target readback. These reruns are implementation
  self-verification, not an independent QA approval.
- Full build, server typecheck, native/public build, harness and OpenAPI generation exit **0**.
  OpenAPI is unchanged: **5** personal routes / **31** Personal schemas and **11** byte-identical
  Service Center routes. Package/standalone/server native binaries retain the same SHA-256.
- Lab `4362` was stopped only through `scripts/personal-lab.py` after checking exact owner
  PID `67414` and cwd, then restarted as exact-owned PID `4940`. Stop released the port and
  reported unchanged production fingerprints. Module-off smoke again proves health `ok`,
  discovery `401`/`200`, `extensions=[]` and personal route `404`. Production Bridge
  `54908` remained ready at these observations; no production lifecycle operation occurred.
- Current credential-free evidence is under
  `/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa01-qa07-run7-8p6epi/`:
  RED/GREEN/focused logs and JSON, original QA probes, build/harness/typecheck/OpenAPI logs,
  gate-results, native hashes and Lab receipts. `module-off-login-baseline.png` is a real
  **1440x1000 unauthenticated existing Lab login only**, not personal UI acceptance.

The previously documented macOS/POSIX-only, crash-atomicity and post-final-native-check
CAS limitations still apply. No Linux/physical Windows/separate-host/network, UI/installer
or live central Naya acceptance is claimed. Same-card QA must accept before downstream work.

## Publication

- Branch `feat/personal-assistant-files` pushed to the verified fork origin
  (`https://github.com/over01470914/ekko-studio.git`).
- QA-07 implementation SHA: `a4bf70ec9f23f51958a970e18f0aa42ff93fec79`, pushed and read back
  from the exact fork feature ref. This receipt-only successor changes no tested code; its
  final review HEAD/remote SHA is recorded separately in the native card metadata after
  push/readback (a receipt cannot embed its own commit hash). QA-07 is not QA acceptance or release.
- Historical QA-06 implementation SHA: `39e16c47b584e207ce257ed1117d023ada6197c8`, pushed and read back
  from the exact fork feature ref. That QA-06 receipt-only successor changed no tested code;
  its review HEAD/remote SHA was recorded separately in the card's run metadata after push
  and exact readback (a receipt cannot embed its own commit hash).
  The prior containment implementation was `6705ff453fd302c5eaf5b742eaf2073589296634`;
  its receipt/review HEAD `030b73c2088aafd2689f0aa9607d63a2feb517e3` was rejected for QA-06.
  Earlier rejected HEAD `16cd76d91c775a88c7ae2a7e8e2f0fb6f69dc0bc` and receipt
  `7720580ab45effde6828c18df07b5c1399e23436` are historical, not current-head claims.
- No PR, release, tag, npm publish or production cutover was performed.
- Recorded QA-06 tracked two-node evidence:
  `/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa-accept-oP8DlV/acceptance-evidence.json`.
  Recorded QA-06 QA official-SDK independent readback/state:
  `/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa01-qa06-run5-K5g07e/official-mcp-ZAMrMM`.
  Generated private peer configs are not deliverable artifacts.
  QA-07 original-SDK fixture/readback is retained at
  `/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa01-qa07-run7-8p6epi/official-mcp/official-mcp-GjyRuT`;
  exact-head successor outputs are named in the card handoff, not confused with prior receipts.

## Verification commands (results in the card metadata)

```
node scripts/personal-agent-build.mjs
node node_modules/vitest/vitest.mjs run tests/personal-assistant/engine.test.ts \
  tests/personal-assistant/transport.test.ts tests/personal-assistant/safety-regressions.test.ts \
  tests/personal-assistant/public-entry.test.ts \
  tests/server/personal-agent-module.test.ts tests/server/personal-agent-contract.test.ts --no-file-parallelism
node node_modules/vitest/vitest.mjs run tests/server/studio-extension-registry.test.ts \
  tests/server/studio-extension-openapi.test.ts tests/server/studio-extension-boundary.test.ts
npm run openapi:generate
node node_modules/typescript/bin/tsc --noEmit -p packages/server/tsconfig.json
npm run harness:check
node scripts/personal-agent-build.mjs
node scripts/personal-agent-acceptance.mjs
npm run build
python3 scripts/validate-personal-agent-catalog.py
```