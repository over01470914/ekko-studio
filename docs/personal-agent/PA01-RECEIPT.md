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
  script asserts no generated credential or private root appears in any tool result or child
  log; a mismatch exits non-zero.
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
- No UI, no installer, no central Naya connection, no real user file was touched. All
  fixtures are generated under the OS scratch dir and deleted afterwards.
- Crash-atomicity across the filesystem/SQLite boundary is not claimed: a crash between
  the trash rename and the receipt update leaves the operation `unknown` for a human to
  inspect, never an automatic retry.
- The Lab launcher/`PID4362` listener was stopped by this worker with the exact-owner
  script (`scripts/personal-lab.py stop`, `portReleased=true`,
  `productionFingerprintsUnchanged=true`); it is unrelated to production Bridge
  `PID80660`, which stayed ready.

Live module-off isolation on the isolated Lab
(`python3 scripts/personal-lab-module-off-smoke.py`, re-run after the containment rework):
`health=ok`, `webui_version=0.7.31`, discovery `401` unauthenticated and `200` authenticated
with `extensions=[]`, `personal-agent` absent, and `/api/studio/personal-agent/state` `404`
while the flag is off. The Lab is currently running as exact-owned PID `36219`, started by
this worker through `scripts/personal-lab.py` (status verified against the owner record
before start); production Bridge `80660` stayed `ready` before, during and after. Honest
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

## Publication

- Branch `feat/personal-assistant-files` pushed to the verified fork origin
  (`https://github.com/over01470914/ekko-studio.git`).
- Security-rework implementation commit SHA: `6705ff453fd302c5eaf5b742eaf2073589296634`. The
  pushed branch HEAD is this receipt commit; its exact readback SHA after `git push` is recorded
  in the PA01 card metadata for this run (a file cannot embed its own commit hash), and the
  coordinator can verify it with `git rev-parse origin/feat/personal-assistant-files`. The pre-rework
  implementation SHA `16cd76d91c775a88c7ae2a7e8e2f0fb6f69dc0bc` is the review HEAD that
  QA rejected; `7720580ab45effde6828c18df07b5c1399e23436` was the earlier PA01 receipt SHA and
  is superseded by both.
- No PR, release, tag, npm publish or production cutover was performed.
- Retained two-node acceptance artifacts:
  `/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa-accept-zuUa8N`
  (official-SDK rework run; `acceptance-evidence.json` contains no credential; the mode-0600
  peer configs hold generated fixture tokens only). The earlier PA01 run artifacts remain at
  `/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa-accept-lJRK34`.

## Verification commands (results in the card metadata)

```
node scripts/personal-agent-build.mjs
node node_modules/vitest/vitest.mjs run tests/personal-assistant/engine.test.ts \
  tests/personal-assistant/transport.test.ts tests/personal-assistant/safety-regressions.test.ts \
  tests/server/personal-agent-module.test.ts tests/server/personal-agent-contract.test.ts --no-file-parallelism
node node_modules/vitest/vitest.mjs run tests/server/studio-extension-registry.test.ts \
  tests/server/studio-extension-openapi.test.ts tests/server/studio-extension-boundary.test.ts
npm run openapi:generate
node scripts/personal-agent-build.mjs
node scripts/personal-agent-acceptance.mjs
npm run build
python3 scripts/validate-personal-agent-catalog.py
```