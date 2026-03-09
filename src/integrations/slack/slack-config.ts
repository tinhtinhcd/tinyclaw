import { getAgents, getSettings } from '../../lib/config';

export interface ResolvedSlackBotConfig {
    botId: string;
    botToken: string;
    appToken: string;
    signingSecret: string;
}

export interface ResolvedSlackConfig {
    inboundBots: ResolvedSlackBotConfig[];
    defaultInboundBot?: ResolvedSlackBotConfig;
    roleTokenByAgentId: Record<string, string>;
    validationErrors: string[];
    validationWarnings: string[];
}

function fromEnvOrValue(envName?: string, value?: string): string {
    if (value) return value;
    if (envName && process.env[envName]) return process.env[envName] || '';
    return '';
}

export function resolveSlackConfig(): ResolvedSlackConfig {
    const settings = getSettings();
    const agents = getAgents(settings);
    const slack = settings.channels?.slack;

    const validationErrors: string[] = [];
    const validationWarnings: string[] = [];
    const inboundBots: ResolvedSlackBotConfig[] = [];

    // New multi-bot config mode
    const botEntries = Object.entries(slack?.bots || {});
    for (const [botId, bot] of botEntries) {
        const botToken = fromEnvOrValue(bot.bot_token_env, bot.bot_token);
        const appToken = fromEnvOrValue(bot.app_token_env, bot.app_token);
        const signingSecret = fromEnvOrValue(bot.signing_secret_env, bot.signing_secret);
        const missing: string[] = [];
        if (!botToken) missing.push('bot token');
        if (!appToken) missing.push('app token');
        if (!signingSecret) missing.push('signing secret');
        if (missing.length > 0) {
            validationWarnings.push(`Slack bot '${botId}' skipped: missing ${missing.join(', ')}`);
            continue;
        }
        inboundBots.push({ botId, botToken, appToken, signingSecret });
    }

    // Backward compatible single-bot fallback
    if (inboundBots.length === 0) {
        const legacyBotToken = fromEnvOrValue(slack?.bot_token_env, slack?.bot_token) || process.env.SLACK_BOT_TOKEN || '';
        const legacyAppToken = fromEnvOrValue(slack?.app_token_env, slack?.app_token) || process.env.SLACK_APP_TOKEN || '';
        const legacySigningSecret = fromEnvOrValue(slack?.signing_secret_env, slack?.signing_secret) || process.env.SLACK_SIGNING_SECRET || '';

        if (legacyBotToken && legacyAppToken && legacySigningSecret) {
            inboundBots.push({
                botId: 'default',
                botToken: legacyBotToken,
                appToken: legacyAppToken,
                signingSecret: legacySigningSecret,
            });
        } else {
            validationErrors.push('No valid Slack bot credentials found. Configure channels.slack.bots.<botId>.*_env or legacy SLACK_BOT_TOKEN/SLACK_APP_TOKEN/SLACK_SIGNING_SECRET.');
        }
    }

    const botTokenByBotId = new Map<string, string>(inboundBots.map(b => [b.botId, b.botToken]));
    const roleBotMap = slack?.role_bot_map || {};

    const roleTokenByAgentId: Record<string, string> = {};
    const roleIdentities = slack?.role_identities || {}; // legacy fallback
    for (const [agentId, agent] of Object.entries(agents)) {
        const role = (agent.role || '').toLowerCase();
        if (role) {
            const mappedBotId = roleBotMap[role];
            if (mappedBotId) {
                const mappedToken = botTokenByBotId.get(mappedBotId);
                if (mappedToken) {
                    roleTokenByAgentId[agentId] = mappedToken;
                    continue;
                }
                validationWarnings.push(`Role '${role}' mapped to Slack bot '${mappedBotId}', but that bot is not configured/valid.`);
            }
        }

        if (role && roleIdentities[role]) {
            const identity = roleIdentities[role]!;
            const token = fromEnvOrValue(identity.bot_token_env, identity.bot_token);
            if (token) {
                roleTokenByAgentId[agentId] = token;
            }
        }
    }

    const defaultBotId = slack?.default_bot_id;
    const defaultInboundBot = defaultBotId
        ? inboundBots.find(b => b.botId === defaultBotId)
        : inboundBots[0];
    if (defaultBotId && !defaultInboundBot) {
        validationWarnings.push(`default_bot_id '${defaultBotId}' not found among valid Slack bots; using first valid bot.`);
    }

    return {
        inboundBots,
        defaultInboundBot,
        roleTokenByAgentId,
        validationErrors,
        validationWarnings,
    };
}
