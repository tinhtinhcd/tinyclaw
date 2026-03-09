export interface GitHubRepoRef {
    owner: string;
    repo: string;
}

interface GitHubRequestOptions {
    method?: string;
    body?: unknown;
    retries?: number;
    githubToken?: string;
}

const DEFAULT_BASE_URL = 'https://api.github.com';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function parseRepo(repo: string): GitHubRepoRef {
    const [owner, name] = repo.split('/');
    if (!owner || !name) {
        throw new Error(`Invalid repo format '${repo}'. Expected 'owner/repo'.`);
    }
    return { owner, repo: name };
}

export async function githubRequest<T>(
    path: string,
    options: GitHubRequestOptions = {},
): Promise<T> {
    const token = options.githubToken || process.env.GITHUB_TOKEN || '';
    const retries = options.retries ?? 2;
    const method = options.method || 'GET';

    if (!token) {
        throw new Error('GITHUB_TOKEN is missing.');
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${DEFAULT_BASE_URL}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json',
                },
                body: options.body ? JSON.stringify(options.body) : undefined,
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`GitHub API ${method} ${path} failed (${res.status}): ${text}`);
            }

            if (res.status === 204) {
                return {} as T;
            }

            return await res.json() as T;
        } catch (err) {
            lastError = err as Error;
            if (attempt < retries) {
                await sleep(250 * (attempt + 1));
                continue;
            }
        }
    }

    throw lastError || new Error('GitHub request failed.');
}
