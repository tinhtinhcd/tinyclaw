import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import {
    Settings, AgentConfig, TeamConfig, RuntimeAgentConfig,
    CLAUDE_MODEL_IDS, CODEX_MODEL_IDS, OPENCODE_MODEL_IDS,
} from './types';
import { normalizeProviderName } from './providers';

export const SCRIPT_DIR = path.resolve(__dirname, '../..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
export const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
export const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
export const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
export const CHATS_DIR = path.join(TINYCLAW_HOME, 'chats');
export const FILES_DIR = path.join(TINYCLAW_HOME, 'files');

function getDefaultProviderFromEnv(): string {
    return normalizeProviderName(process.env.DEFAULT_PROVIDER || '');
}

function getDefaultModelByProviderFromEnv(provider: string): string {
    const normalized = normalizeProviderName(provider);
    if (normalized === 'openrouter') return process.env.OPENROUTER_DEFAULT_MODEL || process.env.OPENROUTER_MODEL || '';
    if (normalized === 'openai') return process.env.CODEX_DEFAULT_MODEL || '';
    if (normalized === 'opencode') return process.env.OPENCODE_DEFAULT_MODEL || '';
    return process.env.CLAUDE_DEFAULT_MODEL || '';
}

function normalizeSettings(settings: Settings): Settings {
    const normalized = { ...settings };

    // Backward compatibility with legacy models.* section.
    // If defaults are missing, derive them from models.
    if (!normalized.defaults) normalized.defaults = {};
    if (!normalized.defaults.models) normalized.defaults.models = {};

    if (!normalized.defaults.provider) {
        if (normalized?.models?.provider) {
            normalized.defaults.provider = normalizeProviderName(normalized.models.provider);
        } else if (normalized?.models?.openai) {
            normalized.defaults.provider = 'openai';
        } else if (normalized?.models?.opencode) {
            normalized.defaults.provider = 'opencode';
        } else if (normalized?.models?.anthropic) {
            normalized.defaults.provider = 'anthropic';
        }
    }

    if (!normalized.defaults.models.openai && normalized?.models?.openai?.model) {
        normalized.defaults.models.openai = normalized.models.openai.model;
    }
    if (!normalized.defaults.models.opencode && normalized?.models?.opencode?.model) {
        normalized.defaults.models.opencode = normalized.models.opencode.model;
    }
    if (!normalized.defaults.models.anthropic && normalized?.models?.anthropic?.model) {
        normalized.defaults.models.anthropic = normalized.models.anthropic.model;
    }

    return normalized;
}

function getLegacyModelForProvider(settings: Settings, provider: string): string {
    if (provider === 'openai') return settings.models?.openai?.model || '';
    if (provider === 'opencode') return settings.models?.opencode?.model || '';
    if (provider === 'anthropic') return settings.models?.anthropic?.model || '';
    return '';
}

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        let settings: Settings;

        try {
            settings = JSON.parse(settingsData);
        } catch (parseError) {
            // JSON is invalid — attempt auto-fix with jsonrepair
            console.error(`[WARN] settings.json contains invalid JSON: ${(parseError as Error).message}`);

            try {
                const repaired = jsonrepair(settingsData);
                settings = JSON.parse(repaired);

                // Write the fixed JSON back and create a backup
                const backupPath = SETTINGS_FILE + '.bak';
                fs.copyFileSync(SETTINGS_FILE, backupPath);
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
                console.error(`[WARN] Auto-fixed settings.json (backup: ${backupPath})`);
            } catch {
                console.error(`[ERROR] Could not auto-fix settings.json — returning empty config`);
                return {};
            }
        }

        return normalizeSettings(settings);
    } catch {
        return normalizeSettings({});
    }
}

/**
 * Build the default agent config from the legacy models section.
 * Used when no agents are configured, for backwards compatibility.
 */
export function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = normalizeProviderName(
        settings?.defaults?.provider
        || settings?.models?.provider
        || getDefaultProviderFromEnv()
        || 'anthropic',
    );
    const model = settings?.defaults?.models?.[provider]
        || getLegacyModelForProvider(settings, provider)
        || getDefaultModelByProviderFromEnv(provider)
        || (provider === 'openai' ? 'gpt-5.3-codex' : 'sonnet');

    // Get workspace path from settings or use default
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const defaultAgentDir = path.join(workspacePath, 'default');

    return {
        name: 'Default',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

/**
 * Get all configured agents. Falls back to a single "default" agent
 * derived from the legacy models section if no agents are configured.
 */
export function getAgents(settings: Settings): Record<string, AgentConfig> {
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    // Fall back to default agent from models section
    return { default: getDefaultAgentFromModels(settings) };
}

/**
 * Resolve final runtime provider/model/options for an agent using:
 * explicit agent config -> roleDefaults -> defaults -> env fallbacks.
 */
export function resolveAgentRuntimeConfig(
    agentId: string,
    agent: AgentConfig,
    settings: Settings,
): RuntimeAgentConfig {
    const roleDefaults = agent.role ? settings.roleDefaults?.[agent.role] : undefined;
    const agentDefaults = settings.agentDefaults;

    const defaultProvider = normalizeProviderName(
        settings.defaults?.provider
        || settings.models?.provider
        || getDefaultProviderFromEnv()
        || 'anthropic',
    );

    const provider = normalizeProviderName(
        agent.provider
        || roleDefaults?.provider
        || agentDefaults?.provider
        || defaultProvider,
    );

    const model = agent.model
        || roleDefaults?.model
        || agentDefaults?.model
        || settings.defaults?.models?.[provider]
        || (provider === 'openai' ? settings.models?.openai?.model : undefined)
        || (provider === 'opencode' ? settings.models?.opencode?.model : undefined)
        || (provider === 'anthropic' ? settings.models?.anthropic?.model : undefined)
        || getDefaultModelByProviderFromEnv(provider)
        || '';

    if (!provider) {
        throw new Error(`Agent '${agentId}' has no provider after configuration resolution.`);
    }
    if (!model && !provider.startsWith('custom:')) {
        throw new Error(`Agent '${agentId}' has no model configured for provider '${provider}'.`);
    }

    const providerOptions = {
        ...(settings.defaults?.providerOptions?.[provider] || {}),
        ...(agentDefaults?.providerOptions || {}),
        ...(roleDefaults?.providerOptions || {}),
        ...(agent.providerOptions || {}),
    };

    return {
        provider,
        model,
        providerOptions: Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
    };
}

/**
 * Get all configured teams.
 */
export function getTeams(settings: Settings): Record<string, TeamConfig> {
    return settings.teams || {};
}

/**
 * Resolve the model ID for Claude (Anthropic).
 */
export function resolveClaudeModel(model: string): string {
    return CLAUDE_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for Codex (OpenAI).
 */
export function resolveCodexModel(model: string): string {
    return CODEX_MODEL_IDS[model] || model || '';
}

/**
 * Resolve the model ID for OpenCode (passed via --model flag).
 * Falls back to the raw model string from settings if no mapping is found.
 */
export function resolveOpenCodeModel(model: string): string {
    return OPENCODE_MODEL_IDS[model] || model || '';
}
