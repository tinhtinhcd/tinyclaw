import fs from 'fs';
import path from 'path';
import { Conversation } from '../lib/types';
import { CHATS_DIR, FILES_DIR, getAgents, getSettings, getTeams, LOG_FILE } from '../lib/config';
import { log, emitEvent } from '../lib/logging';
import { loadPlugins } from '../lib/plugins';
import { startApiServer } from '../server';
import {
    claimAllPendingMessages,
    closeQueueDb,
    getPendingAgents,
    initQueueDb,
    pruneAckedResponses,
    pruneCompletedMessages,
    queueEvents,
    recoverStaleMessages,
} from '../lib/db';
import { conversations } from '../lib/conversation';
import { processMessage } from './process-message';

[FILES_DIR, path.dirname(LOG_FILE), CHATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const agentProcessingChains = new Map<string, Promise<void>>();

async function processQueue(): Promise<void> {
    try {
        const pendingAgents = getPendingAgents();
        if (pendingAgents.length === 0) return;

        for (const agentId of pendingAgents) {
            const allMsgs = claimAllPendingMessages(agentId);
            if (allMsgs.length === 0) continue;

            const [primaryMsg, ...additionalMsgs] = allMsgs;
            const currentChain = agentProcessingChains.get(agentId) || Promise.resolve();
            const newChain = currentChain
                .then(() => processMessage(primaryMsg, additionalMsgs))
                .catch(error => {
                    log('ERROR', `Error processing message for agent ${agentId}: ${error.message}`);
                });

            agentProcessingChains.set(agentId, newChain);
            newChain.finally(() => {
                if (agentProcessingChains.get(agentId) === newChain) {
                    agentProcessingChains.delete(agentId);
                }
            });
        }
    } catch (error) {
        log('ERROR', `Queue processing error: ${(error as Error).message}`);
    }
}

function logAgentConfig(): void {
    const settings = getSettings();
    const agents = getAgents(settings);
    const teams = getTeams(settings);

    const agentCount = Object.keys(agents).length;
    log('INFO', `Loaded ${agentCount} agent(s):`);
    for (const [id, agent] of Object.entries(agents)) {
        log('INFO', `  ${id}: ${agent.name} [${agent.provider}/${agent.model}] cwd=${agent.working_directory}`);
    }

    const teamCount = Object.keys(teams).length;
    if (teamCount > 0) {
        log('INFO', `Loaded ${teamCount} team(s):`);
        for (const [id, team] of Object.entries(teams)) {
            log('INFO', `  ${id}: ${team.name} [agents: ${team.agents.join(', ')}] leader=${team.leader_agent}`);
        }
    }
}

export function startQueueProcessor(conversationMap: Map<string, Conversation> = conversations): void {
    initQueueDb();

    const recovered = recoverStaleMessages();
    if (recovered > 0) {
        log('INFO', `Recovered ${recovered} stale message(s) from previous session`);
    }

    const apiServer = startApiServer(conversationMap);
    (async () => {
        await loadPlugins();
    })();

    log('INFO', 'Queue processor started (SQLite-backed)');
    logAgentConfig();
    emitEvent('processor_start', { agents: Object.keys(getAgents(getSettings())), teams: Object.keys(getTeams(getSettings())) });

    queueEvents.on('message:enqueued', () => processQueue());

    setInterval(() => {
        const count = recoverStaleMessages();
        if (count > 0) log('INFO', `Recovered ${count} stale message(s)`);
    }, 5 * 60 * 1000);

    setInterval(() => {
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [id, conv] of conversations.entries()) {
            if (conv.startTime < cutoff) {
                log('WARN', `Conversation ${id} timed out after 30 min — cleaning up`);
                conversations.delete(id);
            }
        }
    }, 30 * 60 * 1000);

    setInterval(() => {
        const pruned = pruneAckedResponses();
        if (pruned > 0) log('INFO', `Pruned ${pruned} acked response(s)`);
    }, 60 * 60 * 1000);

    setInterval(() => {
        const pruned = pruneCompletedMessages();
        if (pruned > 0) log('INFO', `Pruned ${pruned} completed message(s)`);
    }, 60 * 60 * 1000);

    process.on('SIGINT', () => {
        log('INFO', 'Shutting down queue processor...');
        closeQueueDb();
        apiServer.close();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        log('INFO', 'Shutting down queue processor...');
        closeQueueDb();
        apiServer.close();
        process.exit(0);
    });
}

