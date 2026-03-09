# Task Linkage Architecture

## Why Backend Task Linkage Exists

TinyClaw needs one backend-owned source of truth that links work across systems:

- Slack thread context (communication)
- Linear issue (planning/tracking)
- Git branch and pull request (implementation/review)

Slack, Linear, and Git are external surfaces. The canonical mapping is stored in TinyClaw task state.

## Data Model

Task linkage is stored on each task record (`tasks.json`) as `task.linkage`:

- `taskId`
- `slackChannelId`
- `slackThreadTs`
- `linearIssueId`
- `linearIssueIdentifier`
- `linearIssueUrl`
- `gitProvider`
- `repo`
- `baseBranch`
- `workingBranch`
- `pullRequestNumber`
- `pullRequestUrl`
- `currentOwnerAgentId`
- `status`

## Mapping Flow

1. Slack message arrives with `sourceMetadata.channelId` + `sourceMetadata.threadTs`.
2. Queue processor checks linkage by Slack thread.
3. If none exists, it creates a linkage-backed task.
4. Later messages in the same thread reuse the same linkage.
5. PM/Coder/Reviewer/Tester updates (owner/status/Linear/Git/PR) are written to the same task linkage.

## How Agents Should Use It

Agents (or internal adapter calls on their behalf) should read/write linkage through:

- `src/lib/task-linkage.ts`
  - `createTaskLinkage(...)`
  - `getTaskLinkageBySlackThread(...)`
  - `updateTaskLinkage(...)`
  - `attachLinearIssue(...)`
  - `attachGitBranch(...)`
  - `attachPullRequest(...)`
  - `setTaskOwner(...)`
  - `setTaskStatus(...)`

Slack integration should not own task truth; it only passes thread metadata.

## API Endpoints

Minimal inspection/update routes were added:

- `GET /api/tasks/:id/linkage`
- `GET /api/tasks/by-thread?channelId=...&threadTs=...`
- `PATCH /api/tasks/:id/linkage`
- `POST /api/tasks/:id/linkage/linear`
- `POST /api/tasks/:id/linkage/git-branch`
- `POST /api/tasks/:id/linkage/pull-request`
- `POST /api/tasks/:id/linkage/owner`
- `POST /api/tasks/:id/linkage/status`

## Example Lifecycle

1. Human starts Slack thread.
2. TinyClaw creates task + linkage (`slackChannelId`, `slackThreadTs`, owner=`pm`).
3. PM creates Linear issue, backend stores `linearIssueId` / `linearIssueIdentifier`.
4. Coder creates working branch, backend stores `repo`, `baseBranch`, `workingBranch`.
5. Coder opens PR, backend stores `pullRequestNumber`, `pullRequestUrl`.
6. Reviewer/Tester read the same linkage state from backend task storage.
