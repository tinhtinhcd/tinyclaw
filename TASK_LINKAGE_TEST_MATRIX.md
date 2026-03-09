# Task Linkage Test Matrix

## Coverage Scope

Focused unit-level command-validation coverage for `task_linkage` behavior:

- role-based command permissions
- payload validation requirements
- task-state guard behavior (duplicate/overwrite rules)

Tests are intentionally not Slack E2E; they validate backend decision logic directly.

## Covered Cases

### Role Contract

- PM
  - accepts: `create_linear_issue`, `attach_linear`
  - rejects: `create_git_branch`, `create_pull_request`
- Coder
  - accepts: `create_git_branch`, `attach_git_branch`, `create_pull_request`
  - rejects: `create_linear_issue`
- Reviewer
  - rejects all mutation commands
- Tester
  - rejects all mutation commands

### Payload Validation

- reject `create_linear_issue` without `title`
- reject `create_linear_issue` without `description`
- reject `attach_git_branch` without `repo`
- reject `attach_git_branch` without `workingBranch`
- reject `create_pull_request` without `title`
- reject `attach_pull_request` without both `pullRequestNumber` and `pullRequestUrl`

### State Guards

- reject duplicate Linear creation when already linked
- reject duplicate branch creation when `workingBranch` already linked
- reject duplicate PR creation when PR already linked
- allow overwrite when `force="true"` or `allowOverwrite="true"`

## Why These Tests Matter

- Prevents role drift (e.g., PM mutating git linkage).
- Protects linkage integrity under repeated or malformed commands.
- Keeps prompt-level behavior and backend enforcement aligned.
- Provides fast regression checks without external API dependencies.

## Still Untested

- Full command execution side effects (actual Linear/Git API calls).
- Queue-processor integration with real multi-agent conversations.
- Log-line assertions and telemetry formatting.

These can be added later as integration tests with controlled adapter mocks.
