# Upstream 0.7.33 integration with local extensions

## Scope

Merge upstream `05b4e1bd84d7430ec3fa85247282cf68235e76c8` into the local
Service Center and composer extensions. The pre-merge development snapshot is
`240e2662`; the original checkout and production data remain untouched while
validation is incomplete.

## Compatibility decisions

- Retain upstream's new-chat page, draft composer, screenshot control and moved
  reasoning popover. Keep local preset-write guards around send and reasoning
  changes.
- Do not show the active-session preset preview inside the new-chat draft: its
  actions target the established session rather than the draft.
- Mark the new-chat page open before requesting its default model preset, so
  asynchronous default selection can complete. Preserve restored form settings.
- Load the preset's reasoning level into the draft, but preserve a subsequent
  explicit choice, including an empty reset, on first send. A late preset load
  cannot overwrite a reasoning choice changed while it was pending.
- Preserve the currently active session when its first send navigates to its
  own URL. The previous unconditional selection invalidation cleared that
  session and caused an unnecessary history resume. Pending loads and actual
  profile/session changes still invalidate stale selection continuations.
- Retain the fork's explicit empty-string reasoning reset for ordinary sessions.
  The server's scoped Coding Agent resolver uses nullish fallback to persisted
  settings, so an omitted value and an explicit empty value are not equivalent.
  MoA and global CLI runs omit the per-session override.
- Keep both local group host-access and upstream workspace-directory OpenAPI
  additions.

## Reduced coupling

Preset transactions, rollback, defaults and Fast eligibility now live in
`services/session-model-presets.ts`, with existing session-write methods injected
by the chat store. Route loading, optional enhancement loading and stale-request
guards live in `composables/useChatRouteInitialization.ts`; the view consumes its
loading/error/retry result. The store exposes explicit non-destructive selection
invalidation instead of callers switching to an empty session as a workaround.

The preset preview owns navigation cancellation, including routes that retain
the same active session. It no longer relies on the chat store being temporarily
cleared. Socket resume callers receive a cancellation callback on cleanup, so
auth invalidation settles pending history promises promptly.

See `docs/fork-maintenance.md` for the retained feature boundaries and sync rules.

## Regression coverage

- `tests/client/chat-view-initialization.test.ts`: first-send route changes do
  not clear or reload the active new session; existing loading guards remain.
- `tests/client/chat-store-reasoning-effort.test.ts`: MoA/global CLI first-run
  payloads do not carry draft reasoning overrides.
- `tests/e2e/upstream-model-preset-integration.spec.ts`: the configured local
  default is applied in the upstream draft without exposing active-session
  preset controls.
- `tests/e2e/model-reasoning-effort.spec.ts`: close the relocated popover using
  Escape before interacting with the textarea; assert the fork's explicit
  empty reset while retaining global CLI omission.
- `tests/e2e/new-chat-options-loading.spec.ts` and `new-chat-page.spec.ts`:
  first-send routing, agent modes, draft isolation and MoA selection.

## Baseline validation findings

Sixteen initial failures reproduced against the pre-merge snapshot. Seven came
from inherited Hermes worker, MCP and shutdown environment rather than product
defects; the affected suites pass in a clean environment. A separate database
path failure came from a test HOME containing `..` and passes with normalized HOME.

Group-chat fixtures now implement the durable host-access lookup contract; their
non-owner security assertions remain intact. Auth/run-credential expectations
include the existing status and credential marker, and room-join rollback asserts
the persisted ownership field. Chat profile routing is tested behaviorally rather
than requiring one exact source spelling. Auth-invalidation history timeouts are
repaired through cancellation, not longer test deadlines.

A passing build or focused suite alone is not production deployment evidence.
Record full gates, remote synchronization and live rollout separately.
