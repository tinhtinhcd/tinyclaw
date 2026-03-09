export interface CustomProvider {
    name: string;
    harness: 'claude' | 'codex';  // which CLI to invoke
    base_url: string;
    api_key: string;
    model?: string;               // model name to pass to the CLI
}

export interface AgentConfig {
    name: string;
    role?: string;
    provider?: string;       // e.g. 'anthropic', 'openai', 'opencode', 'openrouter', or 'custom:<provider_id>'
    model?: string;          // provider-specific model id
    providerOptions?: Record<string, unknown>;
    working_directory: string;
    system_prompt?: string;
    prompt_file?: string;
}

export interface RuntimeAgentConfig {
    provider: string;
    model: string;
    providerOptions?: Record<string, unknown>;
}

export interface AgentRoleDefault {
    provider?: string;
    model?: string;
    providerOptions?: Record<string, unknown>;
}

export interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
    workflow?: {
        type: 'dev_pipeline';
        pm: string;
        coder: string;
        reviewer: string;
        tester: string;
    };
}

export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done';

export interface TaskLinkage {
    taskId: string;
    slackChannelId?: string;
    slackThreadTs?: string;
    linearIssueId?: string;
    linearIssueIdentifier?: string;
    linearIssueUrl?: string;
    gitProvider?: string;
    repo?: string;
    baseBranch?: string;
    workingBranch?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    currentOwnerAgentId?: string;
    status?: TaskStatus;
}

export interface Task {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    assignee: string;       // agent or team id, empty = unassigned
    assigneeType: 'agent' | 'team' | '';
    createdAt: number;
    updatedAt: number;
    linkage?: TaskLinkage;
}

export interface ChainStep {
    agentId: string;
    response: string;
}

export interface Settings {
    workspace?: {
        path?: string;
        name?: string;
    };
    channels?: {
        enabled?: string[];
        discord?: { bot_token?: string };
        telegram?: { bot_token?: string };
        whatsapp?: {};
        slack?: {
            // Legacy single-bot fields (still supported)
            bot_token?: string;
            app_token?: string;
            signing_secret?: string;
            bot_token_env?: string;
            app_token_env?: string;
            signing_secret_env?: string;
            // New multi-bot config
            bots?: Record<string, {
                bot_token?: string;
                app_token?: string;
                signing_secret?: string;
                bot_token_env?: string;
                app_token_env?: string;
                signing_secret_env?: string;
            }>;
            role_bot_map?: Record<string, string>;
            default_bot_id?: string;
            // Legacy outbound role token mapping (kept for backward compatibility)
            role_identities?: Record<string, {
                bot_token?: string;
                bot_token_env?: string;
            }>;
        };
    };
    models?: {
        provider?: string; // 'anthropic', 'openai', or 'opencode'
        anthropic?: {
            model?: string;
            auth_token?: string;
        };
        openai?: {
            model?: string;
            auth_token?: string;
        };
        opencode?: {
            model?: string;
        };
    };
    defaults?: {
        provider?: string;
        models?: Record<string, string>;
        providerOptions?: Record<string, Record<string, unknown>>;
    };
    roleDefaults?: Record<string, AgentRoleDefault>;
    agentDefaults?: AgentRoleDefault;
    agents?: Record<string, AgentConfig>;
    custom_providers?: Record<string, CustomProvider>;
    teams?: Record<string, TeamConfig>;
    monitoring?: {
        heartbeat_interval?: number;
    };
}

export interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
    source?: string;
    sourceMetadata?: Record<string, unknown>;
    message: string;
    timestamp: number;
    messageId: string;
    agent?: string; // optional: pre-routed agent id from channel client
    files?: string[];
    // Internal message fields (agent-to-agent)
    conversationId?: string; // links to parent conversation
    fromAgent?: string;      // which agent sent this internal message
}

export interface Conversation {
    id: string;
    channel: string;
    sender: string;
    originalMessage: string;
    messageId: string;
    pending: number;
    responses: ChainStep[];
    files: Set<string>;
    totalMessages: number;
    maxMessages: number;
    teamContext: { teamId: string; team: TeamConfig };
    startTime: number;
    // Track how many mentions each agent sent out (for inbox draining)
    outgoingMentions: Map<string, number>;
    // Track agents that have been enqueued but haven't finished responding
    pendingAgents: Set<string>;
    // Optional strict workflow state (e.g. PM -> Coder -> Reviewer -> Tester)
    workflowState?: {
        type: 'dev_pipeline';
        sequence: string[];
        currentIndex: number;
    };
    taskId?: string;
}

export interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string; // which agent handled this
    files?: string[];
    metadata?: Record<string, unknown>;
}

// Model name mapping
export const CLAUDE_MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-opus-4-6': 'claude-opus-4-6'
};

export const CODEX_MODEL_IDS: Record<string, string> = {
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.3-codex': 'gpt-5.3-codex',
};

// OpenCode model IDs in provider/model format (passed via --model / -m flag).
// Falls back to the raw model string from settings if no mapping is found.
export const OPENCODE_MODEL_IDS: Record<string, string> = {
    'opencode/claude-opus-4-6': 'opencode/claude-opus-4-6',
    'opencode/claude-sonnet-4-5': 'opencode/claude-sonnet-4-5',
    'opencode/gemini-3-flash': 'opencode/gemini-3-flash',
    'opencode/gemini-3-pro': 'opencode/gemini-3-pro',
    'opencode/glm-5': 'opencode/glm-5',
    'opencode/kimi-k2.5': 'opencode/kimi-k2.5',
    'opencode/kimi-k2.5-free': 'opencode/kimi-k2.5-free',
    'opencode/minimax-m2.5': 'opencode/minimax-m2.5',
    'opencode/minimax-m2.5-free': 'opencode/minimax-m2.5-free',
    'anthropic/claude-opus-4-6': 'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
    'openai/gpt-5.2': 'openai/gpt-5.2',
    'openai/gpt-5.3-codex': 'openai/gpt-5.3-codex',
    'openai/gpt-5.3-codex-spark': 'openai/gpt-5.3-codex-spark',
    // Shorthand aliases
    'sonnet': 'opencode/claude-sonnet-4-5',
    'opus': 'opencode/claude-opus-4-6',
};
