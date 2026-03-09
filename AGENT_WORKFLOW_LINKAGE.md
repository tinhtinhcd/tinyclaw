# Agent Workflow Linkage

## What Is Automatic Now

PM, Coder, Reviewer, and Tester now use shared backend task linkage during execution through the queue processor path.

Automatic behavior:

- Slack thread is resolved to one backend linkage task.
- Role ownership/state updates are applied when each role starts processing.
- Linkage context (Linear/Git/PR/owner/status) is injected into role prompts.
- Optional `task_linkage` command lines in agent output are parsed and applied.

## Role-by-Role Behavior

### PM

- Resolves linkage for the Slack thread task.
- Sets owner to PM and status to `in_progress`.
- Sees current linkage context.
- If no Linear issue exists, PM can emit:
  - `attach_linear` (manual issue already created), or
  - `create_linear_issue` (backend creates via Linear API and links it).

### Coder

- Resolves the same linkage.
- Sets owner to Coder and status to `in_progress`.
- Sees linked repo/base branch/working branch/PR.
- Can emit:
  - `attach_git_branch`
  - `create_git_branch` (backend creates branch then links it)
  - `attach_pull_request`
  - `create_pull_request` (backend creates PR then links it)

### Reviewer

- Resolves the same linkage.
- Sets owner to Reviewer and status to `review`.
- Receives linkage context including Linear and PR details to guide output.

### Tester

- Resolves the same linkage.
- Sets owner to Tester and status to `review`.
- Receives linkage context including Linear and PR details for validation output.

## task_linkage Command Format

Commands are single-line tags in agent output:

- `[task_linkage action="attach_linear" linearIssueId="..." linearIssueIdentifier="ENG-123" linearIssueUrl="..."]`
- `[task_linkage action="create_linear_issue" title="..." description="..." teamId="..."]`
- `[task_linkage action="attach_git_branch" gitProvider="github" repo="org/repo" baseBranch="main" workingBranch="feature/x"]`
- `[task_linkage action="create_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]`
- `[task_linkage action="attach_pull_request" pullRequestNumber="123" pullRequestUrl="https://..."]`
- `[task_linkage action="create_pull_request" repo="org/repo" title="..." description="..." headBranch="feature/x" baseBranch="main"]`

These tags are applied by backend and stripped from user-visible reply text.

## What Remains Manual / Future Work

- Role prompts can be further tuned to consistently emit `task_linkage` commands.
- Provider-specific policies/validation for GitHub vs GitLab can be added.
- Automatic inference from plain-text output (without explicit commands) is not added yet.
