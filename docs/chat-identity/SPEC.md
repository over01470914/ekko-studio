# CI01 chat author identity — specification r1

Project: p_91802335 / ekko-chat-identity
Change ID: CI01; app version: 0.7.31; fix revision: r1
Specification owner: Orchestrator; intake card: t_9c42371f
Recorded: 2026-10-10, Asia/Taipei (UTC+08:00)
Policy: naya-native-kanban/v1; chat-identity-r1; universal-supervision-v1.1
Status: specification complete; implementation and independent QA NOT TESTED.

## Authority, evidence and environment

Naya's card and operator comment authorize read/search specification work without a terminal in the restricted Orchestrator profile. All process/Git/hash/install/build/browser/merge checks are delegated to the sole software-engineer. Source references below are actual local read/search findings, not runtime or QA results. No execution results are implied.

Operator-supplied baseline: isolated directory `/Users/garbagod/projects/ekko-studio-chat-identity`, branch `fix/chat-author-identity`, base `299e20cf25cce5b62115bcf245aef80cbb16af4d`; live directory `/Users/garbagod/projects/hermes-studio`, same supplied HEAD, live branch `feat/composer-model-steps-fast-mode`, 46 tracked and 33 untracked WIP entries protected. Reported server PID6232/8648 and Bridge PID6423 remain untouched. Supplied upstream main is `46ae5f6fc78bc98be68d4e11fc850538aa030d53`, origin main `deeacaf1e0898f8c4a0a0103cb0ca9a6bf575fd2`. Engineer must independently capture current Git state, fresh upstream SHA and before/after live guards; do not claim these are freshly verified here.

Read AGENTS.md, DEVELOPMENT.md, ARCHITECTURE.md and all eight AGENTS first-read entries (including the six docs/harness documents). No project-owned PROJECT.md was established by discovery; this approved task and specification provide the project contract, not an invented project file. File reads/search are the investigation path. A `.codegraph` directory is now visible, but no graph query/index validity was established; do not claim CodeGraph evidence.

## Root cause and boundaries

Operator-supplied trigger: a persona avatar was written through `PUT /api/hermes/profiles/default/avatar` on 2026-10-09 22:26:53+08; the authenticated account remained distinct. This is a rendering boundary defect, not evidence of account/avatar persistence corruption.

Local causal chain:

1. `api/hermes/profiles.ts:3-10,23-28,62-64` defines a persona (`name`, `alias`, profile avatar); `stores/hermes/profiles.ts:11-15,34-55` exposes reactive selected profile state.
2. `MessageList.vue:186-196` takes session.profile OR the global selected profile OR `default`; maps that persona alias/avatar into human props.
3. `MessageList.vue:718-723` supplies those props to MessageItem. `MessageItem.vue:1026-1033` renders them as the human author. A persona image update therefore changes human presentation without an account change.
4. Actual account is a separate store: `stores/account.ts:7-11` and `api/studio/auth.ts:37-69` source account username/avatar from `/api/auth/me` and `/api/auth/avatar`. Sidebar (`PageSidebarFooter.vue:24,35,92,109`) and Settings (`AccountSettings.vue:15-16,76-77,96-97,109-110,130`) already share this store.
5. Account reuse introduces a second risk: `account.ts:15-24` applies both settled responses without an auth-generation guard, permanently caches success, and blindly clears pending. Late old requests could replace a new account or clear newer pending work.
6. `api/client.ts:32-46,239-259` already invalidates on server/token changes, logout, local 401 and disabled-account 403. Ordinary forbidden 403 is NOT a global logout. Reuse `api/auth-invalidation.ts:4-11`; do not create a second auth architecture.

Identity domains MUST stay separate:

- Account: current authenticated Studio human. Profile authorization is not proof of authorship.
- Persona: explicitly selected session agent profile, never a human fallback.
- Runtime: Hermes/Ekko/coding product branding; never an account.
- Room member: room-scoped sender/member identity, potentially a guest; never indiscriminately replaced by account/profile.
- Historical/shared author: actual sender evidence if supplied; otherwise unknown human, not the viewer or sharer.

## Canonical contract evidence (unchanged)

`modules/studio/routes/auth.ts:15,18-19` and `controllers/auth.ts:49-71,99-107` resolve the authenticated account by ctx.state.user.id. `/api/auth/me` returns `{user}` including id/username/avatar; `/api/auth/avatar` returns `{avatar}` (serialized account avatar). The client accepts `image` or `default`; persona avatar accepts `generated` or `image`. No conversion may mutate either API or storage.

`api/studio/sessions.ts:5-45,54-84`, `stores/hermes/chat.ts:92-122,464-510` do not expose canonical per-message account authorship. The server repository has a session `user_id` (`repositories/session-store.ts:15-24`) but no per-message author in `HermesMessageRow:59-76`. Do not equate that session field with every historical message author or invent its transport. Session access is profile-based (`controllers/sessions.ts:135-155`), so multiple authorized viewers are possible.

Session sharing (`services/session-shares/service.ts:105-122,169-176`, `access.ts:48-51`) authorizes a recipient and resolves a resource owner. Neither a share owner nor a recipient name proves all message authors. No cross-user avatar fetch, API extension, server change, or schema migration is authorized.

## Authoritative r1 design decisions

### D1: human rendering and provenance

Preserve MessageItem's existing `userProfileName`/`userProfileAvatar` prop names for compatibility; their values represent an explicitly resolved human, NOT an agent profile. Do not globally fetch the account inside MessageItem or silently override explicit caller identity.

Account username and accountStore.profileAvatar are the sole reactive account display source; existing ProfileAvatar generates the same username-seeded default as Sidebar/Settings. Uploaded and randomized account images already become `image` values. Keep these semantics; do not change the shared avatar component or introduce names such as the owner's/persona's actual names into production code.

Account display is permitted only for input proven locally submitted by the current authenticated account generation. Merely having a token, rendering MessageList, possessing profile access, matching content/timestamps, a uid-looking ID, or session.isLocalOnly is NOT authorship proof. Historical/peer/API/channel/workflow/shared/public/guest inputs with no sender evidence retain an existing explicit sender identity or neutral fallback. Existing `default`/null MessageItem fallback is acceptable in r1 because it is non-personal; do not introduce an unlocalized new string.

A small client-only identity composable maintains a bounded account-generation/session/message-ID provenance registry. During the authorized 2026-10-10 integration, the store gained an explicit `onLocalUserMessage` publication seam at the exact local message creation boundary, after any awaited model-preset write. The composable must not infer provenance from action timing, transcript mutations, content, timestamps, or Promise settlement. Queue/dequeue copies retain proof only for the exact session/message ID. Clear proof on auth invalidation and account disposal; do not persist it or transfer it across identities. Reload with lost proof falls back to neutral. This supersedes the historical synchronous-observer proposal and its old source-line assumptions.

If the engineer cannot establish reliable local-origin proof using existing actions/readable state inside allowed composable/types/component files, BLOCK with evidence and propose a narrowly scoped chat-store seam for Naya approval. Do not edit `stores/hermes/chat.ts` implicitly or downgrade to account-labeling every user row. This is a safety gate, not authorization for that hot-file change.

HistoryMessageList keeps unknown historical human rows non-personal, including HistoryView and Kanban drawer. A resumed interactive session must not relabel preloaded or peer history as the viewer; newly proven local input in that session can display its current account. After a full reload, even the viewer's own old messages may be generic because existing canonical data cannot prove authorship. This explicit limitation is the approved no-schema fallback, not a claim of historical identity recovery.

### D2: assistant investigation outcome — retain branding for this fix

Do NOT expand this human identity fix into assistant-persona redesign. Existing assistants in MessageList and HistoryMessageList continue to use chatSessionAgentAvatar runtime branding. LiveReasoningStatus keeps the same runtime (including Ekko animation), empty state remains branded. Persona alias/avatar remains available in profile/session selectors and management. Moving persona from human props to assistant props is not required to fix this bug and would add wider type/render/subagent churn.

Keep all fourteen Coding runtimes and current aliases/fallbacks in `utils/chat-agent-avatar.ts:12-50`. No global selected persona fallback for sessions without explicit profile. Standalone MessageItem's current runtime fallback is not to become primary persona; subagents keep branding, never borrow the main profile identity. If separate evidence shows assistant changes are indispensable, block for scope decision rather than implementing a broad refactor.

### D3: account lifecycle

Reuse account store and onAuthInvalidated. On invalidation advance an internal generation, discard previous identity/avatar/loading cache, and prevent old fulfillments AND finally handlers from updating a new generation's state/pending pointer. Reset to the current credential's safe account-name hint or neutral empty fallback, never a prior source's account or persona. Do not log token/base64 or persist new account data. Register cleanup on store scope disposal; avoid accumulating listeners on remount.

Concurrent consumers deduplicate one load per generation. Failure remains retryable; no unbounded automatic loop. New generation can load while old request is pending. Success/failure of the old generation must not mark new data loaded. Custom/random/default avatar and account-name edits from Settings remain reactive across Sidebar and owned chat rows; an in-flight earlier load must not overwrite a newer local edit. Prove this with controlled deferred responses, not timing sleeps. Ordinary forbidden/offline failures do not become persona fallback or unnecessary global logout. Test both invalidating and non-invalidating 403 semantics using the existing API seam.

## Full render-consumer impact matrix

Paths below are relative to packages/client/src unless prefixed otherwise.

| Consumer / entry | Current inputs | r1 human rule | Assistant / scope |
| --- | --- | --- | --- |
| components/hermes/chat/MessageList.vue:186-196,718-732 | session/global profile into human; runtime assistant | account only for proven current-generation local input; all other rows neutral/explicit | runtime unchanged |
| components/hermes/chat/ChatPanel.vue:3260; views/hermes/ChatView.vue:60-94,130-135 | interactive, standalone and resumed sessions | no session-wide ownership inference; account/provenance loaded without Sidebar dependency | no redesign of panel/view |
| views/hermes/WorkflowView.vue:3735 | MessageList scroll-scope workflow | workflow history is not viewer authorship; neutral unless individually proven local input | branded runtime unchanged |
| components/hermes/chat/HistoryMessageList.vue:21-36,221-226 | explicit props.session, no human author | keep unknown human neutral, never globally load viewer as historical author | runtime from explicit session |
| views/hermes/HistoryView.vue:1068; components/hermes/kanban/KanbanTaskDrawer.vue:648 | HistoryMessageList sessions | same neutral historical rule | no caller API churn |
| components/hermes/chat/MessageItem.vue:49-60,241,1026-1042 | optional human props, runtime fallback | keep compatibility; no global account/persona injection | preserve brands/default behavior |
| components/hermes/chat/LiveReasoningStatus.vue:7-15,74-79; MessageList.vue:731-732 | runtime agent | not human surface | unchanged runtime/Ekko animation |
| components/hermes/chat/SubagentStreamPanel.vue:48-59,235,244-248 | child text/tools; MessageItem default, explicit live agent | no account/primary persona injected into child prompt | branding unchanged |
| components/hermes/chat/ToolRunCard.vue:15 | tool MessageItem only | tool roles not human author | no identity change |
| components/hermes/group-chat/GroupMessageItem.vue:89-127 | senderId/name plus members and agent records | preserve room sender/member avatar; isSelf only layout | separate group agent resolver |
| components/hermes/group-chat/GroupMessageList.vue:224; GroupAgentRunCard.vue:53-69,105-110,136,154 | grouped room sender/member props | preserve room provenance, not global account | no room changes |
| views/hermes/SharedGroupChatView.vue:30-37,395,420-460; GroupChatPanel.vue:736 | invite/guest/member identity | preserve guest/member names and avatars | no guest/account writes |
| components/layout/PageSidebarFooter.vue:24,35,92,109 | account username/profileAvatar | authoritative account display comparison | no profile contamination |
| components/hermes/settings/AccountSettings.vue:15-16,76-77,96-97,109-110 | same store; direct reactive edits | must update proven local chat author reactively | tests may mock writes, never live writes |
| router/index.ts:22-25; api/studio/session-share consumers | public invite route; native sharing is separate authorization | never infer sharer/recipient as transcript author | no new schema or permission handling |
| preview / no account / account API unavailable | mock/local or denied data | neutral explicit fallback; no other active persona | no live login assertion |

Search of `<MessageItem`, `<HistoryMessageList`, `<MessageList` and `<LiveReasoningStatus` established these caller families. Engineer and independent QA must rerun the search after edits to verify no new caller bypasses the boundary.

## Allowed paths and forbidden effects

Single software-engineer writer only; same isolated dir (do not pass project= to create a new worktree). Production edits default allowlist:

- packages/client/src/stores/account.ts
- packages/client/src/components/hermes/chat/MessageList.vue
- packages/client/src/components/hermes/chat/HistoryMessageList.vue
- packages/client/src/components/hermes/chat/MessageItem.vue
- packages/client/src/components/hermes/chat/LiveReasoningStatus.vue
- packages/client/src/utils/chat-agent-avatar.ts
- only necessary small client identity composable/types, with exact paths in catalog
- focused tests, isolated browser/e2e fixtures and docs/chat-identity fix records

Allowed does not mean required; avoid modifying runtime/history/reasoning components when unchanged behavior suffices. Reuse existing props and avatar rendering. No shared hot-file edits (chat store, api/client, AccountSettings, Sidebar, ProfileAvatar, locales, configs/manifests) without first blocking for scope approval; reuse existing neutral default to avoid string churn. If truly necessary new UI text is approved, every locale must be covered.

No live source/state/profile/avatar/room/DB/.env/credentials changes; no restarting 8648/Bridge; no full server build; no upstream merge in working branch; no commits, pushes, PRs or publishing; no Codex Agent; no fixed model/provider override. Scratch simulations may create disposable Git objects/indexes without commits to the working branch. Preserve operator WIP including untracked data without reading secrets; guard content via hashes, not copying private contents into reports.

## Exact focused validation plan (engineer execution, independent QA rerun)

Files confirmed present by tools: tests/client/account-store.test.ts, message-item-highlight.test.ts, message-list-scroll-position.test.ts, history-message-list-scroll-position.test.ts, chat-agent-avatar.test.ts, message-list-live-reasoning.test.ts, subagent-stream-panel.test.ts, subagent-stream.test.ts; tests/e2e/chat-streaming.spec.ts, sidebar-account-menu.spec.ts, authenticated-shell.spec.ts, auth.spec.ts, group-chat-share.spec.ts and fixtures.ts. `message-list-scroll-position.test.ts:362-384` currently codifies the defect by expecting profile identity. Update its meaning, do not merely delete it.

Run from the isolated directory, never live. Capture command/stdout/stderr/exit code with timestamps into engineer scratch. If dependencies are missing: `npm ci --ignore-scripts --include=dev`, with per-worktree npm cache; no shared/symlinked live node_modules or .vite. Validate real Node against package engines >=23.0.0. No tests have run on this specification card.

Required existing unit regression command:

    npm run test -- tests/client/account-store.test.ts tests/client/message-item-highlight.test.ts tests/client/message-list-scroll-position.test.ts tests/client/history-message-list-scroll-position.test.ts tests/client/chat-agent-avatar.test.ts tests/client/message-list-live-reasoning.test.ts tests/client/subagent-stream-panel.test.ts tests/client/subagent-stream.test.ts

New targeted tests: use new `tests/client/chat-author-identity.test.ts` for local origin, loaded/peer/unknown fallback and account/persona separation (proposed file, NOT claimed present). Before production edits obtain genuine failing RED behavior, then GREEN with the same assertion(s). Retain failing output and source diff. Account deferred-response regressions may extend existing account-store.test.ts. Run:

    npm run test -- tests/client/chat-author-identity.test.ts tests/client/account-store.test.ts

Required cases: different account/persona images and names; switch session/profile and mutate persona without human change; account image/random/default and rename mutations update owned rows; blank/missing account never uses persona; local own input in new and resumed session; queued local copy/dequeue; peer queue/loaded transcript cannot become viewer; source/token/401/disabled-403 invalidation during pending; ordinary 403/offline retry; old finally cannot erase new pending; concurrent mounts dedup; disposal and provenance clear; old load cannot overwrite local account edits. Include no-profile and coding brand regressions, history explicit-session versus unrelated active-session, subagent non-contamination.

Repo-owned frontend typecheck/config verified at root (there is no packages/client/tsconfig.json):

    npx --no-install vue-tsc --noEmit -p tsconfig.app.json
    npm run harness:check
    npx --no-install vite build --outDir <ABSOLUTE_ENGINEER_SCRATCH>/client-r1

Set `HERMES_WEB_UI_VITE_CACHE_DIR` to isolated cache; outDir must be an existing designated isolated output target, not live dist. The placeholder must be resolved and the actual command recorded. Package full build invokes OpenAPI/server steps and is explicitly not the approved focused command.

Create dedicated `tests/e2e/chat-author-identity.spec.ts` (proposed, NOT yet present) using existing fixtures.ts HTTP AND socket mocks. Do not rely on production 8648 proxy fallback. Select an unused isolated PLAYWRIGHT_PORT and a non-live HERMES_WEB_UI_BACKEND_PORT; unmocked requests fail loudly. Do not reuse an unrelated server despite config reuseExistingServer. Run:

    PLAYWRIGHT_PORT=<UNUSED_ISOLATED_PORT> npm run test:e2e -- tests/e2e/chat-author-identity.spec.ts --project=chromium --workers=1 --output=<ABSOLUTE_ENGINEER_SCRATCH>/playwright-r1

Fixture tests set desktop 1440x900 and mobile 390x844 explicitly. Required actual page screenshots and DOM assertions at both sizes for own-human/account vs persona; profile/session switching; upload/random/default/rename reactive changes with mocks; history/peer fallback; branded assistant/live/subagent regression; unavailable account. Save success screenshots explicitly via testInfo.outputPath (config otherwise takes only failure screenshots). Compare Sidebar/Settings and author in actual DOM; screenshot file alone is not an assertion. Label all screenshots/report as MOCK FIXTURE, not authenticated live browser proof. Rerun focused existing chat-streaming.spec.ts and auth.spec.ts as relevant; sidebar-account-menu.spec.ts has an existing hardcoded v0.5.23 expectation at line21, so document any genuine baseline mismatch rather than silently altering unrelated UI/version assertions. Engineer may select named tests via -g and record coverage gaps honestly. No full suite/coverage/server build.

## Upstream and delivery evidence gates

Engineer captures upstream fresh SHA (fetch only permitted Git refs, no merge), changed-existing-source diff versus base and that fresh upstream. Operator's prior no-endpoint-difference claim must be rechecked. Save patch, exact paths/stat, per-file overlap matrix and hashes. Apply/check and three-way merge simulation against a disposable upstream tree/index, without touching working/live branches or staging unrelated WIP. Include exact reproducible commands, exit codes, actual conflict paths and limits. No promise of zero future merge conflicts.

Catalog schema fixed in CHANGE-CATALOG.json: project, change_id, revision, app_version, date, timezone, specification_card, implementation_card, status, provenance, contracts_unchanged, decisions, changed_paths, verification and known_gaps. `verification` entries use gate/status/evidence; statuses planned, pass, fail, blocked, not_tested. Engineer updates only implementation evidence and actual changed paths/status. No QA verdict embedded by engineer. Independent reviewer writes separately owned scratch report and native review metadata, not production edits or engineered evidence rewrites. Git-tracked intended docs are not yet a claim of Git index tracking; engineer must record their untracked/track-ready status without committing/staging unrelated changes.

Delivery includes patch path/hash, client asset manifest/hashes, source branch/status, no commit/push receipt, all changed paths/diff stats, real RED/GREEN outputs, DOM assertions, screenshots, focused typecheck/build/harness logs, upstream matrix and no-live-change guards. Naya alone decides reversible source/client-asset deployment after independent QA, without a live process restart here.

Operator steering during this run: independent CI00 card `t_4126b91f`, platform-engineer, is preparing a deployed-source/client baseline under `/Users/garbagod/.hermes/maintenance/studio-chat-identity-r1/baseline-builder`. Exact native readback shows running, not accepted. This is parallel read-only deployment preparation, not a second repair writer or engineering prerequisite. Final rollout requires BOTH independently accepted engineering and a trusted CI00 artifact/source receipt preserving already deployed chat-load-r3 without including later unreviewed model-presets WIP. Never use the latest live dirty tree as the deployment build baseline or substitute the isolated engineering build for a proven deployed composite. No deployment is authorized by this card.

Naya reports the new headless browser context has no matching saved login identity and save_login returned prompt_unavailable. Do not guess credentials, retry passwords or bypass authentication. Mock-fixture DOM/screenshots remain required; live authenticated browser acceptance is explicitly UNVERIFIED. Official MCP read-only account/profile API evidence, if provided, is separate from browser authentication proof. Platform preparation receipts and any source mismatch must be reconciled through Naya before cutover.

## Native ownership and task ledger

Current phase: t_9c42371f, Orchestrator, specification only; complete releases ONE software-engineer child with parents=[t_9c42371f]. Child uses workspace_kind=dir and the exact isolated path; no project argument that creates a different worktree, no forced skills/model override. Its next_owner is quality-engineer through same-card kanban_request_review, NOT a review child. Repair budget: 2 review returns; after that escalate via native block to Naya. Reviewer independently executes evidence gates; accept with kanban_complete or request_changes on the same card. No QA performed by Orchestrator/Naya.

Created implementation card: `t_0b720970`, assignee software-engineer; creation returned todo, parent-gated by `t_9c42371f`, exact shared isolated directory. Native project field is null to avoid project-linked worktree creation; its body explicitly carries project_id p_91802335 / ekko-chat-identity. Naya's separate CI00 `t_4126b91f` remains parallel, not a parent blocking implementation. CHANGELOG contains the authoritative handoff ledger snapshot. Board readback governs subsequent state changes.

Naya's native board/watch supervision observes transitions; it is not evidence of browser transport/deployment. Final fix is NOT delivered by completing this specification card. Sole writer and independent review remain open work; all exceptions and final human delivery route to Naya.
