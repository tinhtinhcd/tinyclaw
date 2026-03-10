import { AgentConfig, Conversation, MessageData, Settings, TeamConfig } from '../lib/types';
import { emitEvent } from '../lib/logging';
import { enqueueInternalMessage, incrementPending } from '../lib/conversation';
import { extractHandoffTargets } from '../lib/routing';
import { setDevPipelineApprovalState, setWorkflowWaitingForUserInput } from '../lib/task-linkage';
import { ResolvedTeamWorkflow, resolveTeamWorkflow, getAllowedHandoffAgentIds } from './workflow-config';

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

/**
 * Mention-driven handoff: explicit mention is the only trigger.
 * No auto-advance. Workflow config validates allowed transitions.
 */
export function handleConversationHandoffs(params: {
    conv: Conversation;
    agentId: string;
    response: string;
    invocationFailed: boolean;
    teams: Record<string, TeamConfig>;
    agents: Record<string, AgentConfig>;
    settings: Settings;
    messageData: MessageData;
    log: (level: string, msg: string) => void;
}): void {
    const {
        conv, agentId, response, invocationFailed, teams, agents, settings, messageData, log,
    } = params;

    if (invocationFailed) {
        log('WARN', `Handoff skipped for conversation ${conv.id}: @${agentId} failed`);
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

    if (agentTargets.length === 0) {
        const workflow = resolveTeamWorkflow({
            teamId: conv.teamContext.teamId,
            team: conv.teamContext.team,
            agents,
            settings,
            log,
        });
        const stageIdx = workflow?.stages?.findIndex(s => s.agentId === agentId) ?? -1;
        const stage = stageIdx >= 0 ? workflow!.stages[stageIdx] : undefined;
        const nextStage = stageIdx >= 0 && stageIdx + 1 < (workflow?.stages?.length ?? 0)
            ? workflow!.stages[stageIdx + 1]
            : undefined;
        if (stage?.requiresApprovalToAdvance && nextStage && conv.taskId) {
            setDevPipelineApprovalState(conv.taskId, {
                awaitingApproval: true,
                awaitingRole: stage.role,
                nextRole: nextStage.role,
                workflowId: workflow?.workflowId,
            });
            log('INFO', `Handoff paused: @${agentId} stage requires approval; waiting for user`);
            emitEvent('dev_pipeline_waiting_approval', {
                teamId: conv.teamContext.teamId,
                conversationId: conv.id,
                taskId: conv.taskId,
                role: stage.role,
                currentAgent: agentId,
            });
        } else {
            log('INFO', `No handoff from @${agentId} — workflow paused (no valid mention)`);
        }
        return;
    }

    const workflow = resolveTeamWorkflow({
        teamId: conv.teamContext.teamId,
        team: conv.teamContext.team,
        agents,
        settings,
        log,
    });
    const allowedAgentIds = workflow
        ? getAllowedHandoffAgentIds(workflow, agentId, agents)
        : new Set(conv.teamContext.team.agents);

    const validAgentTargets = agentTargets.filter(t => allowedAgentIds.has(t.agentId));
    const invalidMentions = agentTargets.filter(t => !allowedAgentIds.has(t.agentId));

    if (invalidMentions.length > 0) {
        log('WARN', `Rejected invalid transition(s) @${agentId} → [${invalidMentions.map(m => m.agentId).join(', ')}]; allowed: [${[...allowedAgentIds].join(', ')}]`);
    }

    if (validAgentTargets.length > 0 && conv.totalMessages < conv.maxMessages) {
        incrementPending(conv, validAgentTargets.length);
        conv.outgoingMentions.set(agentId, validAgentTargets.length);
        for (const t of validAgentTargets) {
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
    } else if (validAgentTargets.length > 0) {
        log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing handoff`);
    }
}

