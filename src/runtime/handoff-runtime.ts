import { AgentConfig, Conversation, MessageData, TeamConfig } from '../lib/types';
import { emitEvent } from '../lib/logging';
import { enqueueInternalMessage, incrementPending } from '../lib/conversation';
import { extractTeammateMentions } from '../lib/routing';
import { setDevPipelineAwaitingPmApproval } from '../lib/task-linkage';

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

export function getDevPipelineSequence(
    team: TeamConfig,
    agents: Record<string, AgentConfig>,
    log?: (level: string, msg: string) => void,
): string[] | null {
    const wf = team.workflow;
    if (!wf || wf.type !== 'dev_pipeline') return null;

    const sequence = [wf.pm, wf.coder, wf.reviewer, wf.tester].map(id => id.toLowerCase());
    const unique = new Set(sequence);
    if (unique.size !== sequence.length) {
        log?.('WARN', `Team ${team.name} has duplicate workflow agents; disabling dev_pipeline for this conversation`);
        return null;
    }

    for (const stageAgent of sequence) {
        if (!team.agents.includes(stageAgent)) {
            log?.('WARN', `Team ${team.name} workflow agent '${stageAgent}' is not in team.agents; disabling dev_pipeline for this conversation`);
            return null;
        }
        if (!agents[stageAgent]) {
            log?.('WARN', `Team ${team.name} workflow agent '${stageAgent}' not found in agent config; disabling dev_pipeline for this conversation`);
            return null;
        }
    }

    return sequence;
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
        if (!invocationFailed && currentStage === 0) {
            if (conv.taskId) {
                setDevPipelineAwaitingPmApproval(conv.taskId, true);
            }
            log('INFO', `Dev pipeline waiting user approval after PM for conversation ${conv.id}`);
            emitEvent('dev_pipeline_waiting_approval', {
                teamId: conv.teamContext.teamId,
                conversationId: conv.id,
                taskId: conv.taskId || null,
                currentAgent: agentId,
            });
            return;
        }
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

