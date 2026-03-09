# Team Chain Task Linkage Test

## Handoff Path Covered

This thin runtime test covers PM -> Coder handoff through real queue-processor message handling:

1. Slack-thread PM message starts a task linkage.
2. PM emits teammate handoff (`[@coder: ...]`), creating an internal message.
3. Coder processes internal message in the same conversation context.
4. Coder emits a `task_linkage` command and linkage is updated.
5. Conversation completes with one cleaned user-facing response and metadata.

## How Linkage Continuity Is Verified

- same `taskId` is observed before and after handoff
- coder prompt includes `TASK_LINKAGE_CONTEXT` with same `taskId`
- task file count remains `1` (no duplicate linkage task created)
- linkage updates (e.g., `workingBranch`) apply to that same task linkage

## Metadata and Cleanup Verification

- final response metadata includes:
  - `agentId` (final agent: coder)
  - `teamId` (`dev`)
  - `taskId` (same shared linkage id)
- final response text has no `[task_linkage ...]` tags

## Outside Scope

- daemon loop/processQueue scheduler behavior
- Slack socket/reply bridge transport
- live external API network calls
- multi-branch parallel team fan-out scenarios
