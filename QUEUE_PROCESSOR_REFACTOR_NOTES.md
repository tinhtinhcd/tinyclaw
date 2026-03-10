# Queue Processor Refactor Notes

## 1) Previous responsibilities in `queue-processor`

Before refactor, `src/queue-processor.ts` handled all of these in one file:
- daemon startup, polling loop, maintenance timers, shutdown
- full message-processing pipeline
- routing and team context resolution
- Slack-thread task linkage lookup/creation
- prompt enrichment (`TASK_LINKAGE_CONTEXT`, reviewer/tester fetched context)
- coder worker delegation + native agent invocation
- response cleanup and outgoing enqueue
- team-chain handoff flow and conversation completion
- observability/logging calls and test seams

## 2) New module layout

Refactor moved behavior into focused runtime modules:

- `src/runtime/queue-runtime.ts`
  - queue loop, startup lifecycle, timers, signal handling
- `src/runtime/process-message.ts`
  - process-message orchestration entry point
  - keeps `processMessageForTest` seam
- `src/runtime/prompt-context.ts`
  - role-aware prompt enrichment and linked/fetched context append
- `src/runtime/worker-delegation.ts`
  - coder worker delegation path + worker result linkage updates
- `src/runtime/handoff-runtime.ts`
  - dev-pipeline and mention-based handoff continuation logic
- `src/runtime/response-runtime.ts`
  - final direct-response shaping and enqueue path

`src/queue-processor.ts` now acts as a thin runtime entry/export wrapper.

## 3) Behavior intentionally preserved

- runtime queue orchestration and message-claim semantics
- `startQueueProcessor()` entrypoint and `require.main` startup guard
- `processMessageForTest(...)` test seam
- task linkage creation/reuse and command execution flow
- reviewer/tester context enrichment flow
- coder worker delegation flow and linkage attachment behavior
- existing observability/event emissions
- outgoing response metadata shape

## 4) Key exported entry points

- `startQueueProcessor` (re-exported from `src/runtime/queue-runtime.ts`)
- `processMessageForTest` (re-exported from `src/runtime/process-message.ts`)

## 5) Compromises / remaining larger areas

- `process-message.ts` is still the main orchestration hub and remains non-trivial.
- Team conversation creation and completion still live near the main orchestration path.
- Further decomposition is possible (e.g. dedicated conversation-state runtime module), but was avoided to keep this refactor behavior-preserving.
