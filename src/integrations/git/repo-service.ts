import { githubRequest, parseRepo } from './github-client';

interface RefResponse {
    object: {
        sha: string;
    };
}

interface CreateRefResponse {
    ref: string;
    object: {
        sha: string;
    };
}

export async function createBranch(
    repo: string,
    baseBranch: string,
    newBranch: string,
): Promise<{ ref: string; sha: string }> {
    const { owner, repo: name } = parseRepo(repo);
    const baseRef = await githubRequest<RefResponse>(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(baseBranch)}`);

    const created = await githubRequest<CreateRefResponse>(`/repos/${owner}/${name}/git/refs`, {
        method: 'POST',
        body: {
            ref: `refs/heads/${newBranch}`,
            sha: baseRef.object.sha,
        },
    });

    return { ref: created.ref, sha: created.object.sha };
}
