# TinyClaw Observability Architecture (MVP)

## Purpose

This adds a small structured observability layer for:
- coder worker execution
- task linkage lifecycle and command validation
- reviewer/tester PR-context fetch and fallback
- tester synthesized focus generation

It is intentionally lightweight and runtime-safe, without introducing a telemetry platform.

## Core Abstraction

`src/lib/observability.ts` provides:
- `emitTinyEvent(event)`
- `warnTinyEvent(event)`
- `errorTinyEvent(event)`

Event shape:
- `type`
- optional context: `taskId`, `conversationId`, `agentId`, `teamId`, `role`, `source`, `status`, `message`
- `metadata` object for compact extra fields
- `timestamp` (auto-filled if missing)

Behavior:
- writes concise log lines through existing `log(...)`
- emits structured events through existing `emitEvent(...)`
- never throws up into runtime flow

## Event Emission Points

- **Worker**
  - `src/integrations/coder/cli-worker.ts`
  - `worker_started`
  - `worker_timeout`
  - `worker_retry`
  - `worker_validation_failed`
  - `worker_failed`
  - `worker_succeeded`
  - `src/queue-processor.ts`
  - `worker_mode_selected`
  - `worker_branch_attached`
  - `worker_pull_request_attached`

- **Linkage**
  - `src/lib/task-linkage.ts`
  - `linkage_created`
  - `linkage_linear_attached`
  - `linkage_git_branch_attached`
  - `linkage_pull_request_attached`
  - `linkage_owner_changed`
  - `linkage_status_changed`
  - `src/queue-processor.ts`
  - `linkage_resolved_slack_thread`

- **Command validation**
  - `src/lib/task-linkage-workflow.ts`
  - `linkage_command_received`
  - `linkage_command_accepted`
  - `linkage_command_rejected`
  - `linkage_command_execution_failed`
  - `linkage_command_linkage_updated`
  - `linkage_command_overwrite_used`

- **Review/Test PR fetch**
  - `src/lib/task-linkage-workflow.ts`
  - `reviewer_pr_fetch_started`
  - `reviewer_pr_fetch_succeeded`
  - `reviewer_pr_fetch_failed`
  - `reviewer_pr_fetch_fallback_linkage`
  - `tester_pr_fetch_started`
  - `tester_pr_fetch_succeeded`
  - `tester_pr_fetch_failed`
  - `tester_pr_fetch_fallback_linkage`
  - `src/queue-processor.ts`
  - fallback event if role fetch call throws unexpectedly

- **Tester focus synthesis**
  - `src/lib/task-linkage-workflow.ts`
  - `tester_focus_generated`
  - `tester_focus_skipped`

## SSE and Reuse Path

No new SSE implementation was added.

Existing path already forwards all runtime `emitEvent(...)` events:
- `emitEvent` in `src/lib/logging.ts`
- `onEvent(...)` bridge in `src/server/sse.ts`
- streamed at `/api/events/stream`

Because `observability.ts` emits via `emitEvent`, these new structured events are immediately available in SSE consumers and plugin listeners.

## High-value Event Categories

- `worker`: execution state, retries, timeout, validation, success/failure
- `linkage`: source-of-truth task linkage mutations and ownership/status changes
- `review-fetch`: read-only PR fetch behavior and fallback usage
- `tester-focus`: synthesized testing guidance generation/skips
- `command-validation`: role contract acceptance/rejection and reasons

## Current Limitations

- events are not persisted as a dedicated history table
- no UI dashboards yet; consumption is via logs/SSE/plugins
- event schemas are documented but not versioned yet
- no event sampling/rate controls (acceptable at MVP scale)
