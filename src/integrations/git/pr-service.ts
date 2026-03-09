import { githubRequest, parseRepo } from './github-client';

interface CreatePullRequestResponse {
    number: number;
    html_url: string;
    state: string;
}

interface PullRequestCommentResponse {
    id: number;
    html_url: string;
    body: string;
}

interface PullRequestDetailsResponse {
    number: number;
    title: string;
    state: string;
    body: string | null;
    html_url: string;
    base: { ref: string };
    head: { ref: string };
    additions: number;
    deletions: number;
    changed_files: number;
}

interface PullRequestFileResponse {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
}

export async function createPullRequest(
    repo: string,
    title: string,
    description: string,
    headBranch: string,
    baseBranch: string,
): Promise<{ number: number; url: string; state: string }> {
    const { owner, repo: name } = parseRepo(repo);
    const pr = await githubRequest<CreatePullRequestResponse>(`/repos/${owner}/${name}/pulls`, {
        method: 'POST',
        body: {
            title,
            body: description,
            head: headBranch,
            base: baseBranch,
        },
    });

    return {
        number: pr.number,
        url: pr.html_url,
        state: pr.state,
    };
}

export async function addPullRequestComment(
    repo: string,
    prNumber: number,
    message: string,
): Promise<{ id: number; url: string; body: string }> {
    const { owner, repo: name } = parseRepo(repo);
    const comment = await githubRequest<PullRequestCommentResponse>(
        `/repos/${owner}/${name}/issues/${prNumber}/comments`,
        {
            method: 'POST',
            body: { body: message },
        },
    );

    return {
        id: comment.id,
        url: comment.html_url,
        body: comment.body,
    };
}

export async function getPullRequestDetails(
    repo: string,
    prNumber: number,
): Promise<{
    number: number;
    title: string;
    state: string;
    url: string;
    body?: string;
    baseBranch: string;
    headBranch: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    files: Array<{ path: string; status: string; additions: number; deletions: number }>;
}> {
    const { owner, repo: name } = parseRepo(repo);
    const pr = await githubRequest<PullRequestDetailsResponse>(
        `/repos/${owner}/${name}/pulls/${prNumber}`,
    );
    const files = await githubRequest<PullRequestFileResponse[]>(
        `/repos/${owner}/${name}/pulls/${prNumber}/files?per_page=20`,
    );

    return {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.html_url,
        body: pr.body || undefined,
        baseBranch: pr.base.ref,
        headBranch: pr.head.ref,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        files: files.map(f => ({
            path: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
        })),
    };
}
