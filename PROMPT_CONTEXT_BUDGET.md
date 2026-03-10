# Prompt Context Budget

## Purpose

Reviewer/tester prompt enrichment can grow quickly with linked PR metadata, fetched PR details, and synthesized testing focus.  
This guardrail applies a predictable character budget to context blocks before they are appended to prompts.

## Where Applied

Budgeting is applied in `src/runtime/prompt-context.ts`, after context blocks are built and before they are concatenated into the final message prompt.

Core helper: `src/lib/context-budget.ts`

## Priority Order

Higher priority blocks are kept first:

1. `TASK_LINKAGE_CONTEXT` (highest, always preserved at least in truncated form)
2. `REVIEWER_LINKED_PR_CONTEXT`, `TESTER_LINKED_PR_CONTEXT`
3. `REVIEWER_FETCHED_PR_CONTEXT`, `TESTER_FETCHED_PR_CONTEXT`
4. `TESTER_SYNTHESIZED_FOCUS` (lowest)

## Truncation Behavior

- Blocks are sorted by priority.
- Blocks are kept until budget is exhausted.
- If a block partially fits, it is truncated with:
  - `... (truncated)`
- Lowest-priority blocks may be dropped entirely if no room remains.

## Explicit Section Caps

- Fetched PR files preview: max 10 files
- Fetched PR body: max 1500 chars
- Tester synthesized focus block: max 1200 chars

## Configuration

- `PROMPT_CONTEXT_MAX_CHARS` controls the total budget.
- Default: `12000` characters.

## Observability Events

When budget logic changes content:

- `context_budget_truncation`
  - metadata: `blockName`, `originalLength`, `truncatedLength`, `maxChars`
- `context_block_dropped`
  - metadata: `blockName`, `originalLength`, `maxChars`
- `context_budget_applied`
  - metadata: `maxChars`, `originalBlocks`, `keptBlocks`

## Extension Guidelines

- Prefer adding new context as a named block with explicit priority.
- Keep heavyweight sections capped at source (before global budgeting).
- Use budget truncation as a last-resort guardrail, not as primary formatting logic.
