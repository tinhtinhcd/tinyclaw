import { linearGraphQLRequest } from './linear-client';

interface CommentResponse {
    commentCreate?: {
        success: boolean;
        comment?: {
            id: string;
            body: string;
        };
    };
}

export async function addComment(issueId: string, message: string): Promise<NonNullable<CommentResponse['commentCreate']>['comment']> {
    const mutation = `
      mutation AddComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment { id body }
        }
      }
    `;

    const data = await linearGraphQLRequest<CommentResponse>(mutation, {
        issueId,
        body: message,
    });
    if (!data.commentCreate?.success || !data.commentCreate.comment) {
        throw new Error('Failed to add Linear comment.');
    }
    return data.commentCreate.comment;
}
