import { AgentConfig, Conversation, MessageData, Settings, TeamConfig } from '../lib/types';
import { emitEvent } from '../lib/logging';
import { enqueueInternalMessage, incrementPending } from '../lib/conversation';
import { extractHandoffTargets } from '../lib/routing';
import { setDevPipelineApprovalState, setWorkflowWaitingForUserInput } from '../lib/task-linkage';
import { ResolvedTeamWorkflow, resolveTeamWorkflow } from './workflow-config';

function normalizeApprovalText(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[.!?]/g, '')
        .trim();
}

export function isExplicitApprovalMessage(text: string): boolean {
    const normalized = normalizeApprovalText(text);
    if (!normalized) return false;
    const approvals = new Set([
        'approve',
        'approved',
        'go ahead',
        'continue',
        'proceed',
        'start',
        'yes continue',
        'yes, continue',
        'ok continue',
        'okay continue',
        'please continue',
    ]);
    return approvals.has(normalized);
}

export function isExplicitWorkflowStartMessage(text: string): boolean {
    const normalized = normalizeApprovalText(text);
    if (!normalized) return false;
    const starters = [
        'create task',
        'start task',
        'start working',
        'implement',
        'build feature',
        'analyze requirement',
    ];
    return starters.some(s => normalized.includes(s));
}

export function getResolvedTeamWorkflow(
    teamId: string,
    team: TeamConfig,
    agents: Record<string, AgentConfig>,
    settings: Settings,
    log?: (level: string, msg: string) => void,
): ResolvedTeamWorkflow | null {
    return resolveTeamWorkflow({
        teamId, team, agents, settings, log,
    });
}

/** Allowed handoff targets for current agent in workflow: next role(s) + user */
function getAllowedHandoffTargets(
    workflowState: NonNullable<Conversation['workflowState']>,
    agentId: string,
    agents: Record<string, AgentConfig>,
): { allowedAgentIds: Set<string>; canHandoffToUser: boolean } {
    const sequence = workflowState.sequence;
    const idx = sequence.indexOf(agentId);
    const allowedAgentIds = new Set<string>();
    if (idx >= 0 && idx < sequence.length - 1) {
        const nextAgentId = sequence[idx + 1];
        if (agents[nextAgentId]) allowedAgentIds.add(nextAgentId);
    }
    return { allowedAgentIds, canHandoffToUser: true };
}

export function handleConversationHandoffs(params: {
    conv: Conversation;
    agentId: string;
    response: string;
    invocationFailed: boolean;
    teams: Record<string, TeamConfig>;
    agents: Record<string, AgentConfig>;
    messageData: MessageData;
    log: (level: string, msg: string) => void;
}): void {
    const {
        conv, agentId, response, invocationFailed, teams, agents, messageData, log,
    } = params;
    const workflowState = conv.workflowState;

    if (workflowState?.type === 'dev_pipeline') {
        if (invocationFailed) {
            log('WARN', `Dev pipeline halted for conversation ${conv.id}: @${agentId} failed, skipping handoff`);
            return;
        }

        const currentStage = workflowState.currentIndex;
        const lastStage = workflowState.sequence.length - 1;
        const stageRoles = workflowState.stageRoles || [];
        const currentRole = stageRoles[currentStage] || agentId;
        const nextRole = stageRoles[currentStage + 1];
        const requiresApprovalIndices = new Set(workflowState.requiresApprovalIndices || []);
        const requiresApproval = requiresApprovalIndices.has(currentStage);

        if (requiresApproval && currentStage < lastStage) {
            if (conv.taskId) {
                setDevPipelineApprovalState(conv.taskId, {
                    awaitingApproval: true,
                    awaitingRole: currentRole,
                    nextRole,
                    workflowId: workflowState.workflowId,
                });
            }
            workflowState.waitingForApproval = true;
            workflowState.completedStages = [...(workflowState.completedStages || []), currentRole];
            log('INFO', `Dev pipeline waiting user approval after role '${currentRole}' for conversation ${conv.id}`);
            emitEvent('dev_pipeline_waiting_approval', {
                teamId: conv.teamContext.teamId,
                conversationId: conv.id,
                taskId: conv.taskId || null,
                role: currentRole,
                currentAgent: agentId,
            });
            return;
        }

        const targets = extractHandoffTargets(
            response, agentId, conv.teamContext.teamId, teams, agents,
        );
        const userTarget = targets.find(t => t.type === 'user');
        const agentTargets = targets.filter((t): t is { type: 'agent'; agentId: string; message: string } => t.type === 'agent');

        if (userTarget) {
            if (conv.taskId) setWorkflowWaitingForUserInput(conv.taskId, true);
            log('INFO', `Dev pipeline handoff @${agentId} → @user (waiting for user input)`);
            emitEvent('handoff_to_user', { teamId: conv.teamContext.teamId, fromAgent: agentId, conversationId: conv.id });
            return;
        }

        const { allowedAgentIds } = getAllowedHandoffTargets(workflowState, agentId, agents);
        const validAgentTargets = agentTargets.filter(t => allowedAgentIds.has(t.agentId));
        const invalidMentions = agentTargets.filter(t => !allowedAgentIds.has(t.agentId));
        if (invalidMentions.length > 0) {
            log('WARN', `Dev pipeline rejected invalid transition(s) @${agentId} → [${invalidMentions.map(m => m.agentId).join(', ')}]; allowed next: [${[...allowedAgentIds].join(', ')}]`);
        }

        if (validAgentTargets.length > 0 && currentStage < lastStage && conv.totalMessages < conv.maxMessages) {
            const t = validAgentTargets[0];
            const nextAgentId = t.agentId;
            const nextStage = workflowState.sequence.indexOf(nextAgentId);
            if (nextStage >= 0) {
                workflowState.currentIndex = nextStage;
                workflowState.waitingForApproval = false;
                workflowState.completedStages = [...(workflowState.completedStages || []), currentRole];

                incrementPending(conv, 1);
                conv.outgoingMentions.set(agentId, 1);
                conv.pendingAgents.add(nextAgentId);

                log('INFO', `Dev pipeline handoff @${agentId} → @${nextAgentId}`);
                emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: nextAgentId });
                emitEvent('agent_state', { agent: agentId, state: 'handoff' });
                emitEvent('agent_state', { agent: nextAgentId, state: 'thinking' });

                const internalMsg = `[Message from teammate @${agentId}]:\n${t.message}`;
                enqueueInternalMessage(conv.id, agentId, nextAgentId, internalMsg, {
                    channel: messageData.channel,
                    sender: messageData.sender,
                    senderId: messageData.senderId,
                    messageId: messageData.messageId,
                });
            }
        } else if (validAgentTargets.length === 0 && agentTargets.length === 0 && !userTarget) {
            log('INFO', `Dev pipeline no handoff from @${agentId} — workflow paused`);
        } else if (validAgentTargets.length > 0 && conv.totalMessages >= conv.maxMessages) {
            log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing handoff`);
        }
        return;
    }

    const targets = extractHandoffTargets(
        response, agentId, conv.teamContext.teamId, teams, agents,
    );
    const userTarget = targets.find(t => t.type === 'user');
    const agentTargets = targets.filter((t): t is { type: 'agent'; agentId: string; message: string } => t.type === 'agent');

    if (userTarget) {
        if (conv.taskId) setWorkflowWaitingForUserInput(conv.taskId, true);
        log('INFO', `Handoff @${agentId} → @user (waiting for user input)`);
        emitEvent('handoff_to_user', { teamId: conv.teamContext.teamId, fromAgent: agentId, conversationId: conv.id });
        return;
    }

    if (agentTargets.length > 0 && conv.totalMessages < conv.maxMessages) {
        incrementPending(conv, agentTargets.length);
        conv.outgoingMentions.set(agentId, agentTargets.length);
        for (const t of agentTargets) {
            conv.pendingAgents.add(t.agentId);
            log('INFO', `@${agentId} → @${t.agentId}`);
            emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: t.agentId });
            emitEvent('agent_state', { agent: agentId, state: 'handoff' });
            emitEvent('agent_state', { agent: t.agentId, state: 'thinking' });

            const internalMsg = `[Message from teammate @${agentId}]:\n${t.message}`;
            enqueueInternalMessage(conv.id, agentId, t.agentId, internalMsg, {
                channel: messageData.channel,
                sender: messageData.sender,
                senderId: messageData.senderId,
                messageId: messageData.messageId,
            });
        }
    } else if (agentTargets.length > 0) {
        log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing further mentions`);
    }
}

