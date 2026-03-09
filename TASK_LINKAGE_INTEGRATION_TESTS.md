# Task Linkage Integration Tests

## What Is Covered

Focused integration-style tests for `applyTaskLinkageCommands(...)` side effects:

- accepted commands mutate linkage state
- rejected commands do not mutate linkage
- `task_linkage` tags are stripped from user-facing output text

## What Is Mocked

Tests use injected dependency stubs for:

- Linear adapter: `createIssue(...)`
- Git adapter: `createBranch(...)`, `createPullRequest(...)`
- Linkage persistence operations:
  - `getTaskLinkage(...)`
  - `attachLinearIssue(...)`
  - `attachGitBranch(...)`
  - `attachPullRequest(...)`

This keeps tests fast, deterministic, and independent of external APIs/filesystem.

## Side Effects Verified

- `create_linear_issue` calls mocked Linear API and writes linked Linear issue fields.
- `create_git_branch` calls mocked branch creation and writes repo/base/working branch linkage.
- `create_pull_request` calls mocked PR creation and writes PR number/url linkage.

## Rejection Behavior Verified

- role-rejected command (e.g., PM trying git command) does not mutate linkage.
- payload-invalid command (missing required fields) does not mutate linkage.
- state-guard rejected command (duplicate PR creation) does not mutate linkage.

## Response Cleanup Verified

- Responses containing one or multiple `task_linkage` tags return cleaned text with all tags removed.
- Non-command text remains intact in the cleaned response.

## Remaining Gaps

- No full queue-processor integration test with real conversation routing.
- No assertion of actual log output text.
- No live external API verification (intentionally mocked in this layer).
