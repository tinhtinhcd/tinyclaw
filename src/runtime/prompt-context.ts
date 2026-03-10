import { AgentConfig, TeamConfig } from '../lib/types';
import { buildRolePromptGuidance } from '../lib/task-linkage-workflow';
import {
    applyRoleTaskLinkageState,
    buildRoleFetchedPrContext,
    buildRoleLinkedPrContext,
    buildTaskLinkageContext,
    buildTesterSynthesizedFocusFromLinkage,
    detectWorkflowRole,
    WorkflowRole,
} from '../lib/task-linkage-workflow';
import { emitTinyEvent, warnTinyEvent } from '../lib/observability';
import { applyContextBudget, ContextBlock } from '../lib/context-budget';

function deriveMappedWorkflowRole(
    agentId: string,
    teamContext: { teamId: string; team: TeamConfig } | null,
): WorkflowRole | null {
    const wf = teamContext?.team.workflow;
    if (!wf || wf.type !== 'dev_pipeline') return null;
    const id = agentId.toLowerCase();
    if (wf.scrum_master && wf.scrum_master.toLowerCase() === id) return 'scrum_master';
    if (wf.pm && wf.pm.toLowerCase() === id) return 'scrum_master';
    if (wf.coder && wf.coder.toLowerCase() === id) return 'coder';
    if (wf.reviewer && wf.reviewer.toLowerCase() === id) return 'reviewer';
    if (wf.tester && wf.tester.toLowerCase() === id) return 'tester';
    return null;
}

const DEFAULT_PROMPT_CONTEXT_MAX_CHARS = 12000;
const CONTEXT_PRIORITIES: Record<string, number> = {
    TASK_LINKAGE_CONTEXT: 100,
    BA_REQUIREMENTS_CONTEXT: 80,
    ARCHITECT_DESIGN_CONTEXT: 75,
    REVIEWER_LINKED_PR_CONTEXT: 70,
    TESTER_LINKED_PR_CONTEXT: 70,
    REVIEWER_FETCHED_PR_CONTEXT: 50,
    TESTER_FETCHED_PR_CONTEXT: 50,
    TESTER_SYNTHESIZED_FOCUS: 30,
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
    return n;
}

function splitFetchedAndSynthBlocks(content: string): { fetched: string; testerSynthesized: string } {
    if (!content) return { fetched: '', testerSynthesized: '' };
    const m = content.match(/\[TESTER_SYNTHESIZED_FOCUS\][\s\S]*?\[\/TESTER_SYNTHESIZED_FOCUS\]/);
    if (!m || !m[0]) return { fetched: content.trim(), testerSynthesized: '' };
    const testerSynthesized = m[0].trim();
    const fetched = content.replace(m[0], '').trim();
    return { fetched, testerSynthesized };
}

function extractLatestStructuredBlock(outputs: string[], startTag: string, endTag: string): string {
    if (!outputs || outputs.length === 0) return '';
    const pattern = new RegExp(`\\${startTag}[\\s\\S]*?\\${endTag}`, 'g');
    for (let i = outputs.length - 1; i >= 0; i--) {
        const text = outputs[i] || '';
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
            return matches[matches.length - 1].trim();
        }
    }
    return '';
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
    upstreamOutputs?: string[];
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
        const blocks: ContextBlock[] = [];
        const linkageContext = buildTaskLinkageContext(linkedTaskId, role, log);
        if (linkageContext) blocks.push({
            name: 'TASK_LINKAGE_CONTEXT',
            content: linkageContext,
            priority: CONTEXT_PRIORITIES.TASK_LINKAGE_CONTEXT,
        });
        const linkedPrContext = buildRoleLinkedPrContext(linkedTaskId, role);
        if (linkedPrContext) blocks.push({
            name: role === 'reviewer' ? 'REVIEWER_LINKED_PR_CONTEXT' : 'TESTER_LINKED_PR_CONTEXT',
            content: linkedPrContext,
            priority: role === 'reviewer' ? CONTEXT_PRIORITIES.REVIEWER_LINKED_PR_CONTEXT : CONTEXT_PRIORITIES.TESTER_LINKED_PR_CONTEXT,
        });
        const fetchReviewerContext = params.fetchReviewerPrContextFn || buildRoleFetchedPrContext;
        try {
            const fetchedReviewerContext = await fetchReviewerContext(linkedTaskId, role, log);
            if (fetchedReviewerContext) {
                const split = splitFetchedAndSynthBlocks(fetchedReviewerContext);
                if (split.fetched) {
                    blocks.push({
                        name: role === 'reviewer' ? 'REVIEWER_FETCHED_PR_CONTEXT' : 'TESTER_FETCHED_PR_CONTEXT',
                        content: split.fetched,
                        priority: role === 'reviewer' ? CONTEXT_PRIORITIES.REVIEWER_FETCHED_PR_CONTEXT : CONTEXT_PRIORITIES.TESTER_FETCHED_PR_CONTEXT,
                    });
                }
                if (split.testerSynthesized) {
                    blocks.push({
                        name: 'TESTER_SYNTHESIZED_FOCUS',
                        content: split.testerSynthesized,
                        priority: CONTEXT_PRIORITIES.TESTER_SYNTHESIZED_FOCUS,
                    });
                }
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
        const linkedSynthesized = buildTesterSynthesizedFocusFromLinkage(linkedTaskId, role);
        if (linkedSynthesized) {
            blocks.push({
                name: 'TESTER_SYNTHESIZED_FOCUS',
                content: linkedSynthesized,
                priority: CONTEXT_PRIORITIES.TESTER_SYNTHESIZED_FOCUS,
            });
        }

        const upstreamOutputs = params.upstreamOutputs || [];
        const latestBaRequirements = extractLatestStructuredBlock(
            upstreamOutputs,
            '[BA_REQUIREMENTS]',
            '[/BA_REQUIREMENTS]',
        );
        const latestArchitectDesign = extractLatestStructuredBlock(
            upstreamOutputs,
            '[ARCHITECT_DESIGN]',
            '[/ARCHITECT_DESIGN]',
        );
        if (latestBaRequirements && ['scrum_master', 'architect', 'coder', 'reviewer', 'tester'].includes(role)) {
            blocks.push({
                name: 'BA_REQUIREMENTS_CONTEXT',
                content: [
                    '[BA_REQUIREMENTS_CONTEXT]',
                    latestBaRequirements,
                    '[/BA_REQUIREMENTS_CONTEXT]',
                ].join('\n'),
                priority: CONTEXT_PRIORITIES.BA_REQUIREMENTS_CONTEXT,
            });
        }
        if (latestArchitectDesign && ['coder', 'reviewer', 'tester'].includes(role)) {
            blocks.push({
                name: 'ARCHITECT_DESIGN_CONTEXT',
                content: [
                    '[ARCHITECT_DESIGN_CONTEXT]',
                    latestArchitectDesign,
                    '[/ARCHITECT_DESIGN_CONTEXT]',
                ].join('\n'),
                priority: CONTEXT_PRIORITIES.ARCHITECT_DESIGN_CONTEXT,
            });
        }

        const maxChars = parsePositiveInt(process.env.PROMPT_CONTEXT_MAX_CHARS, DEFAULT_PROMPT_CONTEXT_MAX_CHARS);
        const budgeted = applyContextBudget(blocks, maxChars);
        const originalByName = new Map(blocks.map(b => [b.name, b]));
        const keptNames = new Set(budgeted.map(b => b.name));
        for (const b of budgeted) {
            const original = originalByName.get(b.name);
            if (original && b.content.length < original.content.length) {
                warnTinyEvent({
                    type: 'context_budget_truncation',
                    taskId: linkedTaskId,
                    agentId,
                    role,
                    metadata: {
                        blockName: b.name,
                        originalLength: original.content.length,
                        truncatedLength: b.content.length,
                        maxChars,
                    },
                });
            }
        }
        for (const b of blocks) {
            if (!keptNames.has(b.name)) {
                warnTinyEvent({
                    type: 'context_block_dropped',
                    taskId: linkedTaskId,
                    agentId,
                    role,
                    metadata: {
                        blockName: b.name,
                        originalLength: b.content.length,
                        maxChars,
                    },
                });
            }
        }
        if (budgeted.length > 0) {
            emitTinyEvent({
                type: 'context_budget_applied',
                taskId: linkedTaskId,
                agentId,
                role,
                metadata: {
                    maxChars,
                    originalBlocks: blocks.length,
                    keptBlocks: budgeted.length,
                },
            });
            const appended = budgeted.map(b => b.content).join('\n\n------\n\n');
            message = `${message}\n\n------\n\n${appended}`;
        }
    }

    // When no task linkage, inject role guidance (including no-role-simulation) so agents never simulate other roles
    if (!linkedTaskId) {
        const roleGuidance = buildRolePromptGuidance(role);
        if (roleGuidance.length > 0) {
            message = `${roleGuidance.join('\n')}\n\n------\n\n${message}`;
        }
    }

    return { message, role };
}

