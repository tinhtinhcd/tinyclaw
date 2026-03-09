# Reviewer PR Fetch Context

## What Is Fetched (Read-Only)

When Reviewer processes a task with linked PR data (`repo` + PR number/url), TinyClaw can fetch compact PR details (GitHub-first):

- PR title
- PR state
- base branch
- head branch
- PR body/description
- additions/deletions summary
- changed file count
- compact changed files preview (up to 10 entries shown in prompt block)

## What Is Injected

If fetch succeeds, reviewer prompt includes:

- `[REVIEWER_FETCHED_PR_CONTEXT] ... [/REVIEWER_FETCHED_PR_CONTEXT]`

This is appended in addition to linkage-only blocks:

- `[TASK_LINKAGE_CONTEXT]`
- `[REVIEWER_LINKED_PR_CONTEXT]`

## Fallback Behavior

- If fetch fails (API/network/provider mismatch), reviewer flow continues.
- Prompt falls back to linkage-only context.
- Runtime logs a warning and does not break message processing.
- No linkage mutation is introduced by fetch path (read-only only).

## Current Limits

- GitHub-first implementation only.
- No live diff patch/body truncation sophistication yet.
- No reviewer auto-comments or write operations (intentionally read-only).
