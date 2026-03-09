# Thin Runtime Task Linkage Test

## Runtime Path Covered

This test exercises the runtime message-processing path through:

- `processMessageForTest(...)` in `src/queue-processor.ts`
- linkage context injection into the agent prompt
- command execution via `applyTaskLinkageCommands(...)`
- outgoing response enqueue path (cleaned text + metadata)

It is intentionally thin and fast, not a full channel E2E test.

## What Is Mocked

- Agent invocation (`invokeAgentFn` override)
- External adapter operations via injected deps:
  - Linear `createIssue(...)`
  - Git `createBranch(...)`
  - Git `createPullRequest(...)`
- Hook processing (`runIncomingHooksFn`, `runOutgoingHooksFn`) as pass-through

Real linkage persistence functions are used to verify task mutation behavior.

## Confidence Added

The test verifies that in real runtime flow:

- linkage context appears in prompt text passed to the agent
- accepted commands mutate linkage state
- user-facing response text is stripped of `[task_linkage ...]` tags
- outgoing response metadata still includes correct `agentId` + `taskId`

## Outside Scope

- Slack socket/event transport and reply bridge E2E
- multi-step team-chain conversations in one test
- log text assertions
- real network calls to Linear/Git providers
