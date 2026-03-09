import { Settings } from '../types';
import { ClaudeProvider } from './claude';
import { CodexProvider } from './codex';
import { OpenCodeProvider } from './opencode';
import { OpenRouterProvider } from './openrouter';
import { AIProvider, ProviderFactoryContext } from './types';

export function normalizeProviderName(provider: string): string {
    const p = (provider || '').toLowerCase();
    if (p === 'claude') return 'anthropic';
    if (p === 'codex') return 'openai';
    return p;
}

function resolveCustomProvider(
    settings: Settings,
    providerId: string,
): { provider: string; envOverrides: Record<string, string>; model?: string } {
    const customProvider = settings.custom_providers?.[providerId];
    if (!customProvider) {
        throw new Error(`Custom provider '${providerId}' not found in settings.custom_providers`);
    }

    if (customProvider.harness === 'claude') {
        return {
            provider: 'anthropic',
            envOverrides: {
                ANTHROPIC_BASE_URL: customProvider.base_url,
                ANTHROPIC_AUTH_TOKEN: customProvider.api_key,
                ANTHROPIC_API_KEY: '',
            },
            model: customProvider.model,
        };
    }

    return {
        provider: 'openai',
        envOverrides: {
            OPENAI_API_KEY: customProvider.api_key,
            OPENAI_BASE_URL: customProvider.base_url,
        },
        model: customProvider.model,
    };
}

export function createProvider(
    providerName: string,
    context: ProviderFactoryContext,
): { provider: AIProvider; modelOverride?: string } {
    const normalized = normalizeProviderName(providerName || '');

    if (normalized.startsWith('custom:')) {
        const customId = normalized.slice('custom:'.length);
        const resolved = resolveCustomProvider(context.settings, customId);
        if (resolved.provider === 'anthropic') {
            return { provider: new ClaudeProvider(resolved.envOverrides), modelOverride: resolved.model };
        }
        return { provider: new CodexProvider(resolved.envOverrides), modelOverride: resolved.model };
    }

    if (normalized === 'openrouter') {
        return { provider: new OpenRouterProvider() };
    }
    if (normalized === 'openai') {
        const envOverrides: Record<string, string> = {};
        if (context.settings.models?.openai?.auth_token) {
            envOverrides.OPENAI_API_KEY = context.settings.models.openai.auth_token;
        }
        return { provider: new CodexProvider(envOverrides) };
    }
    if (normalized === 'opencode') {
        return { provider: new OpenCodeProvider() };
    }
    if (normalized === 'anthropic' || normalized === '') {
        const envOverrides: Record<string, string> = {};
        if (context.settings.models?.anthropic?.auth_token) {
            envOverrides.ANTHROPIC_API_KEY = context.settings.models.anthropic.auth_token;
        }
        return { provider: new ClaudeProvider(envOverrides) };
    }

    throw new Error(`Unsupported provider '${providerName}'. Supported: anthropic, openai, opencode, openrouter, custom:<id>.`);
}
