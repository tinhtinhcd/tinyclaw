import { AIProvider, ProviderInvokeRequest, ProviderInvokeResult } from './types';

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterChoice {
    message?: { content?: string };
}

interface OpenRouterResponse {
    choices?: OpenRouterChoice[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    error?: { message?: string };
}

export class OpenRouterProvider implements AIProvider {
    name = 'openrouter';

    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(options?: { apiKey?: string; baseUrl?: string }) {
        this.apiKey = options?.apiKey || process.env.OPENROUTER_API_KEY || '';
        this.baseUrl = options?.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL;
    }

    async invoke(request: ProviderInvokeRequest): Promise<ProviderInvokeResult> {
        if (!this.apiKey) {
            throw new Error('OpenRouter API key is missing. Set OPENROUTER_API_KEY.');
        }
        if (!request.model) {
            throw new Error('OpenRouter model is required but was not resolved.');
        }

        const temperature = typeof request.providerOptions?.temperature === 'number'
            ? request.providerOptions.temperature
            : undefined;

        const body: Record<string, unknown> = {
            model: request.model,
            messages: [
                ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
                { role: 'user', content: request.prompt },
            ],
        };
        if (temperature !== undefined) {
            body.temperature = temperature;
        }

        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        const json = await res.json() as OpenRouterResponse;
        if (!res.ok) {
            throw new Error(json.error?.message || `OpenRouter request failed with status ${res.status}`);
        }

        const text = json.choices?.[0]?.message?.content?.trim() || '';
        if (!text) {
            throw new Error('OpenRouter returned an empty response.');
        }

        return {
            text,
            raw: json,
            usage: {
                promptTokens: json.usage?.prompt_tokens,
                completionTokens: json.usage?.completion_tokens,
                totalTokens: json.usage?.total_tokens,
            },
        };
    }
}
