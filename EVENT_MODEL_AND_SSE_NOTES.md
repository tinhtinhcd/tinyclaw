# Event Model and SSE Notes

This note documents a small observability refinement for TinyClaw runtime events.

## Goals

- Keep runtime-safe structured events.
- Normalize event naming so log/SSE consumers can rely on predictable families.
- Reuse existing SSE path without redesigning server architecture.

## Event Naming Families

Normalized family prefixes:

- `worker.*`
- `linkage.*`
- `review_fetch.*`
- `tester_focus.*`
- `role_detect.*`
- `command_validation.*`
- `context_budget.*` (existing budget guardrail events)

Examples:

- `worker.started`
- `worker.succeeded`
- `worker.failed`
- `worker.timeout`
- `worker.retry`
- `linkage.created`
- `linkage.linear_attached`
- `linkage.branch_attached`
- `linkage.pr_attached`
- `command_validation.rejected`
- `role_detect.heuristic_fallback`
- `review_fetch.failed`
- `tester_focus.generated`

## Payload Shape

The structured event shape remains:

- `type`
- `timestamp`
- `taskId`
- `conversationId`
- `agentId`
- `teamId`
- `role`
- `status`
- `source`
- `message`
- `metadata`

Notes:

- Not all fields are required on every event.
- `timestamp` is always populated if missing.
- `metadata` is always an object (empty object fallback).

## SSE Bridge

SSE reuse was already present via:

`emitEvent(...)` -> `onEvent(...)` -> `broadcastSSE(...)` -> `/api/events/stream`

A lightweight addition was made:

- Continue broadcasting each normalized event on its own event name (for compatibility).
- Also mirror normalized runtime observability events on a single stream event:
  - `runtime.event`

This gives dashboard/log consumers one stable event channel while preserving existing behavior.

## High-Value Events

Most useful for runtime diagnosis:

- Worker lifecycle (`worker.started`, `worker.retry`, `worker.timeout`, `worker.failed`, `worker.succeeded`)
- Linkage lifecycle (`linkage.created`, `linkage.*_attached`, owner/status changes)
- Command validation (`command_validation.accepted` / `rejected` / `execution_failed`)
- PR context fetch flow (`review_fetch.*`)
- Tester synthesis (`tester_focus.generated` / `skipped`)
- Role fallback detection (`role_detect.heuristic_fallback`, `role_detect.invalid_explicit`)

## Extension Path

Future dashboarding can safely consume:

- `runtime.event` for one unified channel.
- Per-event SSE channels when finer routing is needed.

No large event persistence or telemetry platform is introduced in this refinement.
