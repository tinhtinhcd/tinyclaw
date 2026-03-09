# Tester PR Fetch Context

## What Tester Sees

Tester now receives linked PR context from shared task linkage automatically:

- `taskId`
- `linearIssueIdentifier`
- `repo`
- `workingBranch`
- `pullRequestNumber`
- `pullRequestUrl`

Injected blocks:

- `[TASK_LINKAGE_CONTEXT]`
- `[TESTER_LINKED_PR_CONTEXT]`
- `[TESTER_SYNTHESIZED_FOCUS]` (when enough context exists)

## Optional Fetched PR Context

When linked PR data is available and fetch succeeds (GitHub-first), tester prompt also includes:

- `[TESTER_FETCHED_PR_CONTEXT]`
- enriched `[TESTER_SYNTHESIZED_FOCUS]` derived from fetched PR details

with compact read-only PR details:

- title
- state
- base/head branches
- additions/deletions summary
- changed files preview (compact)

## Synthesized Focus Heuristics

`[TESTER_SYNTHESIZED_FOCUS]` uses lightweight heuristics from available linkage/fetch data:

- affected modules from changed-file top-level paths
- likely risk hotspots (auth/API/data model/large diff patterns)
- suggested validation checklist
- possible regression focus summary

If only partial linkage exists (e.g., repo/branch but no fetched PR), the block degrades to partial guidance.

## Fallback Behavior

- If PR fetch fails, tester flow continues normally.
- Prompt falls back to linkage-only context blocks.
- No mutation behavior is introduced by fetch path.

## Current Limitations

- Fetch path is GitHub-first only.
- No live patch-level diff analysis yet.
- No write/comment mutation path (intentionally read-only).
