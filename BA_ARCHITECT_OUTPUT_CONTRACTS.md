# BA and Architect Output Contracts

This adds lightweight structured output contracts for `ba` and `architect` so downstream roles receive more predictable artifacts.

## Why

- BA output becomes a reusable requirements artifact instead of only freeform prose.
- Architect output becomes a reusable technical design artifact.
- Later stages (`scrum_master`, `coder`, `reviewer`, `tester`) can consume these artifacts directly in prompt context.

## BA Contract

BA is guided to use:

```text
[BA_REQUIREMENTS]
Business Goal:
Clarifying Questions:
Assumptions:
User Stories:
Acceptance Criteria:
Risks / Unknowns:
[/BA_REQUIREMENTS]
```

## Architect Contract

Architect is guided to use:

```text
[ARCHITECT_DESIGN]
System Goal:
Proposed Components / Modules:
API / Interface Notes:
Data / Storage Considerations:
Security / Reliability Considerations:
Implementation Plan:
Technical Risks / Tradeoffs:
[/ARCHITECT_DESIGN]
```

## Downstream Usage (MVP)

Runtime now extracts the latest contract blocks from upstream stage outputs and injects them into downstream prompts:

- `[BA_REQUIREMENTS_CONTEXT] ... [/BA_REQUIREMENTS_CONTEXT]`
- `[ARCHITECT_DESIGN_CONTEXT] ... [/ARCHITECT_DESIGN_CONTEXT]`

Current routing:

- `scrum_master`, `architect`, `coder`, `reviewer`, `tester` can receive BA requirements context.
- `coder`, `reviewer`, `tester` can receive Architect design context.

This is done through existing prompt enrichment flow with no queue/Slack redesign.

## Examples

BA output snippet:

```text
[BA_REQUIREMENTS]
Business Goal:
Reduce onboarding drop-off for first-time users.
Acceptance Criteria:
- New user can create account and reach dashboard without manual support.
[/BA_REQUIREMENTS]
```

Architect output snippet:

```text
[ARCHITECT_DESIGN]
System Goal:
Support invite-based onboarding with auditability.
Implementation Plan:
1. Add invite token model
2. Add validation endpoint
3. Add acceptance tests
[/ARCHITECT_DESIGN]
```

## Limitations

- This is marker-based, not schema-validated parsing.
- Only the latest block per type is injected.
- Artifacts currently flow through conversation/runtime prompt context, not a new persistent artifact store.
