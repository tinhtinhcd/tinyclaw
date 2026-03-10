# Dev Pipeline Approval Gate

## Old behavior

`dev_pipeline` auto-advanced immediately after PM response:

- PM -> Coder -> Reviewer -> Tester

This happened even for trivial messages (for example `hello @PM`) because the runtime advanced to the next stage whenever PM succeeded.

## New behavior (approval-gated)

PM is now a required gatekeeper:

1. User talks to PM.
2. PM analyzes and proposes plan/clarifications.
3. Pipeline stops and waits for explicit user approval.
4. Only approved follow-up advances to Coder (then normal downstream stages can continue).

## Approval phrases (MVP)

Current explicit approvals:

- `approve`
- `approved`
- `go ahead`
- `continue`
- `proceed`
- `start`
- `yes continue`
- `yes, continue`
- `ok continue`
- `okay continue`
- `please continue`

Any non-approval follow-up stays on PM.

## Runtime notes

- Approval gate state is persisted in task linkage:
  - `devPipelineAwaitingPmApproval`
  - `devPipelineApprovedAt`
- After PM step, runtime marks the task as awaiting approval and does not enqueue Coder automatically.
- On explicit approval message, runtime reroutes to Coder and clears waiting state.

## Examples

- `hello @PM` -> PM only, waiting approval.
- `implement login with JWT` -> PM planning only, waiting approval.
- `approve` -> pipeline advances to Coder.
- `can you clarify token refresh?` -> PM only, still waiting approval.

## Limitations

- Phrase matching is intentionally simple and deterministic (exact normalized phrases).
- Approval intent is text-based only; no button/workflow UI yet.
