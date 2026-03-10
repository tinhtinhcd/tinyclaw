import { AgentConfig, Conversation, MessageData, Settings, TeamConfig } from '../lib/types';
import { emitEvent } from '../lib/logging';
import { enqueueInternalMessage, incrementPending } from '../lib/conversation';
import { extractTeammateMentions } from '../lib/routing';
import { setDevPipelineApprovalState } from '../lib/task-linkage';
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
            log('WARN', `Dev pipeline halted for conversation ${conv.id}: @${agentId} failed, skipping next stage handoff`);
        }
        const maybeMentions = extractTeammateMentions(
            response, agentId, conv.teamContext.teamId, teams, agents,
        );
        if (maybeMentions.length > 0) {
            log('INFO', `Conversation ${conv.id} is in dev_pipeline mode; ignoring ${maybeMentions.length} explicit teammate mention(s)`);
        }

        const currentStage = workflowState.currentIndex;
        const lastStage = workflowState.sequence.length - 1;
        const stageRoles = workflowState.stageRoles || [];
        const currentRole = stageRoles[currentStage] || agentId;
        const nextRole = stageRoles[currentStage + 1];
        const requiresApprovalIndices = new Set(workflowState.requiresApprovalIndices || []);
        const requiresApproval = requiresApprovalIndices.has(currentStage);
        if (!invocationFailed && requiresApproval && currentStage < lastStage) {
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
        if (!invocationFailed && currentStage < lastStage && conv.totalMessages < conv.maxMessages) {
            const nextStage = currentStage + 1;
            const nextAgentId = workflowState.sequence[nextStage];
            workflowState.currentIndex = nextStage;
            workflowState.waitingForApproval = false;
            workflowState.completedStages = [...(workflowState.completedStages || []), currentRole];

            incrementPending(conv, 1);
            conv.outgoingMentions.set(agentId, 1);
            conv.pendingAgents.add(nextAgentId);

            log('INFO', `Dev pipeline handoff @${agentId} → @${nextAgentId}`);
            emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: nextAgentId });

            const internalMsg = [
                `[Workflow handoff: dev_pipeline ${nextStage + 1}/${workflowState.sequence.length}]`,
                '',
                'Original user request:',
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
        } else if (!invocationFailed && currentStage < lastStage) {
            log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — stopping dev_pipeline handoff`);
        }
        return;
    }

    const teammateMentions = extractTeammateMentions(
        response, agentId, conv.teamContext.teamId, teams, agents,
    );

    if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
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

