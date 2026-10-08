# Personal Assistant implementation contract r6

Owner: Naya/default. Date: 2026-10-08 Asia/Taipei.
Base: fork commit 4874651e1a39df252361df2219294e6fdafe65af.
Working copy: /Users/garbagod/projects/ekko-studio-personal-agent.
Branch: feat/personal-assistant-files. Production checkout and 8648 are out of scope.
Module target version: 0.1.0; file protocol/schema v1; native Desktop Lab target 0.7.31-personal.1 (unpublished prerelease, not official upstream release). The root Studio version must remain 0.7.31 until packaging needs an explicitly scoped prerelease override; do not claim a binary release from a document revision.

## Goal and invariants

Deliver installable Ekko Studio Desktop Personal Lab with a workbench/personal-assistant choice, a central Naya connection preserving verified principal/profile/session, and actual Agent-consumable search/read/write/delete on another authorized device workspace. Use hostname + verified installation device identity + workspace identity + relative path in the UI. Same hostnames and same path strings do not authorize routing.

No fake devices, task completions, generated file listings or model output. New accounts start with empty honest state. Browser smoke, same-machine two-node protocol checks, native Desktop launch, signed installer and real Windows/macOS cross-machine checks are separately labeled.

Keep personal engine, Node endpoint/MCP transport, UI module and host adapters cohesive and separate. Preserve normal chat/runtime/provider/memory/session schema, local session.workspace, existing group relay and raw peer socket. Do not introduce arbitrary shell, PTY, hard-drive search, remote HTML under privileged preload, wildcard CORS, new global worker profiles or production Gateway control.

## Architecture and path scope

- New transport-neutral implementation under packages/personal-assistant/ with versioned public exports and canonical protocol JSON Schema. No imports of Studio private DB/auth/controller/store or Electron.
- New Studio server module under packages/server/src/modules/studio/extensions/personal-agent/ with its own /api/studio/personal-agent/* namespace and OpenAPI contract collected through existing generator.
- New client module under packages/client/src/modules/studio-extensions/personal-agent/. Module-local locale messages/theme and thin injected host adapter only.
- Optional reviewed host paths: both bootstrap/studio-extensions.ts; client extension registry narrow host interface; generic login redirect/mode entry; scripts/ packaging/boundary collector; package manifest only if actually needed. Do not erase Service Center module or weaken existing boundary tests.
- Desktop generic Lab identity/home/channel wiring may touch packages/desktop/src/main/desktop-identity.ts, paths.ts, entry.ts/index.ts and appropriate package overlay. Existing defaults unchanged.
- New tests: tests/personal-assistant/, tests/server/personal-agent*.test.ts, tests/client/personal-agent*.test.ts, tests/e2e/personal-agent*.spec.ts, tests/desktop/personal-lab*.test.ts.
- Documentation/catalog: docs/personal-agent/SPEC.md (this), API/contract/schema, CHANGELOG.md, change-catalog.json and verification artifacts. Each changed file must be catalogued. Catalog strict validator must actually execute.

## Resource/auth contract

WorkspaceRef = {id, deviceId, hostname, label, capabilities, grantRevision}; receiver owns canonical root and never resolves a caller-supplied absolute root during an operation. SessionTarget uses centralInstanceId+verifiedPrincipal+profile+sessionId -> workspaceId+revision without mutating session.workspace.

Status/read APIs require active verified Studio account. Workspace grants are explicit, owner-scoped and support search/read/write/delete independently; revocation enforced by receiver on every request including existing connection. Peer onboarding must use explicit approval through receiver owner and origin/device binding; reuse the verified Ed25519 identity seam via injected narrow host functions or independently reviewed scoped capability tokens, not native full-shell approval as a permission model. Sender credentials stay server-side in a mode-0600 secret store; do not return tokens/private roots to renderer or normal DTOs. Remote endpoints fixed approved origins, no redirect credential leakage, no arbitrary open proxy. Unknown or unsupported capability fails closed.

First iteration may exercise HTTP/MCP on two real local node processes with private fixture roots and approval, clearly labeled same-machine protocol verification. It must not claim another physical Windows machine was exercised. Expose true registered nodes, not synthetic fixtures as user state.

## Canonical file operations

Requests specify stable operationId, deviceId, workspaceId, grantRevision and relative path (or bounded query). Results include target identity, workspaceId, operationId, outcome and current file revision/hash. Document the exact DTOs in authoritative JSON Schema/OpenAPI in the implementation.

- search: filename and UTF-8 content, bounded recursive scan, limits on depth/entries/bytes/time; pagination/cursor bound to query/workspace revision. Return hasMore/nextCursor/truncated consistently, not a list disguised as search.
- read: bounded regular-file reads/ranges; return actual bytes/text, byte size, hash and truncation/range; binary read must not be claimed as parsed Office/PDF.
- write: create-only distinct from overwrite; existing requires expectedSha256, path lock and atomic replacement, actual readback. Permission/root/grant checked just before apply; reject conflicts. No silent truncated writes.
- delete: exact single regular file, expectedSha256, explicit receiver delete grant and user confirmation binding; soft-delete to contained private trash with restorable receipt. Reject batch/recursive/root/permanent deletes. UI delete confirmation must name host/workspace/path.
- operation status: durable receipt and deduplication payload hash; uncertain mutation consults operation state and never silently redispatches on another transport/device. Do not claim general exactly-once under crashes; ambiguous states marked unknown.

Deny traversal/absolute paths/UNC/ADS, sensitive files, symlink/reparse escapes (including parent components), cross-root/device/account, malformed payloads and grant mismatch. Windows behavior requires actual platform verification, not Unix O_NOFOLLOW assertions. Receiver root and metadata/trash must not overlap shared fixture content in unsafe ways. Avoid publishing secret contents in logs/results/search.

## Central Naya mode

New mode is presentation/transport, not runtime scoped/global or another local Agent writer. Desktop local trusted renderer/server stays local. Dedicated server-side central connection adapter uses public authenticated session/run/events APIs. No /api/studio/sessions/* or chat-run internal delegation. User-requested central product flow may create/select a dedicated verified test session, but must not alter/delete this current session or existing production work. Prevent fixture prompts entering durable memory where supported; label anything not controllable.

Origin-scoped auth; no forwarding existing local JWT to central origin. Credential entry through masked/vault/approved UI mechanism only, never ask the owner to paste secrets in chat. Normal new UI can be unconfigured/empty; central inference is not forged. Mode switch/close does not cancel or repeat central mutations/tasks. Missing central auth/connectivity is truthful unavailable state, not silent Mac fallback.

Device file tools are consumed by Naya via a real MCP stdio/HTTP toolset with versioned schemas. Demonstrate initialize/tools/list and actual tool calls, not only UI file-browser actions. Do not change default profile's MCP configuration without Naya's coordinated authorized installation; implement configuration artifact and controlled pilot first.

## Isolation harness r1 (already exercised baseline)

scripts/personal-lab.py start/stop/status uses exclusive source/state roots, min environment, random seeded nondefault account, disabled gateway/MCP/skill/discovery, explicit private Unix Bridge path and no production proxy fallback. Its HTTP listener may be exposed by the user's existing Tailscale loopback forwarder, so application authentication is required before start. Do not alter forwarding policy.

Baseline run start/stop/restart passed while production Bridge PID80660 remained ready and production config/SOUL/MEMORY hashes remained unchanged. Baseline lab Agent Bridge is unavailable (empty isolated runtime), so only shell/UI isolation is proven, not Naya connectivity. Do not fill it by sharing production Bridge.

Lab root: /Users/garbagod/Library/Application Support/ekko-personal-lab; port4362. Only this owner's processes may be restarted/stopped. Do not global CLI stop, killall, launchctl production, reuse production tokens/state or copy live SQLite. Worktree node_modules/dist/cache are independent. Create a unique native package identity/appId/userData/lock/feed; do not install over /Applications/Ekko Studio or Hermes app.

## Ordered vertical slices and review

PA01: pure kernel + receiver/remote typed file endpoint and MCP, canonical schemas, real two-node scratch protocol acceptance. UI not in this slice. Independent same-card qa review before PA02.
PA02: personal UI/mode entry + central authenticated transport + Desktop Lab isolation packaging. Reuse PA01 public interface. Honest absent state, real browser interaction desktop/compact screenshots and native local window. Independent same-card qa review before delivery.
PA03: Naya integration/package/deployment acceptance and real-device gate. Inspect exact branch commit, complete build/module-off smoke/native package, real Agent-issued calls, target identity, installer and actual remote target receipts. If Windows/central authorization unavailable, return precise capability/input blocker with usable tested lab artifact; do not mark overall product complete.

All cards use naya-native-kanban/v1, one writer per worktree, native parent dependencies. Developer and reviewer use native Hermes, NOT Codex CLI/App Server. Model uses current authorized profile route/task snapshot, no provider config changes. Review topology: same-card request_review(reviewer='qa'); no parallel shadow QA writer or pre-created QA child.

## Verification and delivery

Focused tests per slice, protocol schema validation, npm run build when host UI/types/backend/bundle changed; native desktop build for installer slice. No unrelated full-suite cleanup. Each slice updates version/contract/catalog, commits only its paths, pushes only feature branch to fork origin, readbacks exact remote SHA; never merge upstream/default branch or publish npm/GitHub production Release. Missing catalog or tests prevents complete.

Substantial auth/file mutation design requires independent reviewer, frozen real evidence, in-contract rework on same card. Preserve existing Service Center behavior and normal routes. Final artifacts: actual screenshots, usable lab URL, commands to stop/rollback only lab, build/version/commit + remote SHA, tests and explicit unverified cross-device dimensions.

Board supervisor is board-scoped native observer with exception-only Bot Chat wake and passive completion Feishu notify, no mutation authority. Owner remains Naya. Routine progress in current Studio card; final or blocker packet to authorized channel. A plan/task creation is not a delivered product.
