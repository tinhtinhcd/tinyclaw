# Mention-Driven Execution — Audit

## 1. Where workflowState is Created

**File:** `src/runtime/process-message.ts` (lines 320–357)

When creating a new conversation:
- `enableDevPipeline = workflowMode && (sequenceStartIndex >= 0)`
- `workflowMode = isExplicitWorkflowStartMessage(rawMessage)` (e.g. "create task", "implement")
- `devPipelineSequence = enableDevPipeline ? candidateSequence : null`
- If `devPipelineSequence` is set, `workflowState` is created with:
  - `type: 'dev_pipeline'`
  - `sequence: agentIds` (from workflow stages)
  - `currentIndex: startIndex`
  - `stageRoles`, `requiresApprovalIndices`, etc.

So `workflowState` is only created when the user explicitly starts a workflow and the initial agent is in the workflow stages.

## 2. Where Auto-Advance Happens

**File:** `src/runtime/handoff-runtime.ts`

When `workflowState?.type === 'dev_pipeline'`:
- `getAllowedHandoffTargets` returns **only** `sequence[idx + 1]` — the next agent in the sequence.
- Handoff requires an explicit `[@agent: msg]` in the response.
- There is no auto-advance without a mention; the flow pauses if there is no mention.

The real constraint is:
- `allowedAgentIds` = only `sequence[idx + 1]`
- BA can only mention scrum_master (next in sequence).
- BA cannot mention architect, coder, etc., even if they are teammates.

So the behavior is mention-driven but with a strict linear sequence: only the immediate next stage is allowed.

## 3. Where Explicit Mentions Are Ignored

- When `workflowState` exists, `validAgentTargets = agentTargets.filter(t => allowedAgentIds.has(t.agentId))`.
- If BA mentions `[@architect: ...]`, it is rejected because architect is not `sequence[idx + 1]`.
- Invalid mentions are logged but not enqueued.

When `workflowState` is absent (lines 181–215):
- Any teammate mention is accepted; there is no transition validation.

## 4. Smallest Safe Path

1. **Stop creating `workflowState` for pipeline progression** — do not use `devPipelineSequence` to drive stage advancement.
2. **Use workflow config only for validation** — resolve the workflow and use it to compute allowed transitions.
3. **Unify handoff logic** — one path that:
   - Extracts mentions via `extractHandoffTargets`
   - Validates transitions using workflow stages (when available)
   - Allows: current role → any role after it in stages, or → user
4. **No `currentIndex` advancement** — remove reliance on `workflowState.currentIndex` for who runs next.
