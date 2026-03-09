# Role Prompt Guidance

## Purpose

This guidance keeps agent output aligned with backend command enforcement in `ROLE_COMMAND_CONTRACT.md`.

Backend remains the final authority; prompts reduce invalid command attempts.

## Injection Point

Guidance is injected at runtime through `TASK_LINKAGE_CONTEXT` in:

- `src/lib/task-linkage-workflow.ts` (`buildTaskLinkageContext` + `buildRolePromptGuidance`)
- appended by `src/queue-processor.ts` before agent invocation

This is the minimal shared place used by PM/Coder/Reviewer/Tester during task execution.

## PM Guidance

- May emit only:
  - `create_linear_issue`
  - `attach_linear`
- Must not emit Git/PR mutation commands.
- Reuse existing linked Linear issue when present.
- Avoid command emission when task context is underspecified.

Examples:

- valid: `[task_linkage action="create_linear_issue" title="Fix parser bug" description="Handle malformed payload." teamId="abc123"]`
- valid: `[task_linkage action="attach_linear" linearIssueId="uuid" linearIssueIdentifier="ENG-123" linearIssueUrl="https://linear.app/..."]`
- invalid: `[task_linkage action="create_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]`

## Coder Guidance

- May emit only:
  - `create_git_branch`
  - `attach_git_branch`
  - `create_pull_request`
  - `attach_pull_request`
- Should read existing linkage first and reuse repo/base/branch values.
- Should not create Linear issue by default.

Examples:

- valid: `[task_linkage action="create_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]`
- valid: `[task_linkage action="create_pull_request" repo="org/repo" title="Fix parser bug" description="Implements fix." headBranch="feature/x" baseBranch="main"]`
- invalid: `[task_linkage action="create_linear_issue" title="..." description="..." teamId="..."]`

## Reviewer Guidance

- Read-only for linkage mutation commands.
- Uses linkage context in analysis and review output.
- Must not emit mutation commands.

Examples:

- invalid: `[task_linkage action="attach_pull_request" pullRequestNumber="123" pullRequestUrl="https://..."]`
- avoid: any `[task_linkage ...]` mutation tag

## Tester Guidance

- Read-only for linkage mutation commands.
- Uses linkage context in validation/testing output.
- Must not emit mutation commands.

Examples:

- invalid: `[task_linkage action="attach_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]`
- avoid: any `[task_linkage ...]` mutation tag

## Backend + Prompt Alignment

- Prompts provide concise role-specific expectations.
- Backend validates permissions, payloads, and state guards regardless of prompt behavior.
- Invalid tags are rejected, logged, and stripped from user-visible output.
