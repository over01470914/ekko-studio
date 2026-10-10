# Model Presets

The existing Models page has a **Model Presets** tab, a sibling of General
Models, STT Providers and TTS Providers. This is not a new sidebar entry or
route. Its selected `modelProfile` scopes the editor's reads and writes; it never
switches the active chat Profile. The previous fork-added Settings editor is
removed. The original Settings provider/API-key panel and composer model/reasoning
controls remain intact.

Each user-defined preset has a stable `id`, editable `label`, `providerId`,
`modelId` and optional `reasoningLevel`. Presets can use different models,
different reasoning levels, or repeated models. The ordered array controls the
slider positions, not a sorted reasoning ladder or a claimed capability score.
For example, basic=Luna/medium, default=Sol/low, deep=Sol/high and
extreme=Astra/medium are valid choices when the actual provider advertises those
models/levels; none of those names or models are hard-coded defaults.

## Editor

The editor copies saved state into a local draft. New presets start with blank
provider/model fields, rather than silently choosing the first provider. A drag
handle and keyboard-accessible up/down buttons reorder the same stable ids.
`defaultPresetId` is independent of the label `default`; reordering leaves it
unchanged, and deleting it clears the preset default without selecting another
model. With no preset default, normal model defaults continue to apply.
Missing/disabled models and invalid reasoning are retained visibly for repair,
but cannot be saved as an apparently valid combination. Saving edits no current
chat. Switching Profiles protects against late read/save completions.

## Preview and submission

The icon immediately to the left of the microphone opens the panel on hover,
click or keyboard focus. Slider input and Fast update local preview only. Leaving
the entire trigger/panel region closes it after a 120ms pointer-gap grace and
submits only the final combination once. Re-entering cancels the close timer;
outside click, Escape or toggling the trigger closes it too. The manage action
closes the draft before navigating to Models with `tab=model-presets` and the
session's Profile. Unchanged previews cause no API writes. Switching sessions or
Profiles discards an uncommitted draft instead of writing to another context.

An empty configuration has **no slider and no synthetic reasoning-only steps**;
it offers the existing Models tab's configuration entry. Original manual model
and reasoning controls remain available. While a preview is open, definition
order is frozen, and a removed/changed preset is rejected on commit rather than
silently applying a different position.

The implementation boundaries are:

- `ModelPresetsPanel.vue`: profile-specific draft editing and ordering.
- `model-presets` Pinia store: profile cache, auth lifecycle and concurrent saves.
- `api/hermes/model-presets.ts`: persistence adapter; UI does not depend on display keys.
- `ModelPresetBar.vue`: controlled presentation only; no Pinia, network or session API.
- `useModelPresetPreview.ts`: draft/pointer lifecycle and capability resolution.
- `model-preset-selection.ts`: one close-time submission adapter using existing model/effort writes.
- `ModelPresetPreview.vue`: small composer integration container.

Fast remains independent of presets/reasoning, capability-gated, and previewed
until close. The existing supported Ekko OpenAI Chat/Responses execution path
uses `service_tier: priority`; unsupported engines do not expose an empty toggle.
A new preview model defaults Fast off; returning to an already visited model
restores its local draft choice for this opening only. No per-preset Fast setting
is persisted. Supplier pricing/eligibility still applies.

## Existing data and loading hotfix

The storage adapter preserves existing profile display fields `composer_steps`
and `composer_default_step_id`. This is data compatibility, not a deprecated UI
wrapper. Saving merges only these keys with `restart:false`, preserves unrelated
settings, and uses an explicit Profile header. No database migration or new API
route is needed. Existing background Settings loads hydrate the cache with a
revision guard, so chat startup adds no preset request. The editor/first panel
opening fetches lightweight display data only when needed; requests have a local
10-second deadline including desktop-auth waiting; preset-local failures
are retryable without blocking the chat page.

The deployed r3 chat loading marker, transport isolation, list failure propagation,
ChatView and loading-warning helper are preserved. This feature does not modify
the history/Retry protocol. Final frontend build validation uses an isolated output
so the running r3 frontend is not replaced without an explicit deployment.

## Focused checks

```sh
npm run test -- tests/client/model-presets.test.ts tests/client/model-presets-store.test.ts tests/client/model-presets-api.test.ts tests/client/model-preset-preview.test.ts tests/client/model-preset-bar.test.ts tests/client/model-presets-panel.test.ts tests/client/chat-store-reasoning-effort.test.ts
npm run test:e2e -- tests/e2e/model-presets.spec.ts tests/e2e/model-reasoning-effort.spec.ts
npm run harness:check
```

## Removed fork-only implementation

The old `settings/ComposerStepsSettings.vue`, `chat/ComposerModelBar.vue`,
`types/composer-steps.ts`, `utils/composer-steps.ts` and their old test/doc paths
were removed or renamed, not kept as wrappers. The old Settings mount and the
synthetic reasoning-only preset fallback are gone. Existing manual reasoning
controls are not obsolete and remain unchanged. Compatibility storage field names
are retained intentionally so existing saved presets are not deleted or lost.
