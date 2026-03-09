import { linearGraphQLRequest } from './linear-client';

interface IssueResponse {
    issueCreate?: {
        success: boolean;
        issue?: {
            id: string;
            title: string;
            identifier: string;
            url: string;
        };
    };
    issueUpdate?: {
        success: boolean;
        issue?: {
            id: string;
            state?: { id: string; name: string };
        };
    };
    issue?: {
        id: string;
        title: string;
        description?: string;
        state?: { id: string; name: string };
        url: string;
        identifier: string;
    };
}

export async function createIssue(title: string, description: string, teamId: string): Promise<NonNullable<IssueResponse['issueCreate']>['issue']> {
    const mutation = `
      mutation CreateIssue($title: String!, $description: String!, $teamId: String!) {
        issueCreate(input: { title: $title, description: $description, teamId: $teamId }) {
          success
          issue { id title identifier url }
        }
      }
    `;

    const data = await linearGraphQLRequest<IssueResponse>(mutation, { title, description, teamId });
    if (!data.issueCreate?.success || !data.issueCreate.issue) {
        throw new Error('Failed to create Linear issue.');
    }
    return data.issueCreate.issue;
}

export async function updateIssueState(issueId: string, stateId: string): Promise<NonNullable<IssueResponse['issueUpdate']>['issue']> {
    const mutation = `
      mutation UpdateIssueState($issueId: String!, $stateId: String!) {
        issueUpdate(id: $issueId, input: { stateId: $stateId }) {
          success
          issue { id state { id name } }
        }
      }
    `;

    const data = await linearGraphQLRequest<IssueResponse>(mutation, { issueId, stateId });
    if (!data.issueUpdate?.success || !data.issueUpdate.issue) {
        throw new Error('Failed to update Linear issue state.');
    }
    return data.issueUpdate.issue;
}

export async function getIssue(issueId: string): Promise<NonNullable<IssueResponse['issue']>> {
    const query = `
      query GetIssue($issueId: String!) {
        issue(id: $issueId) {
          id
          title
          description
          identifier
          url
          state { id name }
        }
      }
    `;

    const data = await linearGraphQLRequest<IssueResponse>(query, { issueId });
    if (!data.issue) {
        throw new Error(`Linear issue '${issueId}' not found.`);
    }
    return data.issue;
}
