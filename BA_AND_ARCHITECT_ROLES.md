# BA and Architect Roles

## Purpose

Two optional roles were added to the config-driven workflow model:

- `ba` (business analysis)
- `architect` (technical design)

They are optional and only run when included in workflow stage configuration.

## BA responsibilities

- Clarify business problem and user intent.
- Identify missing requirements and ambiguity.
- Propose concise user stories / assumptions / acceptance criteria.
- Ask targeted clarification questions when requirements are underspecified.

## Architect responsibilities

- Propose system design before coding.
- Define module/service boundaries and API/data-flow shape.
- Highlight key tradeoffs and technical risks.
- Provide an implementation-oriented design outline for coder stage.

## Workflow fit

Examples:

- `full_team`: `ba -> scrum_master -> architect -> coder -> reviewer -> tester`
- `dev_only`: `coder -> reviewer -> tester`
- `scrum_master_dev`: `scrum_master -> coder -> reviewer -> tester`
- `analysis_only`: `ba -> scrum_master`
- `design_only`: `architect -> coder`

## Approval gate compatibility

Approval gate is role-configurable:

- Set `requiresApprovalToAdvance: true` on any role (for example `scrum_master`).
- Runtime pauses after that stage and waits for explicit user approval phrase.

BA and Architect are not forced to require approval unless configured.

## Current limitations

- BA and Architect are currently prompt/runtime roles (no deep external side-effect integrations yet).
- Task-linkage mutation contract remains specialized for known mutation roles (`scrum_master`, `coder`); BA/Architect default to read-only command behavior unless extended later.
- Reviewer/tester PR deep context remains specialized to reviewer/tester roles.
