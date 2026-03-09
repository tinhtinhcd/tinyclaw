# Linear + Git Integrations (Service Identity)

## Architecture Overview

TinyClaw keeps orchestration in the backend runtime and treats external systems as adapters.

- Slack bots are only communication surfaces.
- Agents (PM, Coder, Reviewer, Tester) call internal integration services.
- Integration services call external APIs using one shared backend identity.

This keeps ownership, auditability, and permissions centralized.

## Why Service Identity

Using one backend identity instead of per-agent accounts provides:

- consistent permissions across all agents;
- easier secret management and rotation;
- simpler operational model and access revocation;
- clear audit scope for external API actions.

## Linear Adapter

Path: `src/integrations/linear/`

- `linear-client.ts`: GraphQL request helper, auth header, retry, error handling.
- `linear-issues.ts`: issue wrappers:
  - `createIssue(title, description, teamId)`
  - `updateIssueState(issueId, stateId)`
  - `getIssue(issueId)`
- `linear-comments.ts`: comment wrapper:
  - `addComment(issueId, message)`

Authentication:

- `LINEAR_API_KEY` (sent as `Authorization` header to `https://api.linear.app/graphql`)

## Git Adapter (GitHub MVP)

Path: `src/integrations/git/`

- `github-client.ts`: REST request helper, auth, retries, repo parsing.
- `repo-service.ts`:
  - `createBranch(repo, baseBranch, newBranch)`
- `pr-service.ts`:
  - `createPullRequest(repo, title, description, headBranch, baseBranch)`
  - `addPullRequestComment(repo, prNumber, message)`

Authentication:

- MVP fallback: `GITHUB_TOKEN`
- Future preferred mode: GitHub App installation tokens

## Environment Variables

Required for this MVP:

- `LINEAR_API_KEY`
- `GITHUB_TOKEN`

Optional for GitHub App migration:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_INSTALLATION_ID`

## Example Usage (from agent/internal service)

```ts
import { createIssue } from './src/integrations/linear/linear-issues';
import { addComment } from './src/integrations/linear/linear-comments';
import { createBranch } from './src/integrations/git/repo-service';
import { createPullRequest } from './src/integrations/git/pr-service';

const issue = await createIssue(
  'Implement parser fix',
  'Handle malformed payload edge case.',
  'team-id-from-linear'
);

await addComment(issue.id, 'Coder started implementation.');

await createBranch('my-org/my-repo', 'main', 'feature/parser-fix');

const pr = await createPullRequest(
  'my-org/my-repo',
  'Fix parser malformed payload handling',
  'Implements issue scope and tests.',
  'feature/parser-fix',
  'main'
);
```

No Slack coupling is required; Slack should only display resulting updates.
