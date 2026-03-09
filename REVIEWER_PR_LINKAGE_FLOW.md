# Reviewer PR Linkage Flow

## What Reviewer Consumes Automatically

When a task has linked PR context, Reviewer now receives it in runtime prompt injection via `TASK_LINKAGE_CONTEXT`.

Injected fields include:

- `taskId`
- `linearIssueIdentifier`
- `repo`
- `workingBranch`
- `pullRequestNumber`
- `pullRequestUrl`

Additionally, a reviewer-specific block is injected:

- `[REVIEWER_LINKED_PR_CONTEXT] ... [/REVIEWER_LINKED_PR_CONTEXT]`

This makes PR linkage explicit and reduces re-asking for already-linked PR data.

## Reviewer Guidance Behavior

Reviewer guidance now explicitly states:

- use linked Linear/PR context in output
- do not ask the user again for PR number/URL/repo when linkage already has them
- remain read-only for linkage mutation commands

## What Is Automatic Now

- Reviewer prompt receives PR linkage fields from backend task state.
- Reviewer output can reference linked PR/branch/issue without extra user restatement.
- Outgoing response metadata still carries `agentId` and `taskId`.

## Current Limits

- Reviewer does not yet fetch/inspect live PR diffs automatically.
- Review reasoning is linkage-context aware, but deep repository diff analysis remains future integration work.
