# Chat identity change log and task ledger

Project p_91802335 / ekko-chat-identity. All dates use Asia/Taipei (UTC+08:00).
App version remains 0.7.31; fix revision r1 is tracked here, not a package bump.

## 2026-10-10 — CI01 r1 specification

Owner: Orchestrator; specification task t_9c42371f.

Actual work: read ROLE.md, AGENTS.md and its first-read documents; inspected account/auth/profile/session API contracts and all MessageItem, HistoryMessageList, MessageList and LiveReasoningStatus consumer families by local read/search. Wrote SPEC.md, CHANGE-CATALOG.json and this CHANGELOG.md only. No production code implemented, no QA or runtime/Git command claimed.

Root cause: MessageList.vue186-196 derives human display props from selected session persona (with unrelated global-profile fallback), then MessageItem.vue1026-1033 renders that persona as a human. Account API and existing shared Sidebar/Settings account store are separate. Reuse requires stale-generation/pending lifecycle protection in account.ts, not a new auth architecture.

Decisions: preserve human prop compatibility and use reactive account identity only for proven locally submitted current-generation input. Keep explicit sender/neutral default for history, peer, public/guest/workflow/shared inputs without author data. Do not infer authorship from permissions, session metadata, message timestamps/content/ID shape. A tiny ephemeral provenance composable through existing synchronous sendMessage action is within scope only if its reliability is exercised; hot chat-store seam edits need escalation first. Full reload can lose local proof, so old own input may remain neutral without a backend author contract. Preserve all assistant/coding/subagent runtime branding; persona redesign is unnecessary for this human bug. API/schema/persistence/contracts remain unchanged.

Actual validation: local read/search; tools verified documentation writes and JSON syntax. NOT RUN here: RED/GREEN, tests, harness, typecheck, browser DOM/screenshots, client build, Git tracking/status/hash guards, fresh upstream comparison or merge simulation. These gates are mandatory engineer work and independent reviewer checks; see SPEC for exact commands, fixtures and scope. Supplied Naya baseline is labeled provenance, not freshly executed evidence.

Operator update: CI00 t_4126b91f/platform-engineer separately prepares a trustworthy deployed composite including chat-load-r3 and excluding later unreviewed model-presets. Native readback: running; no accepted receipts yet. It is not another repair writer. Rollout requires BOTH independent CI01 QA and trusted CI00 source/artifact baseline. Missing saved login identifier / save_login prompt_unavailable means live authenticated browser verification is explicitly UNVERIFIED; no credential guessing. Mock fixtures still require desktop/mobile real screenshots and DOM assertions.

## Native authoritative task ledger

| Card | Phase / owner | Dependency | Status at specification handoff | Next owner |
| --- | --- | --- | --- | --- |
| t_9c42371f | CI01 r1 specification / Orchestrator | none | specification files written; completing releases sole writer | software-engineer |
| t_0b720970 | CI01 r1 implementation / software-engineer | parent t_9c42371f | created in todo, gated until parent completion | quality-engineer via same-card request_review |
| t_4126b91f | CI00 deployed-composite baseline / platform-engineer | independent parallel preflight | running by native readback, not accepted | Orchestrator/Naya receipts |

No pre-created review child; no duplicate writer. Maximum 2 review-return repairs then native escalation to Naya. Reviewer must independently verify evidence, not certify worker claims. Naya owns deployment and final owner communication; specification completion is not final fix delivery. All updated task states live on the native board; this ledger is a handoff snapshot, not a replacement for board lifecycle.

## Planned engineer r1 entry (not a result)

Engineer must append actual execution date/time/timezone, own card, all changed paths/diff stat, RED/GREEN output paths and exit codes, provenance/peer/history coverage, account generation/local-edit cases, scoped regression/harness/typecheck/client-build results, desktop/mobile mock browser DOM/screenshots, build asset/patch hashes, fresh upstream SHA and replayable apply/merge overlap matrix, current branch/dirt/no-commit/no-push receipts, before/after live protections and deployment patch path. Maintain catalog schema and contracts unchanged; mark unavailable gates honestly. Independent reviewer evidence stays separately owned and is handed off through the same-card native review transition.

## 2026-10-10 — CI01 r1 implementation / t_0b720970 (engineering checks only)

Single writer in isolated `fix/chat-author-identity` at base `299e20cf25cce5b62115bcf245aef80cbb16af4d`; fresh fetch read back upstream/main `46ae5f6fc78bc98be68d4e11fc850538aa030d53`. No live repo edit, commit, push, release, backend/API/schema change or independent QA verdict. All changed paths are listed in CHANGE-CATALOG.json; no shared chat store, renderer runtime, history renderer, assistant brand, ProfileAvatar, locale, server or package change.

Removed profile alias/avatar as the human MessageList source. A bounded in-memory registry observes only synchronous Pinia `sendMessage` publication of an exact `(sessionId,messageId)`, including queued copies; peer/history and other-session rows stay neutral. The registry is cleared by existing auth invalidation and account-store disposal. Loading the account uses one pending request per generation, guards old fulfillments/finally and prevents earlier requests from overwriting local Settings edits; source transitions reset to the current token username hint or neutral empty. Remount across SPA settings keeps current-generation proof; full reload without retained proof keeps even old own messages neutral. Assistant runtime and room identity untouched.

Genuine RED before production edit: changing the existing profile-human assertion to expect `default` failed, receiving `Researcher` at message-list-scroll-position.test.ts:383 (exit 1). The same assertion passed GREEN after production edit. Focused unit test covers direct synchronous publication before Promise resolution for new/resumed/queued actions, queue copies, peer/preloaded history, account/profile/session switching, invalidation, disposal, account image/name changes, stale-generation race, local edits and offline/ordinary403 retries. Existing transport tests independently exercise local401/disabled403, token/server/logout distinctions. Desktop and mobile Chromium mock fixtures assert DOM for account versus persona, unavailable account current-token hint, peer and historical neutral fallback, Settings upload/random/default/rename across SPA navigation and assistant history branding; success screenshots are explicit test output, NOT authenticated live proof. The exact command receipts and asset manifest are in the isolated engineer scratch directory `/Users/garbagod/.hermes/profiles/software-engineer/cache/scratch/ci01-r1/`; this entry is not a QA PASS.

Read-only live guard: an intermediate check found all 76 supplied WIP hashes unchanged; FINAL check found 11 locale hash differences (ar,de,en,es,fr,ja,ko,pt,ru,zh-TW,zh) and live status expanded to 98 entries. This writer did not touch live files; do not attribute or reset concurrent changes, and keep rollout NO-GO pending Naya's reconciliation. PID 6232/server port8648 and PID6423 remained present. Git status in the isolated tree shows only specified new docs, selected client/tests and pre-existing `.codegraph/` untracked, without staging or commit. Browser Vite ran at isolated 19473 with backend proxy target 19474 and mocked HTTP/socket; no request to live 8648 was used. Upstream overlap in touched existing paths is `tests/e2e/fixtures.ts` only; merge simulation receipt must be consulted for actual conflict status. CI00 baseline and live authenticated sign-in remain separate rollout gates; current engineering build is not a deployed-equivalent artifact.

Later native readback of CI00 t_4126b91f: triaged NO-GO, not an accepted baseline. Approved r3 composite build mismatched the currently served index; its r1b isolated current-source comparison build stopped on a missing tracked config/agents.json in the frozen copy, without an artifact-equivalence conclusion. The separate Naya baseline decision remains required before rollout. Neither that failure nor this engineering-only build authorizes deployment or copying current live WIP.
# 2026-10-10 fork integration amendment

The approved integration replaces the historical synchronous action observer with an explicit store publication event. A regression first reproduced missing authorship after preset persistence (1 failed / 6 passed), then passed with the publishing-session binding, including a concurrent view switch and peer message. Account lifecycle and neutral-history behavior remain unchanged. Earlier entries describe the original candidate, not current acceptance.

