# Maintaining the upstream-based fork

## Branch boundaries

- Fork `main` contains upstream `main` plus reviewed local product customizations.
- Feature work stays isolated until selectively integrated; never infer missing
  functionality only from commit ancestry after a selective adoption.
- Fetch both remotes before integration, compare their exact SHAs, and merge
  upstream into an isolated, preserved snapshot of fork main.
  A clean Git merge alone does not prove compatibility.

## Customization boundaries

| Feature | Owned implementation | Shared integration surface |
| --- | --- | --- |
| Service Center | Client `modules/studio-extensions/service-center`; server `modules/studio/extensions/service-center` | Extension registries, discovery/bootstrap, navigation and generated OpenAPI |
| Model presets and Fast mode | Preset store/API, `services/session-model-presets.ts`, preview composable and model settings components | Chat store injects session references and existing model/reasoning write methods; composer renders its preview |
| Reliable chat initialization | `composables/useChatRouteInitialization.ts` and `utils/chat-initialization.ts` | Chat view consumes loading/error/retry state; chat store exposes non-destructive selection invalidation |
| Group-agent host access | `services/group-chat/host-access.ts`, durable storage and permission controller | Invocation-time checks and prompt context; never caller-supplied identity alone |
| Local chat authorship | `composables/useChatAuthorIdentity.ts` and account lifecycle guards | Chat store emits exact local session/message identity at publication, not an action-timing observer |
| Kanban reporting | Notification services/repositories, native read-only adapter and `bootstrap/kanban-reporting.ts` | Generic bounded read-only queue admission; existing auth flag and schema sync; never merge the older parallel notifier |

Kanban reporting and model diagnostics have separate startup switches, both off
by default. Enable notifications first, then explicitly opt in to diagnostics
only after validating the original-session flow. See
[`kanban-session-reporting.md`](kanban-session-reporting.md). PersonalAgent is
not a dependency of reporting; its native chooser/file/central acceptance remains
a separate gate. Do not bring its ancestor commits along with the Kanban commits.

Model preset transactions, pending-write tracking, rollback and Fast eligibility
must remain outside the large chat store. The injected model/reasoning methods
remain authoritative for server persistence. Do not duplicate their transport or
credential policy in UI components. Session types are imported as types only;
the preset service must not instantiate the chat store recursively.

Chat initialization must not simulate cancellation by switching to an empty
session ID. The explicit invalidation method advances stale-request generations
without clearing the selected session, persisted selection or category state.
Socket resume cleanup must notify waiting callers on cancellation so an expired
login does not leave the page waiting until the history timeout.

Draft controls must not operate on the established active session. Restored
new-chat settings win over default presets. Ordinary runs use an explicit empty
reasoning override to reset persisted settings; MoA and global CLI runs omit it.

## Verification and environment

Run the repository harness, full coverage, browser tests and production build.
Include the model preset/reasoning, new-chat, initialization, auth invalidation,
group host-access and Service Center tests when updating upstream chat code.
Use the opt-in isolated Service Center harness for real JWT, persistence and
editor/reader role acceptance; never aim its mutation tests at production data.

When launched from Hermes, the shell may inherit worker profile, bridge endpoint,
MCP injection and gateway shutdown settings. Run tests with an isolated absolute
HOME and remove inherited `HERMES_*`, `STUDIO_*`, `EKKO_*`, `AUTH_*` and `UV_*`
settings unless an individual fixture intentionally supplies them. Do not alter
production configuration to satisfy a test. Avoid concurrent full builds and
browser/coverage suites when diagnosing deadline failures.

Before replacing the live checkout, recheck preserved file hashes and branch
identity, retain a named stash/snapshot, back up the current built assets and take
consistent SQLite backups. Restart only the owning Studio service after gates
pass, and verify both the listener and HTTP/Bridge readiness. A source merge,
remote push, local build and live deployment are distinct outcomes.

Isolation reduces repeated conflicts; it cannot guarantee that future upstream
changes preserve the same integration contracts. Review those contracts on every
sync instead of accepting conflicts mechanically or weakening tests.
