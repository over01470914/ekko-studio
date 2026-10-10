# Selective local feature consolidation

## Scope

Base: `636043fa`, the deployed fork baseline. This change selects the bounded
PI-21 socket acknowledgement fix, the optional compression soft cap, and missing
chat-loading regression tests. It does not merge every historical feature branch.

## Behavior and boundaries

- Group Agent socket messages now reject on disconnect or after 60 seconds
  without an acknowledgement, detach their listener, and ignore late replies.
  Malformed acknowledgements reject instead of resolving an absent message ID.
  The event-sink path is unchanged. This is not end-to-end acceptance of the
  entire PI-21 mention incident.
- `compression.threshold_tokens` is optional and accepts positive finite
  integers only. It changes the outer compression trigger, not the compressor's
  hard ratio-based budget or the fixed-overhead error boundary. No runtime
  configuration is changed and no default absolute cap is introduced.
- The newer upstream `overBudget` hint must compare total context usage against
  the hard budget, not merely reflect that the soft trigger fired. A real
  compressor regression caught protected tool-tail folding before this fix.
  Regression coverage includes legacy and cursor snapshots, protected head/tail,
  tool pairs, disabled compression, invalid caps and unchanged stored messages.
- Chat-loading implementation from `d01695cf`/`0b0f84e3` already exists in the
  deployed composite, with newer cancellation and route-module boundaries.
  Reapplying its old source would undo that work. Restore its missing transport
  and slow-resume tests instead, updating the Socket.IO fixture removal pattern
  to match the current shared fixture exactly.

## Deliberately excluded

- Personal-agent `18d4ef72` is a native verification checkpoint, not completed
  native acceptance. Its own receipt records an unverified real folder chooser
  and file loop. No native permission gate is replaced with mocks here.
- Author-identity WIP relies on synchronous publication before a microtask.
  Current sending can await a model-preset write first; an isolated regression
  reproduces the missing local-author proof. It needs an explicit publication
  boundary rather than a longer observation window that could capture peers.
- Legacy Kanban-notification WIP marks a notification delivered immediately
  after a fire-and-forget event publish. Consumer rejection cannot trigger its
  outbox retry. Resolve acceptance/delivery semantics before integration.
- New Kanban-proactive code has a separate durable diagnostic design and shared
  personal-agent ancestry. Review its two feature commits separately; do not
  import the entire ancestry or install both notification implementations.

Original owner worktrees and their uncommitted edits are preserved. Repository
integration, production deployment, and independent product acceptance remain
separate decisions.
