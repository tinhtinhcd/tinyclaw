# Mention-Driven Execution Model

This document describes the **mention-driven** workflow execution model in TinyClaw, which replaced the previous auto-pipeline behavior.

## Old Auto-Pipeline Behavior (Removed)

Previously, when a team had `workflow.type === 'dev_pipeline'`:

- A `workflowState` object was created on conversation start with a `sequence` and `currentIndex`
- The handoff logic restricted mentions to only the **immediate next** agent in the sequence
- Stages with `requiresApprovalToAdvance` would pause and wait for user approval
- **No automatic stage progression** — handoff still required explicit `[@agent: message]` mentions
- The main issue: `workflowState` and sequence index were used to **restrict** who could be mentioned, and approval gates were tightly coupled to stage completion

## New Mention-Driven Behavior

### Core Rule

**Explicit mention is the only trigger for execution.**

- An agent runs only when explicitly mentioned (by the user or by another agent)
- The next agent runs only when explicitly mentioned in the previous agent's output
- No automatic advancement based on sequence index or successful completion

### User → Agent

- User mentions `@BA` → only BA runs
- User mentions `@ScrumMaster` → only ScrumMaster runs
- User can mention any agent in the team; routing handles delivery

### Agent → Agent

- BA output contains `[@scrum_master: please create the Linear issue]` → ScrumMaster runs
- BA output contains `[@coder: skip scrum master]` → **rejected** (invalid transition; BA may only mention the immediate next role in the workflow)

### Agent → @user

- BA output contains `[@user: Can you confirm the login flow scope?]` → workflow pauses, waiting for user input
- `setWorkflowWaitingForUserInput(taskId, true)` is set
- User sends next message; they can mention any agent to continue

### No Handoff (Pause)

- BA output contains no valid mention → workflow pauses
- No next agent is enqueued
- If the current stage has `requiresApprovalToAdvance`, `setDevPipelineApprovalState` is set and the user can say "approve" to route to the next agent (backward compatibility)

## Transition Validation

When a team has a `dev_pipeline` workflow configured:

- **Allowed transitions**: An agent may mention only the **immediate next** agent in the workflow stages, or `@user`
- **Invalid transitions**: If an agent mentions someone other than the immediate next (e.g. BA → Coder, skipping ScrumMaster), the mention is **rejected**
- **Logging**: `Rejected invalid transition(s) @ba → [coder]; allowed: [scrum_master]`
- **No enqueue**: Invalid mentions do not enqueue the next agent

When a team has **no** workflow config:

- Any teammate mention is allowed (chat mode)
- No transition validation

## Examples

| Scenario | Result |
|----------|--------|
| User: `@BA analyze login requirement` | Only BA runs |
| User: `@ScrumMaster start task` | Only ScrumMaster runs |
| BA: `[@scrum_master: please create the Linear issue]` | ScrumMaster runs |
| BA: `[@user: Can you confirm the scope?]` | Workflow pauses; waiting for user |
| BA: `Analysis complete. Pausing for now.` | Workflow pauses; no next agent |
| BA: `[@coder: skip scrum master]` | Rejected; BA may only mention ScrumMaster |
| PM completes with `requiresApprovalToAdvance`, no mention | Approval gate set; user says "approve" to continue |

## Approval Gate (Backward Compatibility)

When an agent completes a stage that has `requiresApprovalToAdvance` and does **not** mention anyone:

- `setDevPipelineApprovalState` is called with `awaitingApproval: true`
- Workflow pauses
- User can say "approve" (or similar) in the next message; `process-message` routes to the next agent
- This preserves the existing approval flow for PM/ScrumMaster gates

## Implementation Notes

- **No `workflowState`**: Conversations no longer create `workflowState`; workflow config is resolved on demand for transition validation
- **Unified handoff**: Single handoff path in `handleConversationHandoffs`; workflow config used only for validation
- **`getAllowedHandoffAgentIds`**: Returns only the immediate next agent in workflow stages (or all team agents when no workflow)

## Related Files

- `src/runtime/handoff-runtime.ts` — handoff logic, transition validation
- `src/runtime/workflow-config.ts` — `getAllowedHandoffAgentIds`, `resolveTeamWorkflow`
- `src/runtime/process-message.ts` — conversation creation, no workflowState
- `src/lib/routing.ts` — `extractHandoffTargets`, `parseAgentRouting`
