# Group Agent host access — local feature r2

- Date: 2026-10-10
- App version base: 0.7.31 (local feature r2; **not** an official 0.7.32 release)
- Change ID: `group-agent-host-access-r2`
- Scope: one owner-owned local/server Agent in one group room. No global profile permission and no deployment in this change.

## Changed paths

- `packages/server/src/modules/studio/infrastructure/database/schemas.ts`: `gc_room_agents.hostAccessEnabled INTEGER NOT NULL DEFAULT 0`; schema synchronizer adds the column to existing tables.
- `packages/server/src/modules/studio/sockets/group-chat.ts`: persist, select, and broadcast the flag; new/remote/removed Agents default to off; changing engine or profile resets it, while name/avatar edits preserve it.
- `packages/server/src/modules/studio/services/group-chat/{access,host-access,agent-clients,agent-prompt}.ts`: owner-only configuration and per-invocation, persisted-message-based same-owner handoff validation; only the workspace restriction relaxes, not credential, sensitive-data, or private-memory rules.
- `packages/server/src/modules/studio/{middleware/auth,controllers/group-chat,routes/group-chat}.ts`: managed-run credential marker, authenticated creator attribution for new local Agents, and narrow owner-only flag endpoint; disabling persists off before a target-only interrupt. No executor replacement when changing this flag.
- `packages/client/src/{api/studio/group-chat.ts,stores/hermes/group-chat.ts,components/hermes/group-chat/GroupChatPanel.vue,i18n/locales/*.ts}`: Edit Agent control and translations for all 11 locales.
- `scripts/generate-openapi.mjs`, `docs/openapi.json`: canonical generator and generated API contract.
- `tests/server/{group-chat-host-access,schema-sync,group-chat-routes-baseline}.test.ts`, `tests/e2e/group-chat-room-deeplink.spec.ts`: focused security, migration, creator attribution, and UI coverage.

## Contract and security boundaries

`PUT /api/studio/group-chat/rooms/{roomId}/agents/{agentId}/host-access` accepts `{ "hostAccessEnabled": true|false }`, with a JSON **boolean**, not a string or number. Only an active authenticated user with positive numeric `user.id === room.ownerAuthUserId` may call it; a managed-run MCP credential is denied even if bound to that user. Target must be an active local/server room Agent owned by `auth:<owner id>`, or a legacy server-local row with blank owner and no remote connector/origin. The latter is atomically attributed to the room owner by the targeted flag setter; explicit foreign ownership and remote connectors are never claimed. Successful response returns `{ agent, agents }` with the stored integer flag (0 or 1). It does not implicitly change an Agent's profile, runtime, preset, or global access mode.

At each Agent-to-Agent invocation the recipient's flag and both Agent records are read from storage, along with the message identified by the persisted `messageId`. Grant requires a saved assistant Agent message with the same room, `senderId`/`senderAgentRecordId` matching the active sender record, and both Agents owned by that room's authenticated owner (including legacy blank-owner local senders without connector/origin). Guest humans, remote Agents, removed Agents, explicitly foreign-owned Agents, rooms without an authenticated owner, stale queued recipients, and mismatched sender claims fail closed. This is prompt-level permission guidance, **not** an OS-level sandbox or filesystem ACL; credentials and private information remain prohibited by the prompt, and a tool/runtime with independent authority still needs its own safeguards.

Turning the flag on leaves active runs untouched; a subsequent eligible invocation sees it. Every off request (including an off retry) first persists 0 and broadcasts the updated roster, then confirms **only that Agent** is interrupted or idle if registered. Concurrent updates for the same Agent are rejected during revocation. If the interrupt cannot be confirmed, API returns 503 even though the flag is already 0; the owner must retry or verify the Agent is idle. Already completed or in-flight side effects cannot be undone. Legacy Agents can be configured without recreation, but only through the authenticated room-owner endpoint. The Edit Agent toggle sits directly between Agent and Profile selectors, with the risk hint visible in captured desktop/mobile ON/OFF evidence. Do not copy the flag into clones, presets, or remote connectors.

## Test results

- `npm run test -- tests/server/group-chat-host-access.test.ts tests/server/schema-sync.test.ts tests/server/group-chat-handoff-security.test.ts tests/server/group-chat-room-serialization.test.ts tests/server/group-chat-routes-baseline.test.ts`: **5 files, 67 tests passed**.
- `npx playwright test tests/e2e/group-chat-room-deeplink.spec.ts -g 'owner saves and reloads per-Agent host access' --workers=1`: **2 Chromium tests passed**, desktop 1280px and mobile 390px; actual ON/OFF screenshots under `test-results/group-chat-room-deeplink-*/host-access-*.png`. Mocked backend and socket; not a live runtime handoff.
- `npx tsc --noEmit -p packages/server/tsconfig.json`: passed. Full build was run for r1 but **not rerun for r2**; parent composite build remains pending.

No commit, push, npm release, or live service restart. Integration requires merging this scoped worktree diff into the intended release source, rebuilding Studio, and a separately approved rollout/restart. Production behavior and OS-level enforcement were not exercised here.
