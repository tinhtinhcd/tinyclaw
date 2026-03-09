#!/usr/bin/env node
import 'dotenv/config';
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 *
 * Supports multi-agent routing:
 *   - Messages prefixed with @agent_id are routed to that agent
 *   - Unrouted messages go to the "default" agent
 *   - Each agent has its own provider, model, working directory, and system prompt
 *   - Conversation isolation via per-agent working directories
 *
 * Team conversations use queue-based message passing:
 *   - Agent mentions ([@teammate: message]) become new messages in the queue
 *   - Each agent processes messages naturally via its own promise chain
 *   - Conversations complete when all branches resolve (no more pending mentions)
 */

import fs from 'fs';
import path from 'path';
import { MessageData, Conversation, TeamConfig, AgentConfig } from './lib/types';
import {
    LOG_FILE, CHATS_DIR, FILES_DIR,
    getSettings, getAgents, getTeams
} from './lib/config';
import { log, emitEvent } from './lib/logging';
import { emitTinyEvent, errorTinyEvent, warnTinyEvent } from './lib/observability';
import { parseAgentRouting, findTeamForAgent, getAgentResetFlag, extractTeammateMentions, extractChatRoomMessages } from './lib/routing';
import { invokeAgent } from './lib/invoke';
import { loadPlugins, runIncomingHooks, runOutgoingHooks } from './lib/plugins';
import { startApiServer } from './server';
import {
    initQueueDb, claimAllPendingMessages, completeMessage as dbCompleteMessage,
    failMessage, enqueueResponse, getPendingAgents, recoverStaleMessages,
    pruneAckedResponses, pruneCompletedMessages, closeQueueDb, queueEvents, DbMessage,
} from './lib/db';
import { handleLongResponse, collectFiles } from './lib/response';
import {
    conversations, MAX_CONVERSATION_MESSAGES, enqueueInternalMessage, completeConversation,
    withConversationLock, incrementPending, decrementPending,
    postToChatRoom,
} from './lib/conversation';
import {
    createTaskLinkage,
    getTaskLinkage,
    getTaskLinkageBySlackThread,
    attachGitBranch,
    attachPullRequest,
} from './lib/task-linkage';
import {
    applyRoleTaskLinkageState,
    applyTaskLinkageCommands,
    buildRoleFetchedPrContext,
    buildTaskLinkageContext,
    detectWorkflowRole,
    TaskLinkageExecutionDeps,
    WorkflowRole,
} from './lib/task-linkage-workflow';
import { getCodingWorker } from './integrations/coder/coder-worker';

// Ensure directories exist
[FILES_DIR, path.dirname(LOG_FILE), CHATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

function getDevPipelineSequence(team: TeamConfig, agents: Record<string, AgentConfig>): string[] | null {
    const wf = team.workflow;
    if (!wf || wf.type !== 'dev_pipeline') return null;

    const sequence = [wf.pm, wf.coder, wf.reviewer, wf.tester].map(id => id.toLowerCase());
    const unique = new Set(sequence);
    if (unique.size !== sequence.length) {
        log('WARN', `Team ${team.name} has duplicate workflow agents; disabling dev_pipeline for this conversation`);
        return null;
    }

    for (const stageAgent of sequence) {
        if (!team.agents.includes(stageAgent)) {
            log('WARN', `Team ${team.name} workflow agent '${stageAgent}' is not in team.agents; disabling dev_pipeline for this conversation`);
            return null;
        }
        if (!agents[stageAgent]) {
            log('WARN', `Team ${team.name} workflow agent '${stageAgent}' not found in agent config; disabling dev_pipeline for this conversation`);
            return null;
        }
    }

    return sequence;
}

function deriveMappedWorkflowRole(agentId: string, teamContext: { teamId: string; team: TeamConfig } | null): WorkflowRole | null {
    const wf = teamContext?.team.workflow;
    if (!wf || wf.type !== 'dev_pipeline') return null;
    const id = agentId.toLowerCase();
    if (wf.pm.toLowerCase() === id) return 'pm';
    if (wf.coder.toLowerCase() === id) return 'coder';
    if (wf.reviewer.toLowerCase() === id) return 'reviewer';
    if (wf.tester.toLowerCase() === id) return 'tester';
    return null;
}

// Process one or more batched messages for an agent
interface ProcessMessageOverrides {
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

async function processMessage(
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

        // Build a MessageData-like object for compatibility
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

        // Get settings, agents, and teams
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

        // Route message to agent (or team)
        let agentId: string;
        let message: string;
        let isTeamRouted = false;

        if (messageData.agent && agents[messageData.agent]) {
            // Pre-routed (by channel client or internal message)
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            // Parse @agent or @team prefix
            const routing = parseAgentRouting(rawMessage, agents, teams);
            agentId = routing.agentId;
            message = routing.message;
            isTeamRouted = !!routing.isTeam;
        }

        // Fall back to default if agent not found
        if (!agents[agentId]) {
            agentId = 'default';
            message = rawMessage;
        }

        // Final fallback: use first available agent if no default
        if (!agents[agentId]) {
            agentId = Object.keys(agents)[0];
        }

        const agent = agents[agentId];
        log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
        if (!isInternal) {
            emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });
        }

        // Determine team context
        let teamContext: { teamId: string; team: TeamConfig } | null = null;
        if (isInternal) {
            // Internal messages inherit team context from their conversation
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
            if (!teamContext) {
                teamContext = findTeamForAgent(agentId, teams);
            }
        }

        // Check for per-agent reset
        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(agentResetFlag);

        if (shouldReset) {
            fs.unlinkSync(agentResetFlag);
        }

        let linkedTaskId: string | undefined;
        // For internal messages, reuse linkage from the parent conversation.
        if (isInternal && messageData.conversationId) {
            const conv = conversations.get(messageData.conversationId);
            if (conv?.taskId) linkedTaskId = conv.taskId;
        }

        // For Slack threads, map one thread -> one backend task linkage.
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

        // Prepend additional batched messages (chat room messages, etc.)
        if (additionalMsgs.length > 0) {
            const batchedTexts = additionalMsgs.map(m => m.message);
            message = `${batchedTexts.join('\n\n------\n\n')}\n\n------\n\n${message}`;
            log('INFO', `Batched ${additionalMsgs.length} additional message(s) for agent ${agentId}`);
        }

        // Run incoming hooks on raw/batched message before internal context injection.
        const incomingHooksFn = overrides.runIncomingHooksFn || runIncomingHooks;
        ({ text: message } = await incomingHooksFn(message, { channel, sender, messageId, originalMessage: rawMessage }));

        const mappedRole = deriveMappedWorkflowRole(agentId, teamContext) || undefined;
        const roleAwareAgent = mappedRole ? { ...agent, workflowRole: mappedRole } : agent;
        const role = detectWorkflowRole(agentId, roleAwareAgent);
        if (linkedTaskId) {
            applyRoleTaskLinkageState(linkedTaskId, agentId, role, log);
            const linkageContext = buildTaskLinkageContext(linkedTaskId, role, log);
            if (linkageContext) {
                message = `${message}\n\n------\n\n${linkageContext}`;
            }
            const fetchReviewerContext = overrides.fetchReviewerPrContextFn || buildRoleFetchedPrContext;
            try {
                const fetchedReviewerContext = await fetchReviewerContext(linkedTaskId, role, log);
                if (fetchedReviewerContext) {
                    message = `${message}\n\n------\n\n${fetchedReviewerContext}`;
                }
            } catch (error) {
                log('WARN', `[ROLE_PR_FETCH] Context fetch failed for task ${linkedTaskId}: ${(error as Error).message}`);
                warnTinyEvent({
                    type: role === 'reviewer' ? 'reviewer_pr_fetch_fallback_linkage' : role === 'tester' ? 'tester_pr_fetch_fallback_linkage' : 'role_pr_fetch_fallback_linkage',
                    taskId: linkedTaskId,
                    agentId,
                    role,
                    source: 'github',
                    message: (error as Error).message,
                    metadata: { fallbackUsed: true },
                });
            }
        }

        // For internal messages: append pending response indicator so the agent
        // knows other teammates are still processing and won't re-mention them.
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

        // Invoke agent
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
        const invokeAgentFn = overrides.invokeAgentFn || invokeAgent;
        try {
            const worker = role === 'coder' ? getCodingWorker() : null;
            if (worker && linkedTaskId) {
                emitTinyEvent({
                    type: 'worker_mode_selected',
                    taskId: linkedTaskId,
                    agentId,
                    role,
                    metadata: { workerMode: worker.name },
                });
                const linkage = getTaskLinkage(linkedTaskId);
                const md = messageData.sourceMetadata || {};
                const slackChannelId = typeof md.channelId === 'string' ? md.channelId : undefined;
                const slackThreadTs = typeof md.threadTs === 'string' ? md.threadTs : undefined;
                log('INFO', `[CODER_WORKER] Delegating coder task ${linkedTaskId} to worker '${worker.name}'`);
                const workerResult = await worker.runTask({
                    taskId: linkedTaskId,
                    repo: linkage?.repo,
                    baseBranch: linkage?.baseBranch,
                    workingBranch: linkage?.workingBranch,
                    linearIssueIdentifier: linkage?.linearIssueIdentifier,
                    prompt: message,
                    slackChannelId,
                    slackThreadTs,
                });

                if (workerResult.branch && linkage?.repo && linkage?.baseBranch) {
                    attachGitBranch(linkedTaskId, {
                        gitProvider: linkage.gitProvider || 'github',
                        repo: linkage.repo,
                        baseBranch: linkage.baseBranch,
                        workingBranch: workerResult.branch,
                    });
                    emitTinyEvent({
                        type: 'worker_branch_attached',
                        taskId: linkedTaskId,
                        agentId,
                        role,
                        metadata: {
                            workerMode: worker.name,
                            repo: linkage.repo,
                            baseBranch: linkage.baseBranch,
                            workingBranch: workerResult.branch,
                        },
                    });
                }

                if (
                    typeof workerResult.pullRequestNumber === 'number'
                    && workerResult.pullRequestUrl
                ) {
                    attachPullRequest(linkedTaskId, {
                        pullRequestNumber: workerResult.pullRequestNumber,
                        pullRequestUrl: workerResult.pullRequestUrl,
                    });
                    emitTinyEvent({
                        type: 'worker_pull_request_attached',
                        taskId: linkedTaskId,
                        agentId,
                        role,
                        metadata: {
                            workerMode: worker.name,
                            pullRequestNumber: workerResult.pullRequestNumber,
                            pullRequestUrl: workerResult.pullRequestUrl,
                        },
                    });
                }

                response = workerResult.summary;
                log('INFO', `[CODER_WORKER] Delegation complete for task ${linkedTaskId}`);
            } else {
                response = await invokeAgentFn(agent, agentId, message, workspacePath, shouldReset, agents, teams);
            }
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
            response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
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

        // Extract and post [#team_id: message] chat room broadcasts
        const chatRoomMsgs = extractChatRoomMessages(response, agentId, teams);
        for (const crMsg of chatRoomMsgs) {
            postToChatRoom(crMsg.teamId, agentId, crMsg.message, teams[crMsg.teamId].agents, {
                channel, sender, senderId: dbMsg.sender_id, messageId,
            });
        }

        // --- No team context: simple response to user ---
        if (!teamContext) {
            let finalResponse = response.trim();

            // Detect files
            const outboundFilesSet = new Set<string>();
            collectFiles(finalResponse, outboundFilesSet);
            const outboundFiles = Array.from(outboundFilesSet);
            if (outboundFiles.length > 0) {
                finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
            }

            // Run outgoing hooks
            const outgoingHooksFn = overrides.runOutgoingHooksFn || runOutgoingHooks;
            const { text: hookedResponse, metadata } = await outgoingHooksFn(finalResponse, { channel, sender, messageId, originalMessage: rawMessage });

            // Handle long responses — send as file attachment
            const { message: responseMessage, files: allFiles } = handleLongResponse(hookedResponse, outboundFiles);

            enqueueResponse({
                channel,
                sender,
                senderId: dbMsg.sender_id ?? undefined,
                message: responseMessage,
                originalMessage: rawMessage,
                messageId,
                agent: agentId,
                files: allFiles.length > 0 ? allFiles : undefined,
                metadata: {
                    ...metadata,
                    agentId,
                    ...(linkedTaskId ? { taskId: linkedTaskId } : {}),
                },
            });

            log('INFO', `✓ Response ready [${channel}] ${sender} via agent:${agentId} (${finalResponse.length} chars)`);
            emitEvent('response_ready', { channel, sender, agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId });

            dbCompleteMessage(dbMsg.id);
            return;
        }

        // --- Team context: conversation-based message passing ---

        // Get or create conversation
        let conv: Conversation;
        if (isInternal && messageData.conversationId && conversations.has(messageData.conversationId)) {
            conv = conversations.get(messageData.conversationId)!;
        } else {
            // New conversation
            const convId = `${messageId}_${Date.now()}`;
            const candidateSequence = getDevPipelineSequence(teamContext.team, agents);
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
                pending: 1, // this initial message
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

        // Record this agent's response
        conv.responses.push({ agentId, response });
        conv.totalMessages++;
        conv.pendingAgents.delete(agentId);
        collectFiles(response, conv.files);

        const workflowState = conv.workflowState;
        if (workflowState?.type === 'dev_pipeline') {
            if (invocationFailed) {
                log('WARN', `Dev pipeline halted for conversation ${conv.id}: @${agentId} failed, skipping next stage handoff`);
            }
            const maybeMentions = extractTeammateMentions(
                response, agentId, conv.teamContext.teamId, teams, agents
            );
            if (maybeMentions.length > 0) {
                log('INFO', `Conversation ${conv.id} is in dev_pipeline mode; ignoring ${maybeMentions.length} explicit teammate mention(s)`);
            }

            const currentStage = workflowState.currentIndex;
            const lastStage = workflowState.sequence.length - 1;
            if (!invocationFailed && currentStage < lastStage && conv.totalMessages < conv.maxMessages) {
                const nextStage = currentStage + 1;
                const nextAgentId = workflowState.sequence[nextStage];
                workflowState.currentIndex = nextStage;

                incrementPending(conv, 1);
                conv.outgoingMentions.set(agentId, 1);
                conv.pendingAgents.add(nextAgentId);

                log('INFO', `Dev pipeline handoff @${agentId} → @${nextAgentId}`);
                emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: nextAgentId });

                const internalMsg = [
                    `[Workflow handoff: dev_pipeline ${nextStage + 1}/${workflowState.sequence.length}]`,
                    '',
                    `Original user request:`,
                    conv.originalMessage,
                    '',
                    `Previous output from @${agentId}:`,
                    response.trim(),
                ].join('\n');

                enqueueInternalMessage(conv.id, agentId, nextAgentId, internalMsg, {
                    channel: messageData.channel,
                    sender: messageData.sender,
                    senderId: messageData.senderId,
                    messageId: messageData.messageId,
                });
            } else if (currentStage < lastStage) {
                log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — stopping dev_pipeline handoff`);
            }
        } else {
            // Check for teammate mentions
            const teammateMentions = extractTeammateMentions(
                response, agentId, conv.teamContext.teamId, teams, agents
            );

            if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
                // Enqueue internal messages for each mention
                incrementPending(conv, teammateMentions.length);
                conv.outgoingMentions.set(agentId, teammateMentions.length);
                for (const mention of teammateMentions) {
                    conv.pendingAgents.add(mention.teammateId);
                    log('INFO', `@${agentId} → @${mention.teammateId}`);
                    emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

                    const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
                    enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, {
                        channel: messageData.channel,
                        sender: messageData.sender,
                        senderId: messageData.senderId,
                        messageId: messageData.messageId,
                    });
                }
            } else if (teammateMentions.length > 0) {
                log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing further mentions`);
            }
        }

        // This branch is done - use atomic decrement with locking
        await withConversationLock(conv.id, async () => {
            const shouldComplete = decrementPending(conv);

            if (shouldComplete) {
                completeConversation(conv);
            } else {
                log('INFO', `Conversation ${conv.id}: ${conv.pending} branch(es) still pending`);
            }
        });

        // Mark all messages as completed in DB (primary + batched)
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

// Per-agent processing chains - ensures messages to same agent are sequential
const agentProcessingChains = new Map<string, Promise<void>>();

// Main processing loop
async function processQueue(): Promise<void> {
    try {
        // Get all agents with pending messages
        const pendingAgents = getPendingAgents();

        if (pendingAgents.length === 0) return;

        for (const agentId of pendingAgents) {
            // Claim ALL pending messages for this agent (batching)
            const allMsgs = claimAllPendingMessages(agentId);
            if (allMsgs.length === 0) continue;

            // First message is the primary; rest are batched as context
            const [primaryMsg, ...additionalMsgs] = allMsgs;

            // Get or create promise chain for this agent
            const currentChain = agentProcessingChains.get(agentId) || Promise.resolve();

            // Chain this batch to the agent's promise
            const newChain = currentChain
                .then(() => processMessage(primaryMsg, additionalMsgs))
                .catch(error => {
                    log('ERROR', `Error processing message for agent ${agentId}: ${error.message}`);
                });

            // Update the chain
            agentProcessingChains.set(agentId, newChain);

            // Clean up completed chains to avoid memory leaks
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

// Log agent and team configuration on startup
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

// ─── Start ──────────────────────────────────────────────────────────────────

export function startQueueProcessor(): void {
    // Initialize SQLite queue
    initQueueDb();

    // Recover stale messages from previous crash
    const recovered = recoverStaleMessages();
    if (recovered > 0) {
        log('INFO', `Recovered ${recovered} stale message(s) from previous session`);
    }

    // Start the API server (passes conversations for queue status reporting)
    const apiServer = startApiServer(conversations);

    // Load plugins (async IIFE to avoid top-level await)
    (async () => {
        await loadPlugins();
    })();

    log('INFO', 'Queue processor started (SQLite-backed)');
    logAgentConfig();
    emitEvent('processor_start', { agents: Object.keys(getAgents(getSettings())), teams: Object.keys(getTeams(getSettings())) });

    // Event-driven: all messages come through the API server (same process)
    queueEvents.on('message:enqueued', () => processQueue());

    // Periodic maintenance
    setInterval(() => {
        const count = recoverStaleMessages();
        if (count > 0) log('INFO', `Recovered ${count} stale message(s)`);
    }, 5 * 60 * 1000); // every 5 min

    setInterval(() => {
        // Clean up old conversations (TTL: 30 min)
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [id, conv] of conversations.entries()) {
            if (conv.startTime < cutoff) {
                log('WARN', `Conversation ${id} timed out after 30 min — cleaning up`);
                conversations.delete(id);
            }
        }
    }, 30 * 60 * 1000); // every 30 min

    setInterval(() => {
        const pruned = pruneAckedResponses();
        if (pruned > 0) log('INFO', `Pruned ${pruned} acked response(s)`);
    }, 60 * 60 * 1000); // every 1 hr

    setInterval(() => {
        const pruned = pruneCompletedMessages();
        if (pruned > 0) log('INFO', `Pruned ${pruned} completed message(s)`);
    }, 60 * 60 * 1000); // every 1 hr

    // Graceful shutdown
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

if (require.main === module) {
    startQueueProcessor();
}
