# Kanban session reporting and diagnostic admission

## Ownership and operation

Reporting is default-off. Set `STUDIO_KANBAN_REPORTING_ENABLED=1` at process startup for notification-only operation. Only also setting `STUDIO_KANBAN_DIAGNOSTICS_ENABLED=1` connects diagnostic admission; individual subscriptions must still opt in. Turning either switch off takes effect on restart. No existing production configuration is changed by merging this module.

The central Studio schema initializer adds four reporting tables on startup even when reporting is off, following the existing database ownership convention. These additive definitions do not modify the native Hermes board database. Disabling a module preserves its persisted tables; it does not erase subscriptions or notices.

Authenticated `GET /api/studio/kanban-reporting` returns the active `enabled` and `diagnosticsEnabled` capabilities. Disabled modules do not scan native boards, start a poll timer, or recover diagnostic runs. The UI hides unavailable controls and does not poll session notifications when reporting is off; a notification-only server rejects forged diagnostic subscriptions with 409. Core native task creation continues without reporting when the module is disabled.

Kanban-specific evidence and prompts stay in the notification dispatcher. The socket queue accepts a generic internal `ReadOnlyDiagnosticInput`, with typed admission deferral, bounded input, owner revalidation and no public socket fields. Existing upstream run recovery and fork preparation-failure ownership guards remain intact.

Studio owns subscriptions, notices, wake policy and execution admission. Hermes Agent source and its Kanban database are never modified by this feature. The Hermes adapter reads committed native events through a read-only SQLite connection, using only paths returned by the native board catalog. Backend polling runs every ten seconds independently of browser connections. Hooks are not the authoritative event source: pure Kanban CLI mutations do not load chat shell hooks, and dependency hooks can fire before commit.

## Target binding

A Kanban create request with authenticated run context binds to that exact source Studio session. Browser clients may explicitly provide `origin_session_id`, which is checked against the session owner and profile. Conflicting run-context origins are rejected before creation. Binding failure after successful native creation is returned as `report_subscription_error`; do not retry task creation.

A background discovery pass considers at most 100 recent (seven-day) native origins per active board and binds exact existing authorized Studio session identities. It never guesses the active/last session, subscribes children, or reactivates a disabled subscription. Missing provenance needs an explicit selection in the task drawer. The drawer selects a reporting session and optionally enables diagnostics. Automatic bindings are notification-only.

GET/POST/DELETE `/api/studio/sessions/:id/kanban-notifications` require browser user authorization; run credentials cannot nominate arbitrary targets through those routes. Creation binding uses its separately validated host context. Native task/profile access and session ownership are rechecked during polling and again at dequeue. Archived or deleted sessions cannot start diagnostic runs.

## Fixed policy and token controls

- heartbeat, claim, dependency and transient retry activity: no model wake.
- creation, completion, review and human input: durable display-only notice.
- capability blocks, block-loop/triage and exhausted retries: diagnostic candidates only on explicitly opted-in root tasks.
- unclassified failures/crashes/timeouts: notice only, not permission to automatically repair.
- a recovered task or newer authoritative transition cancels stale diagnostics.

A candidate waits 60 seconds for native recovery. Events coalesce per task; up to eight tasks coalesce per target session. Both task and session cooldowns are ten minutes. A persisted admission budget permits one concurrent report globally and reserves 8192 tokens per call, up to 32768 per hour. Reservation is conservative, not a provider-side billing quota. Queue/model failures retry at most three times with stable event identities. Budget admission is checked before queueing; an execution-time budget race defers the durable request for at least one minute without consuming a model attempt, revoking authorization, or cancelling the report permanently.

The first rollout only wakes existing built-in Ekko sessions. Hermes and Coding sessions support notifications, but cannot opt into this diagnostic route without changing runtime identity. Diagnostics use an isolated one-step run, at most 1536 output tokens, a 90-second abort deadline, a small history excerpt, and no tools, skills, memory, delegation or MCP servers. They explain blockers and ask for decisions; they do not approve, restart or modify tasks. Automatic repair needs a separate permissioned execution policy.

## Queue and restart behavior

Requests are persisted before process-local admission. `ChatRunSocket.enqueueReadOnlyDiagnostic` validates the session and user, queues behind foreground work, and uses a background socket when the browser is disconnected. Authorization is repeated just before model execution. Client-supplied internal diagnostic flags are stripped at socket ingress.

A backend restart recovers pending/running requests with their durable identities. A model response lost between provider completion and durable settlement can be repeated after a crash; this is at-least-once delivery, not an exactly-once provider-call guarantee. Abandoned reservations remain charged to the hourly budget. Native outages preserve cursors and pending requests; revoked access hides notices and cancels execution.

Notifications have their own Studio tables and are rendered as a separate session-page overlay; they never become user/assistant transcript messages and consume no model tokens. Actual diagnostic replies use the ordinary message persistence and session broadcast path, so they survive navigation and reload. Turning off diagnostics/unsubscribing suppresses queued work at execution-time checks; it does not interrupt an already-running report.

The session page uses a compact notification trigger and a secondary new-task action. The notification count is the available history count, not an unread count. Opening its bounded popover does not resize the chat. Updates are grouped by board and task, newest first; summaries, earlier updates and subscription management expand on demand. Switching sessions closes the popover. This presentation does not mark notices as read, delete history or change diagnostic opt-in.

## Verification and rollout

Tests use isolated Studio state/native fixtures and mocked model execution. The feature does not infer task success from an agent turn ending. Production deployment must integrate this branch, rebuild/restart Studio at a safe point, and validate an opted-in test task in its original session. Do not run production model diagnostics as part of unit/browser tests.

Known bounds: discovery covers recent native roots only, UI notification history is the latest 100 rows, polling/CLI work can add latency, and there is no OS push channel in this rollout. A task without milestones, failure or other relevant events still needs a separate long-silence watchdog; this change does not diagnose every kind of worker hang.
