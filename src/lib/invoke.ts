import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { getSettings, resolveAgentRuntimeConfig } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';
import { createProvider } from './providers';

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the raw response text.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {}
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const settings = getSettings();
    const runtime = resolveAgentRuntimeConfig(agentId, agent, settings);
    const { provider, modelOverride } = createProvider(runtime.provider, { settings, agentId });
    const model = runtime.model || modelOverride || '';

    log('INFO', `Using provider '${provider.name}' (agent: ${agentId}, model: ${model || 'default'})`);
    if (shouldReset) {
        log('INFO', `Resetting conversation for agent: ${agentId}`);
    }

    const result = await provider.invoke({
        prompt: message,
        systemPrompt: agent.system_prompt,
        workingDirectory: workingDir,
        model,
        resetConversation: shouldReset,
        metadata: { agentId },
        providerOptions: runtime.providerOptions,
    });

    return result.text;
}
