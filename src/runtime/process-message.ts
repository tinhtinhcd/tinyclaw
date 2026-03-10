import fs from 'fs';
import path from 'path';
import { AgentConfig, Conversation, MessageData, TeamConfig } from '../lib/types';
import { getAgents, getSettings, getTeams } from '../lib/config';
import { emitEvent, log } from '../lib/logging';
import {
    parseAgentRouting,
    findTeamForAgent,
    getAgentResetFlag,
    extractChatRoomMessages,
} from '../lib/routing';
import { invokeAgent } from '../lib/invoke';
import { runIncomingHooks, runOutgoingHooks } from '../lib/plugins';
import {
    completeMessage as dbCompleteMessage,
    failMessage,
    DbMessage,
} from '../lib/db';
import { collectFiles } from '../lib/response';
import {
    conversations,
    completeConversation,
    decrementPending,
    MAX_CONVERSATION_MESSAGES,
    postToChatRoom,
    withConversationLock,
} from '../lib/conversation';
import {
    createTaskLinkage,
    getTaskLinkageBySlackThread,
} from '../lib/task-linkage';
import {
    applyTaskLinkageCommands,
    TaskLinkageExecutionDeps,
    WorkflowRole,
} from '../lib/task-linkage-workflow';
import { errorTinyEvent, emitTinyEvent } from '../lib/observability';
import { enrichPromptContext } from './prompt-context';
import { runWorkerOrInvokeAgent } from './worker-delegation';
import { enqueueDirectResponse } from './response-runtime';
import { getDevPipelineSequence, handleConversationHandoffs } from './handoff-runtime';

export interface ProcessMessageOverrides {
    invokeAgentFn?: typeof invokeAgent;
    runIncomingHooksFn?: typeof runIncomingHooks;
    runOutgoingHooksFn?: typeof runOutgoingHooks;
    taskLinkageExecutionDeps?: TaskLinkageExecutionDeps;
    fetchReviewerPrContextFn?: (
        taskId: string,
        role: WorkflowRole,
        log: (level: string, msg: string) => void,
    ) => Promise<string>;
}

export async function processMessage(
    dbMsg: DbMessage,
    additionalMsgs: DbMessage[] = [],
    overrides: ProcessMessageOverrides = {},
): Promise<void> {
    try {
        const channel = dbMsg.channel;
        const sender = dbMsg.sender;
        const rawMessage = dbMsg.message;
        const messageId = dbMsg.message_id;
        const isInternal = !!dbMsg.conversation_id;
        const files: string[] = dbMsg.files ? JSON.parse(dbMsg.files) : [];

        const messageData: MessageData = {
            channel,
            sender,
            senderId: dbMsg.sender_id ?? undefined,
            source: dbMsg.source ?? undefined,
            sourceMetadata: dbMsg.source_metadata ? JSON.parse(dbMsg.source_metadata) : undefined,
            message: rawMessage,
            timestamp: dbMsg.created_at,
            messageId,
            agent: dbMsg.agent ?? undefined,
            files: files.length > 0 ? files : undefined,
            conversationId: dbMsg.conversation_id ?? undefined,
            fromAgent: dbMsg.from_agent ?? undefined,
        };

        log('INFO', `Processing [${isInternal ? 'internal' : channel}] ${isInternal ? `@${dbMsg.from_agent}→@${dbMsg.agent}` : `from ${sender}`}: ${rawMessage.substring(0, 50)}...`);
        if (!isInternal) {
            emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });
        }

        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);
        const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

        let agentId: string;
        let message: string;
        let isTeamRouted = false;
        if (messageData.agent && agents[messageData.agent]) {
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            const routing = parseAgentRouting(rawMessage, agents, teams);
            agentId = routing.agentId;
            message = routing.message;
            isTeamRouted = !!routing.isTeam;
        }
        if (!agents[agentId]) {
            agentId = 'default';
            message = rawMessage;
        }
        if (!agents[agentId]) {
            agentId = Object.keys(agents)[0];
        }
        const agent = agents[agentId];
        log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
        if (!isInternal) {
            emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });
        }

        let teamContext: { teamId: string; team: TeamConfig } | null = null;
        if (isInternal) {
            const conv = conversations.get(messageData.conversationId!);
            if (conv) teamContext = conv.teamContext;
        } else {
            if (isTeamRouted) {
                for (const [tid, t] of Object.entries(teams)) {
                    if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                        teamContext = { teamId: tid, team: t };
                        break;
                    }
                }
            }
            if (!teamContext) teamContext = findTeamForAgent(agentId, teams);
        }

        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(agentResetFlag);
        if (shouldReset) fs.unlinkSync(agentResetFlag);

        let linkedTaskId: string | undefined;
        if (isInternal && messageData.conversationId) {
            const conv = conversations.get(messageData.conversationId);
            if (conv?.taskId) linkedTaskId = conv.taskId;
        }
        if (!isInternal && messageData.channel === 'slack') {
            try {
                const md = messageData.sourceMetadata || {};
                const slackChannelId = typeof md.channelId === 'string' ? md.channelId : '';
                const slackThreadTs = typeof md.threadTs === 'string' ? md.threadTs : '';
                if (slackChannelId && slackThreadTs) {
                    const existingLinkage = getTaskLinkageBySlackThread(slackChannelId, slackThreadTs);
                    if (existingLinkage) {
                        linkedTaskId = existingLinkage.taskId;
                        emitTinyEvent({
                            type: 'linkage_resolved_slack_thread',
                            taskId: linkedTaskId,
                            agentId,
                            role: 'unknown',
                            source: 'slack',
                            metadata: { slackChannelId, slackThreadTs },
                        });
                    } else {
                        const createdTask = createTaskLinkage({
                            title: message.slice(0, 120),
                            description: rawMessage,
                            slackChannelId,
                            slackThreadTs,
                            currentOwnerAgentId: agentId,
                            status: 'in_progress',
                        });
                        linkedTaskId = createdTask.id;
                    }
                }
            } catch (error) {
                log('WARN', `Task linkage update failed for Slack message ${messageId}: ${(error as Error).message}`);
            }
        }

        if (additionalMsgs.length > 0) {
            const batchedTexts = additionalMsgs.map(m => m.message);
            message = `${batchedTexts.join('\n\n------\n\n')}\n\n------\n\n${message}`;
            log('INFO', `Batched ${additionalMsgs.length} additional message(s) for agent ${agentId}`);
        }

        const incomingHooksFn = overrides.runIncomingHooksFn || runIncomingHooks;
        ({ text: message } = await incomingHooksFn(message, { channel, sender, messageId, originalMessage: rawMessage }));

        const roleResult = await enrichPromptContext({
            message,
            linkedTaskId,
            agentId,
            agent,
            teamContext,
            log,
            fetchReviewerPrContextFn: overrides.fetchReviewerPrContextFn,
        });
        const role = roleResult.role;
        message = roleResult.message;

        if (isInternal && messageData.conversationId) {
            const conv = conversations.get(messageData.conversationId);
            if (conv) {
                const respondedAgents = new Set(conv.responses.map(r => r.agentId));
                const othersPending = [...conv.pendingAgents].filter(a => a !== agentId && !respondedAgents.has(a)).length;
                if (othersPending > 0) {
                    message += `\n\n------\n\n[${othersPending} other teammate response(s) are still being processed and will be delivered when ready. Do not re-mention teammates who haven't responded yet.]`;
                }
            }
        }

        const rootMessageId = (isInternal && messageData.conversationId)
            ? (conversations.get(messageData.conversationId)?.messageId || messageId)
            : messageId;
        emitEvent('chain_step_start', {
            agentId,
            agentName: agent.name,
            fromAgent: messageData.fromAgent || null,
            messageId: rootMessageId,
            channel,
        });

        let response: string;
        let invocationFailed = false;
        try {
            response = await runWorkerOrInvokeAgent({
                role,
                linkedTaskId,
                messageData,
                message,
                agent,
                agentId,
                workspacePath,
                shouldReset,
                agents,
                teams,
                invokeAgentFn: overrides.invokeAgentFn,
                log,
            });
        } catch (error) {
            invocationFailed = true;
            const providerLabel = agent.provider || 'unknown-provider';
            log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
            if (role === 'coder' && linkedTaskId) {
                errorTinyEvent({
                    type: 'worker_failed',
                    taskId: linkedTaskId,
                    agentId,
                    role,
                    message: (error as Error).message,
                    metadata: { provider: providerLabel },
                });
            }
            response = 'Sorry, I encountered an error processing your request. Please check the queue logs.';
        }

        if (linkedTaskId && response) {
            response = await applyTaskLinkageCommands(
                linkedTaskId,
                role,
                agentId,
                response,
                log,
                overrides.taskLinkageExecutionDeps,
            );
        }

        emitEvent('chain_step_done', {
            agentId,
            agentName: agent.name,
            responseLength: response.length,
            responseText: response,
            messageId: rootMessageId,
            channel,
        });

        const chatRoomMsgs = extractChatRoomMessages(response, agentId, teams);
        for (const crMsg of chatRoomMsgs) {
            postToChatRoom(crMsg.teamId, agentId, crMsg.message, teams[crMsg.teamId].agents, {
                channel, sender, senderId: dbMsg.sender_id, messageId,
            });
        }

        if (!teamContext) {
            await enqueueDirectResponse({
                response,
                channel,
                sender,
                senderId: dbMsg.sender_id ?? undefined,
                rawMessage,
                messageId,
                agentId,
                linkedTaskId,
                runOutgoingHooksFn: overrides.runOutgoingHooksFn,
                log,
            });
            dbCompleteMessage(dbMsg.id);
            return;
        }

        let conv: Conversation;
        if (isInternal && messageData.conversationId && conversations.has(messageData.conversationId)) {
            conv = conversations.get(messageData.conversationId)!;
        } else {
            const convId = `${messageId}_${Date.now()}`;
            const candidateSequence = getDevPipelineSequence(teamContext.team, agents, log);
            const sequenceStartIndex = candidateSequence ? candidateSequence.indexOf(agentId) : -1;
            if (candidateSequence && sequenceStartIndex < 0) {
                log('WARN', `Team ${teamContext.team.name} has dev_pipeline configured but initial agent '${agentId}' is not in workflow stages; using mention-based flow`);
            }
            const devPipelineSequence = sequenceStartIndex >= 0 ? candidateSequence : null;
            const startIndex = sequenceStartIndex >= 0 ? sequenceStartIndex : 0;
            conv = {
                id: convId,
                channel,
                sender,
                originalMessage: rawMessage,
                messageId,
                pending: 1,
                responses: [],
                files: new Set(),
                totalMessages: 0,
                maxMessages: MAX_CONVERSATION_MESSAGES,
                teamContext,
                startTime: Date.now(),
                outgoingMentions: new Map(),
                pendingAgents: new Set([agentId]),
                workflowState: devPipelineSequence ? {
                    type: 'dev_pipeline',
                    sequence: devPipelineSequence,
                    currentIndex: startIndex,
                } : undefined,
                taskId: linkedTaskId,
            };
            conversations.set(convId, conv);
            log('INFO', `Conversation started: ${convId} (team: ${teamContext.team.name})`);
            emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });
        }

        conv.responses.push({ agentId, response });
        conv.totalMessages++;
        conv.pendingAgents.delete(agentId);
        collectFiles(response, conv.files);

        handleConversationHandoffs({
            conv,
            agentId,
            response,
            invocationFailed,
            teams,
            agents,
            messageData,
            log,
        });

        await withConversationLock(conv.id, async () => {
            const shouldComplete = decrementPending(conv);
            if (shouldComplete) {
                completeConversation(conv);
            } else {
                log('INFO', `Conversation ${conv.id}: ${conv.pending} branch(es) still pending`);
            }
        });

        dbCompleteMessage(dbMsg.id);
        for (const extra of additionalMsgs) {
            dbCompleteMessage(extra.id);
        }
    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);
        failMessage(dbMsg.id, (error as Error).message);
    }
}

export async function processMessageForTest(
    dbMsg: DbMessage,
    additionalMsgs: DbMessage[] = [],
    overrides: ProcessMessageOverrides = {},
): Promise<void> {
    await processMessage(dbMsg, additionalMsgs, overrides);
}

