# PA01 receipt — bounded cross-device file core, receiver and MCP

Card: `t_ca822df3` (naya-native-kanban/v1). Slice: PA01 only. Owner of the acceptance
decision remains Naya; this document records what was actually built and executed.

## Implemented (real code, exercised)

- `packages/personal-assistant/` is a transport-neutral pure package (no Studio, Electron
  or private DB/auth import). It owns the canonical protocol schema at
  `packages/personal-assistant/protocol.schema.json` (protocol v1, module `0.1.0`,
  engine `0.1.0`) and the receiver-owned bounded operations.
- Receiver (`src/receiver.ts`, `src/files.ts`, `src/receipts.ts`):
  - root allowlist bound at configuration time by `dev`/`ino` + `realpath`, re-verified on
    every request; a caller never supplies an absolute root during an operation;
  - explicit owner-scoped grants with independent `search`/`read`/`write`/`delete`
    capabilities and a monotonic `grantRevision`; revocation is rechecked from durable
    state on every request, including an already-open connection;
  - filename + UTF-8 content search with bounded depth/entries/bytes/time and a
    HMAC-signed cursor bound to query, mode, limit, workspace and grant revision;
  - bounded read with real byte range, full-file SHA-256, honest `truncated`, and refusal
    to parse binary as Office/PDF;
  - create-only vs `expectedSha256` overwrite with a per-path lock, `O_NOFOLLOW` +
    `nlink === 1`, atomic `rename`/`link` replacement, directory fsync and real readback;
  - single regular-file soft delete gated on `expectedSha256`, an owner-minted
    single-use confirmation bound to target/path/operation, private trash, restorable
    receipt and a real restore readback;
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
- MCP `initialize`/`tools/list` plus real `personal_search`/`personal_read` tool calls
  returned the same target results.
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
(`python3 scripts/personal-lab-module-off-smoke.py`): `health=ok`,
`webui_version=0.7.31`, discovery `401` unauthenticated and `200` authenticated with
`extensions=[]`, `personal-agent` absent, and `/api/studio/personal-agent/state` `404`
while the flag is off. The Lab was then restarted through the exact-owner script (new
exact-owned PID, health `ok`, production Bridge `80660` still ready) so the PA00 handoff
condition is restored.

## Publication

- Branch `feat/personal-assistant-files` pushed to the verified fork origin
  (`https://github.com/over01470914/ekko-studio.git`).
- Remote readback SHA: `7720580ab45effde6828c18df07b5c1399e23436` (matches local `HEAD`).
- No PR, release, tag, npm publish or production cutover was performed.
- Retained two-node acceptance artifacts:
  `/Users/garbagod/.hermes/profiles/developer/cache/scratch/pa-accept-lJRK34`
  (`acceptance-evidence.json` contains no credential; the mode-0600 peer configs hold
  generated fixture tokens only).

## Verification commands (results in the card metadata)

```
node node_modules/vitest/vitest.mjs run tests/personal-assistant/engine.test.ts \
  tests/personal-assistant/transport.test.ts tests/server/personal-agent-module.test.ts \
  tests/server/personal-agent-contract.test.ts --no-file-parallelism
node node_modules/vitest/vitest.mjs run tests/server/studio-extension-registry.test.ts \
  tests/server/studio-extension-openapi.test.ts tests/server/studio-extension-boundary.test.ts
npm run openapi:generate
node scripts/personal-agent-build.mjs
node scripts/personal-agent-acceptance.mjs
npm run build
python3 scripts/validate-personal-agent-catalog.py
```