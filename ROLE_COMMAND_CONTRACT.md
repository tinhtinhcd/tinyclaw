# Role Command Contract

## Purpose

`task_linkage` commands are backend-enforced with role permissions and payload validation so agents cannot mutate linkage arbitrarily.

## Role Permissions (MVP)

- `PM`
  - allowed: `attach_linear`, `create_linear_issue`
  - rejected: `attach_git_branch`, `create_git_branch`, `attach_pull_request`, `create_pull_request`
- `Coder`
  - allowed: `attach_git_branch`, `create_git_branch`, `attach_pull_request`, `create_pull_request`
  - rejected: `attach_linear`, `create_linear_issue`
- `Reviewer`
  - allowed: none (read-only linkage usage)
- `Tester`
  - allowed: none (read-only linkage usage)

## Payload Requirements

- `attach_linear`
  - required: `linearIssueId`, `linearIssueIdentifier`
- `create_linear_issue`
  - required: `title`, `description`, `teamId`
- `attach_git_branch`
  - required: `repo`, `workingBranch`
  - also needs `baseBranch` (can be provided or reused from existing linkage)
- `create_git_branch`
  - required: `workingBranch`
  - also needs `repo` + `baseBranch` (can be provided or reused from existing linkage)
- `attach_pull_request`
  - required: `pullRequestNumber` or `pullRequestUrl`
  - if one is missing, existing linkage may be reused
- `create_pull_request`
  - required: `title`, `description`
  - also needs `repo`, `headBranch`, `baseBranch` (can be provided or reused from existing linkage)

## Task-State Guards

Without `force="true"` (or `allowOverwrite="true"`):

- reject creating a Linear issue when one is already linked
- reject creating a branch when `workingBranch` already linked
- reject creating a PR when a PR is already linked
- reject overwriting existing linked Linear/branch/PR values with different values

## Rejected Behavior

Rejected commands are:

- logged with reason
- ignored safely
- stripped from user-facing response text

This keeps orchestration running while preventing invalid/unsafe linkage mutations.

## Valid / Invalid Examples

Valid PM:

`[task_linkage action="create_linear_issue" title="Parser fix" description="Handle malformed payload." teamId="abc123"]`

Invalid PM (role violation):

`[task_linkage action="create_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]`

Valid Coder (reuse linkage repo/base):

`[task_linkage action="create_git_branch" workingBranch="feature/x"]`

Invalid Coder (missing required):

`[task_linkage action="create_pull_request" title="Fix" description="..." ]`

## Future Extension Points

- move contract into configurable policy (settings-based role permissions)
- add GitLab-specific command variants
- add richer schema validation (typed parser instead of key/value regex)
