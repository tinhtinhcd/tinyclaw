import { AgentConfig, TeamConfig } from '../lib/types';
import {
    applyRoleTaskLinkageState,
    buildRoleFetchedPrContext,
    buildTaskLinkageContext,
    detectWorkflowRole,
    WorkflowRole,
} from '../lib/task-linkage-workflow';
import { warnTinyEvent } from '../lib/observability';

function deriveMappedWorkflowRole(
    agentId: string,
    teamContext: { teamId: string; team: TeamConfig } | null,
): WorkflowRole | null {
    const wf = teamContext?.team.workflow;
    if (!wf || wf.type !== 'dev_pipeline') return null;
    const id = agentId.toLowerCase();
    if (wf.pm.toLowerCase() === id) return 'pm';
    if (wf.coder.toLowerCase() === id) return 'coder';
    if (wf.reviewer.toLowerCase() === id) return 'reviewer';
    if (wf.tester.toLowerCase() === id) return 'tester';
    return null;
}

export async function enrichPromptContext(params: {
    message: string;
    linkedTaskId?: string;
    agentId: string;
    agent: AgentConfig;
    teamContext: { teamId: string; team: TeamConfig } | null;
    log: (level: string, msg: string) => void;
    fetchReviewerPrContextFn?: (
        taskId: string,
        role: WorkflowRole,
        log: (level: string, msg: string) => void,
    ) => Promise<string>;
}): Promise<{ message: string; role: WorkflowRole }> {
    const {
        linkedTaskId, agentId, agent, teamContext, log,
    } = params;
    const mappedRole = deriveMappedWorkflowRole(agentId, teamContext) || undefined;
    const roleAwareAgent = mappedRole ? { ...agent, workflowRole: mappedRole } : agent;
    const role = detectWorkflowRole(agentId, roleAwareAgent);

    let message = params.message;
    if (linkedTaskId) {
        applyRoleTaskLinkageState(linkedTaskId, agentId, role, log);
        const linkageContext = buildTaskLinkageContext(linkedTaskId, role, log);
        if (linkageContext) {
            message = `${message}\n\n------\n\n${linkageContext}`;
        }
        const fetchReviewerContext = params.fetchReviewerPrContextFn || buildRoleFetchedPrContext;
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

    return { message, role };
}

