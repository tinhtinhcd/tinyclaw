export interface LinearGraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

const DEFAULT_LINEAR_URL = 'https://api.linear.app/graphql';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function linearGraphQLRequest<T>(
    query: string,
    variables: Record<string, unknown> = {},
    options: { retries?: number; linearApiKey?: string; endpoint?: string } = {},
): Promise<T> {
    const linearApiKey = options.linearApiKey || process.env.LINEAR_API_KEY || '';
    const endpoint = options.endpoint || DEFAULT_LINEAR_URL;
    const retries = options.retries ?? 2;

    if (!linearApiKey) {
        throw new Error('LINEAR_API_KEY is missing.');
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: linearApiKey,
                },
                body: JSON.stringify({ query, variables }),
            });

            const json = await res.json() as LinearGraphQLResponse<T>;
            if (!res.ok) {
                throw new Error(`Linear API request failed with status ${res.status}`);
            }
            if (json.errors && json.errors.length > 0) {
                throw new Error(`Linear GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
            }
            if (!json.data) {
                throw new Error('Linear GraphQL response has no data.');
            }

            return json.data;
        } catch (err) {
            lastError = err as Error;
            if (attempt < retries) {
                await sleep(250 * (attempt + 1));
                continue;
            }
        }
    }

    throw lastError || new Error('Linear request failed.');
}
