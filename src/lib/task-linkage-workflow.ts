import { AgentConfig, TaskLinkage, TaskStatus } from './types';
import {
    attachGitBranch,
    attachLinearIssue,
    attachPullRequest,
    getTaskLinkage,
    setTaskOwner,
    setTaskStatus,
} from './task-linkage';
import { createIssue } from '../integrations/linear/linear-issues';
import { createBranch } from '../integrations/git/repo-service';
import { createPullRequest, getPullRequestDetails } from '../integrations/git/pr-service';
import { emitTinyEvent, warnTinyEvent } from './observability';

const MAX_FETCHED_PR_BODY_CHARS = 1500;
const MAX_TESTER_SYNTHESIZED_FOCUS_CHARS = 1200;

function truncateWithMarker(value: string, maxChars: number): string {
    const marker = '... (truncated)';
    if (maxChars <= 0) return '';
    if (value.length <= maxChars) return value;
    if (maxChars <= marker.length) return marker.slice(0, maxChars);
    return `${value.slice(0, maxChars - marker.length)}${marker}`;
}

export type WorkflowRole = string;
type CommandAction =
    | 'attach_linear'
    | 'create_linear_issue'
    | 'attach_git_branch'
    | 'create_git_branch'
    | 'attach_pull_request'
    | 'create_pull_request';

const ROLE_COMMAND_CONTRACT: Record<string, CommandAction[]> = {
    scrum_master: ['attach_linear', 'create_linear_issue'],
    pm: ['attach_linear', 'create_linear_issue'],
    coder: ['attach_git_branch', 'create_git_branch', 'attach_pull_request', 'create_pull_request'],
    reviewer: [],
    tester: [],
};

function parseAttributes(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([A-Za-z0-9_]+)="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        attrs[m[1]] = m[2];
    }
    return attrs;
}

function isTruthy(value?: string): boolean {
    if (!value) return false;
    return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
}

function parseRequiredPositiveInt(value?: string): number | null {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
    return n;
}

function statusForRole(role: WorkflowRole): TaskStatus | null {
    if (role === 'scrum_master' || role === 'pm') return 'in_progress';
    if (role === 'coder') return 'in_progress';
    if (role === 'reviewer') return 'review';
    if (role === 'tester') return 'review';
    if (role === 'architect' || role === 'ba') return 'in_progress';
    return null;
}

function roleContractHint(role: WorkflowRole): string {
    const allowed = ROLE_COMMAND_CONTRACT[role];
    if (!allowed || allowed.length === 0) {
        return `Role '${role}' is read-only for task_linkage commands in MVP.`;
    }
    return `Allowed task_linkage actions for role '${role}': ${allowed.join(', ')}.`;
}

export function getRoleCommandContract(role: WorkflowRole): string[] {
    return [...(ROLE_COMMAND_CONTRACT[role] || [])];
}

const NO_ROLE_SIMULATION = 'Never simulate or speak for other roles. You are this role only. Do not say "BA is working", "Coder is implementing", "Reviewer is reviewing", etc. Each role speaks for itself.';

export function buildRolePromptGuidance(role: WorkflowRole): string[] {
    const base = [NO_ROLE_SIMULATION];
    if (role === 'ba') {
        return [
            ...base,
            'BA guidance: clarify business goals and missing requirements before implementation.',
            'Identify ambiguity and ask concise clarifying questions when requirements are underspecified.',
            'Produce compact requirement analysis with assumptions and acceptance criteria/user-story style outcomes.',
            'Avoid jumping straight to implementation details unless they clarify business impact.',
            'Do not behave like coder/reviewer/tester.',
            'Handoff: if requirements are clear, mention next role (e.g. [@scrum_master: message]). If requirements are unclear or need confirmation, mention [@user: your question]. You may also stop without handoff when appropriate.',
            'Use this structured contract when possible:',
            '[BA_REQUIREMENTS]',
            'Business Goal:',
            'Clarifying Questions:',
            'Assumptions:',
            'User Stories:',
            'Acceptance Criteria:',
            'Risks / Unknowns:',
            '[/BA_REQUIREMENTS]',
        ];
    }
    if (role === 'scrum_master' || role === 'pm') {
        return [
            ...base,
            "PM guidance: emit only 'create_linear_issue' or 'attach_linear'.",
            "Scrum Master guidance: emit only 'create_linear_issue' or 'attach_linear'.",
            'Reuse existing Linear linkage when present.',
            'Avoid emitting commands when title/description/teamId are missing.',
            'Handoff: when ready, mention next role (e.g. [@architect: message]). If blocked or need clarification, mention [@user: question]. You may stop without handoff when appropriate.',
            'Scrum Master valid: [task_linkage action="create_linear_issue" title="Fix parser bug" description="Handle malformed payload." teamId="abc123"]',
            'Scrum Master valid: [task_linkage action="attach_linear" linearIssueId="uuid" linearIssueIdentifier="ENG-123" linearIssueUrl="https://linear.app/..."]',
            'Scrum Master invalid: [task_linkage action="create_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]',
        ];
    }
    if (role === 'coder') {
        return [
            "Coder guidance: emit only git/PR commands ('create_git_branch', 'attach_git_branch', 'create_pull_request', 'attach_pull_request').",
            'Handoff: when ready, mention next role (e.g. [@reviewer: message]). If blocked or need clarification, mention [@user: question]. You may stop without handoff when appropriate.',
            'Read linkage first and reuse existing repo/base/branch when available.',
            'Do not emit Linear creation commands by default.',
            'Coder valid: [task_linkage action="create_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]',
            'Coder valid: [task_linkage action="create_pull_request" repo="org/repo" title="Fix parser bug" description="Implements fix." headBranch="feature/x" baseBranch="main"]',
            'Coder invalid: [task_linkage action="create_linear_issue" title="..." description="..." teamId="..."]',
        ];
    }
    if (role === 'architect') {
        return [
            ...base,
            'Architect guidance: produce implementation-oriented technical design before coding.',
            'Define components/modules/services, API/data flow, and major boundaries.',
            'Mention key tradeoffs and technical risks briefly.',
            'Provide a practical design outline that enables the coder stage.',
            'Do not act as reviewer/tester; do not write full code unless explicitly requested.',
            'Handoff: when ready, mention next role (e.g. [@coder: message]). If blocked or need clarification, mention [@user: question]. You may stop without handoff when appropriate.',
            'Use this structured contract when possible:',
            '[ARCHITECT_DESIGN]',
            'System Goal:',
            'Proposed Components / Modules:',
            'API / Interface Notes:',
            'Data / Storage Considerations:',
            'Security / Reliability Considerations:',
            'Implementation Plan:',
            'Technical Risks / Tradeoffs:',
            '[/ARCHITECT_DESIGN]',
        ];
    }
    if (role === 'reviewer') {
        return [
            ...base,
            'Reviewer guidance: read-only linkage usage.',
            'Handoff: when ready, mention next role (e.g. [@tester: message]). If blocked or need clarification, mention [@user: question]. You may stop without handoff when appropriate.',
            'Use linked Linear/PR context in review output.',
            'If PR linkage already exists, do not ask user again for PR number/URL/repo unless linkage is actually missing.',
            'Reference linked PR, branch, and issue naturally in your review summary.',
            'Avoid any [task_linkage ...] mutation command.',
            'Reviewer invalid: [task_linkage action="attach_pull_request" pullRequestNumber="123" pullRequestUrl="https://..."]',
        ];
    }
    if (role === 'tester') {
        return [
            ...base,
            'Tester guidance: read-only linkage usage.',
            'Handoff: when done, you may mention [@user: summary] or stop without handoff. Mention next role only if workflow continues.',
            'Use linked Linear/PR context in testing output.',
            'If PR linkage already exists, do not ask user again for PR number/URL/repo unless linkage is actually missing.',
            'Use linked PR and changed-file context to suggest testing focus and risk areas.',
            'Avoid any [task_linkage ...] mutation command.',
            'Tester invalid: [task_linkage action="attach_git_branch" repo="org/repo" baseBranch="main" workingBranch="feature/x"]',
        ];
    }
    return [
        ...base,
        'Unknown-role guidance: do not emit task_linkage mutation commands.',
    ];
}

function normalizeWorkflowRole(value?: string): WorkflowRole | null {
    if (!value) return null;
    const role = value.trim().toLowerCase();
    if (!role) return null;
    if (role === 'pm') return 'scrum_master';
    return role;
}

function splitAgentIdTokens(agentId: string): string[] {
    return agentId
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function hasAnyRoleToken(tokens: string[], candidates: string[]): boolean {
    return candidates.some(candidate => tokens.includes(candidate));
}

export function detectWorkflowRole(agentId: string, agent: AgentConfig): WorkflowRole {
    const explicitRole = normalizeWorkflowRole(agent.role);
    if (explicitRole) return explicitRole;
    const mappedRole = normalizeWorkflowRole(agent.workflowRole);
    if (mappedRole) return mappedRole;

    const tokens = splitAgentIdTokens(agentId);
    if (hasAnyRoleToken(tokens, ['scrum', 'scrummaster', 'sm', 'pm'])) {
        warnTinyEvent({
            type: 'workflow_role_heuristic_fallback',
            agentId,
            role: 'scrum_master',
            message: 'Role inferred by agentId heuristic',
            metadata: { inferredFrom: 'agentId-token:scrum|scrummaster|sm|pm' },
        });
        return 'scrum_master';
    }
    if (hasAnyRoleToken(tokens, ['coder', 'dev', 'developer'])) {
        warnTinyEvent({
            type: 'workflow_role_heuristic_fallback',
            agentId,
            role: 'coder',
            message: 'Role inferred by agentId heuristic',
            metadata: { inferredFrom: 'agentId-token:coder|dev|developer' },
        });
        return 'coder';
    }
    if (hasAnyRoleToken(tokens, ['review', 'reviewer'])) {
        warnTinyEvent({
            type: 'workflow_role_heuristic_fallback',
            agentId,
            role: 'reviewer',
            message: 'Role inferred by agentId heuristic',
            metadata: { inferredFrom: 'agentId-token:review|reviewer' },
        });
        return 'reviewer';
    }
    if (hasAnyRoleToken(tokens, ['test', 'tester', 'qa'])) {
        warnTinyEvent({
            type: 'workflow_role_heuristic_fallback',
            agentId,
            role: 'tester',
            message: 'Role inferred by agentId heuristic',
            metadata: { inferredFrom: 'agentId-token:test|tester|qa' },
        });
        return 'tester';
    }
    return 'unknown';
}

export function applyRoleTaskLinkageState(
    taskId: string,
    agentId: string,
    role: WorkflowRole,
    log: (level: string, msg: string) => void,
): void {
    setTaskOwner(taskId, agentId);
    const next = statusForRole(role);
    if (next) setTaskStatus(taskId, next);
    log('INFO', `[TASK_LINKAGE] Role using linkage: task=${taskId} role=${role} owner=${agentId}${next ? ` status=${next}` : ''}`);
}

function linkageSummary(linkage: TaskLinkage): string[] {
    return [
        `taskId=${linkage.taskId}`,
        `linear=${linkage.linearIssueIdentifier || '-'}`,
        `repo=${linkage.repo || '-'}`,
        `branch=${linkage.workingBranch || '-'}`,
        `pr=${typeof linkage.pullRequestNumber === 'number' ? `#${linkage.pullRequestNumber}` : '-'}`,
        `owner=${linkage.currentOwnerAgentId || '-'}`,
        `status=${linkage.status || '-'}`,
    ];
}

export function buildTaskLinkageContext(
    taskId: string,
    role: WorkflowRole,
    log: (level: string, msg: string) => void,
): string {
    const linkage = getTaskLinkage(taskId);
    if (!linkage) return '';
    log('INFO', `[TASK_LINKAGE] Resolved linkage ${linkageSummary(linkage).join(' ')}`);

    const roleHint =
        role === 'ba'
            ? 'Clarify business requirements, scope, and acceptance criteria before implementation.'
            : role === 'scrum_master'
                ? 'If there is no linked Linear issue, create one and emit a task_linkage command.'
                : role === 'architect'
                    ? 'Provide technical design and implementation plan before coding starts.'
                    : role === 'coder'
                        ? 'Reuse repo/baseBranch when present. Create/attach branch and PR via task_linkage commands.'
                        : role === 'reviewer'
                            ? 'Use linked Linear and PR context during review.'
                            : role === 'tester'
                                ? 'Use linked Linear and PR context during test validation.'
                                : 'Use linked task context.';

    return [
        '[TASK_LINKAGE_CONTEXT]',
        `taskId: ${linkage.taskId}`,
        `linearIssue: ${linkage.linearIssueIdentifier || '-'} (${linkage.linearIssueUrl || '-'})`,
        `git: provider=${linkage.gitProvider || '-'} repo=${linkage.repo || '-'} base=${linkage.baseBranch || '-'} working=${linkage.workingBranch || '-'}`,
        `pullRequest: number=${typeof linkage.pullRequestNumber === 'number' ? linkage.pullRequestNumber : '-'} url=${linkage.pullRequestUrl || '-'}`,
        `currentOwner: ${linkage.currentOwnerAgentId || '-'}`,
        `status: ${linkage.status || '-'}`,
        '',
        roleHint,
        roleContractHint(role),
        ...buildRolePromptGuidance(role),
        '[/TASK_LINKAGE_CONTEXT]',
    ].join('\n');
}

export function buildRoleLinkedPrContext(taskId: string, role: WorkflowRole): string {
    if (role !== 'reviewer' && role !== 'tester') return '';
    const linkage = getTaskLinkage(taskId);
    if (!linkage) return '';
    return [
        role === 'reviewer' ? '[REVIEWER_LINKED_PR_CONTEXT]' : '[TESTER_LINKED_PR_CONTEXT]',
        `taskId=${linkage.taskId}`,
        `linearIssueIdentifier=${linkage.linearIssueIdentifier || '-'}`,
        `repo=${linkage.repo || '-'}`,
        `workingBranch=${linkage.workingBranch || '-'}`,
        `pullRequestNumber=${typeof linkage.pullRequestNumber === 'number' ? linkage.pullRequestNumber : '-'}`,
        `pullRequestUrl=${linkage.pullRequestUrl || '-'}`,
        role === 'reviewer'
            ? 'Use these linked fields directly in the review; avoid requesting them again when present.'
            : 'Use these linked fields directly in testing analysis; avoid requesting them again when present.',
        role === 'reviewer' ? '[/REVIEWER_LINKED_PR_CONTEXT]' : '[/TESTER_LINKED_PR_CONTEXT]',
    ].join('\n');
}

export function buildTesterSynthesizedFocusFromLinkage(taskId: string, role: WorkflowRole): string {
    if (role !== 'tester') return '';
    const linkage = getTaskLinkage(taskId);
    if (!linkage) return '';
    if (linkage.pullRequestNumber || linkage.pullRequestUrl) return '';
    return synthesizeTesterFocusBlock({
        taskId,
        repo: linkage.repo,
        workingBranch: linkage.workingBranch,
        linearIssueIdentifier: linkage.linearIssueIdentifier,
    });
}

function validateAllowed(role: WorkflowRole, action: string): string | null {
    const allowed = ROLE_COMMAND_CONTRACT[role] || [];
    if (!allowed.includes(action as CommandAction)) {
        return `role '${role}' is not allowed to run action '${action}'`;
    }
    return null;
}

function validateCommand(
    action: string,
    attrs: Record<string, string>,
    linkage: TaskLinkage,
): { ok: true } | { ok: false; reason: string } {
    const force = isTruthy(attrs.force) || isTruthy(attrs.allowOverwrite);
    if (action === 'attach_linear') {
        if (!attrs.linearIssueId || !attrs.linearIssueIdentifier) {
            return { ok: false, reason: "attach_linear requires 'linearIssueId' and 'linearIssueIdentifier'" };
        }
        if (!force && linkage.linearIssueId && linkage.linearIssueId !== attrs.linearIssueId) {
            return { ok: false, reason: `linear issue already linked (${linkage.linearIssueIdentifier || linkage.linearIssueId}); set force=\"true\" to overwrite` };
        }
    } else if (action === 'create_linear_issue') {
        if (!attrs.title || !attrs.description || !attrs.teamId) {
            return { ok: false, reason: "create_linear_issue requires 'title', 'description', and 'teamId'" };
        }
        if (!force && linkage.linearIssueId) {
            return { ok: false, reason: `linear issue already linked (${linkage.linearIssueIdentifier || linkage.linearIssueId}); set force=\"true\" to create another` };
        }
    } else if (action === 'attach_git_branch') {
        if (!attrs.repo || !attrs.workingBranch) {
            return { ok: false, reason: "attach_git_branch requires 'repo' and 'workingBranch' (baseBranch optional if already linked)" };
        }
        const nextBase = attrs.baseBranch || linkage.baseBranch;
        if (!nextBase) {
            return { ok: false, reason: "attach_git_branch missing 'baseBranch' and no existing linkage.baseBranch to reuse" };
        }
        if (!force && linkage.workingBranch && linkage.workingBranch !== attrs.workingBranch) {
            return { ok: false, reason: `working branch already linked (${linkage.workingBranch}); set force=\"true\" to overwrite` };
        }
    } else if (action === 'create_git_branch') {
        const repo = attrs.repo || linkage.repo;
        const baseBranch = attrs.baseBranch || linkage.baseBranch;
        if (!repo || !baseBranch || !attrs.workingBranch) {
            return { ok: false, reason: "create_git_branch requires repo/baseBranch/workingBranch (repo/baseBranch can come from existing linkage)" };
        }
        if (!force && linkage.workingBranch) {
            return { ok: false, reason: `working branch already linked (${linkage.workingBranch}); set force=\"true\" to create another` };
        }
    } else if (action === 'attach_pull_request') {
        const prNumber = parseRequiredPositiveInt(attrs.pullRequestNumber) ?? linkage.pullRequestNumber ?? null;
        const prUrl = attrs.pullRequestUrl || linkage.pullRequestUrl;
        if (!prNumber && !prUrl) {
            return { ok: false, reason: "attach_pull_request requires 'pullRequestNumber' or 'pullRequestUrl'" };
        }
        if (!force && linkage.pullRequestNumber && prNumber && linkage.pullRequestNumber !== prNumber) {
            return { ok: false, reason: `pull request already linked (#${linkage.pullRequestNumber}); set force=\"true\" to overwrite` };
        }
    } else if (action === 'create_pull_request') {
        const repo = attrs.repo || linkage.repo;
        const headBranch = attrs.headBranch || linkage.workingBranch;
        const baseBranch = attrs.baseBranch || linkage.baseBranch;
        if (!repo || !headBranch || !baseBranch || !attrs.title || !attrs.description) {
            return { ok: false, reason: "create_pull_request requires title/description plus repo/headBranch/baseBranch (repo/head/base can come from linkage)" };
        }
        if (!force && (linkage.pullRequestNumber || linkage.pullRequestUrl)) {
            return { ok: false, reason: `pull request already linked (${linkage.pullRequestUrl || `#${linkage.pullRequestNumber}`}); set force=\"true\" to create another` };
        }
    } else {
        return { ok: false, reason: `unsupported action '${action}'` };
    }
    return { ok: true };
}

export function evaluateTaskLinkageCommand(
    role: WorkflowRole,
    action: string,
    attrs: Record<string, string>,
    linkage: TaskLinkage,
): { accepted: true } | { accepted: false; reason: string } {
    const permissionErr = validateAllowed(role, action);
    if (permissionErr) {
        return { accepted: false, reason: permissionErr };
    }

    const validation = validateCommand(action, attrs, linkage);
    if (!validation.ok) {
        return { accepted: false, reason: validation.reason };
    }

    return { accepted: true };
}

export interface TaskLinkageExecutionDeps {
    getTaskLinkage: typeof getTaskLinkage;
    attachLinearIssue: typeof attachLinearIssue;
    attachGitBranch: typeof attachGitBranch;
    attachPullRequest: typeof attachPullRequest;
    createIssue: typeof createIssue;
    createBranch: typeof createBranch;
    createPullRequest: typeof createPullRequest;
}

const DEFAULT_EXECUTION_DEPS: TaskLinkageExecutionDeps = {
    getTaskLinkage,
    attachLinearIssue,
    attachGitBranch,
    attachPullRequest,
    createIssue,
    createBranch,
    createPullRequest,
};

interface ReviewerPrFetchDeps {
    getTaskLinkage: typeof getTaskLinkage;
    getPullRequestDetails: typeof getPullRequestDetails;
}

const DEFAULT_REVIEWER_PR_FETCH_DEPS: ReviewerPrFetchDeps = {
    getTaskLinkage,
    getPullRequestDetails,
};

interface TesterFocusInput {
    taskId?: string;
    repo?: string;
    workingBranch?: string;
    linearIssueIdentifier?: string;
    prTitle?: string;
    prBody?: string;
    additions?: number;
    deletions?: number;
    changedFiles?: number;
    files?: string[];
}

function extractTopModules(files: string[]): string[] {
    const modules = new Set<string>();
    for (const file of files) {
        const top = file.split('/')[0];
        if (top) modules.add(top);
    }
    return Array.from(modules).slice(0, 6);
}

function deriveRiskHotspots(input: TesterFocusInput): string[] {
    const hotspots: string[] = [];
    const files = input.files || [];
    const text = `${input.prTitle || ''}\n${input.prBody || ''}`.toLowerCase();

    if (files.some(f => /auth|login|permission|role/i.test(f)) || /auth|permission|role/.test(text)) {
        hotspots.push('Auth/permission flows');
    }
    if (files.some(f => /db|schema|migration|sql/i.test(f))) {
        hotspots.push('Data model and migration compatibility');
    }
    if (files.some(f => /api|route|controller|handler/i.test(f))) {
        hotspots.push('API contract and backward compatibility');
    }
    if (typeof input.additions === 'number' && typeof input.deletions === 'number' && input.additions + input.deletions > 300) {
        hotspots.push('Large change set; broad regression surface');
    }
    return hotspots.slice(0, 4);
}

export function synthesizeTesterFocusBlock(input: TesterFocusInput): string {
    const hasContext = !!(
        input.repo
        || input.workingBranch
        || input.linearIssueIdentifier
        || (input.files && input.files.length > 0)
        || input.prTitle
        || input.prBody
    );
    if (!hasContext) {
        emitTinyEvent({
            type: 'tester_focus_skipped',
            taskId: input.taskId,
            role: 'tester',
            metadata: { reason: 'no_useful_context' },
        });
        return '';
    }

    const files = input.files || [];
    const modules = extractTopModules(files);
    const hotspots = deriveRiskHotspots(input);
    const checklist: string[] = [
        'Validate primary happy path for changed behavior',
        'Run regression checks around linked issue scope',
    ];
    if (input.repo || input.workingBranch) {
        checklist.push('Verify branch-specific integration points and build/test commands');
    }
    if (files.some(f => /api|route|controller|handler/i.test(f))) {
        checklist.push('Confirm API request/response compatibility');
    }
    if (files.some(f => /ui|component|view|page/i.test(f))) {
        checklist.push('Check UI flows and edge-case interactions');
    }

    const regressionFocus: string[] = [];
    if (modules.length > 0) regressionFocus.push(`Modules touched: ${modules.join(', ')}`);
    if (typeof input.changedFiles === 'number') regressionFocus.push(`Changed files count: ${input.changedFiles}`);
    if (typeof input.additions === 'number' || typeof input.deletions === 'number') {
        regressionFocus.push(`Diff size: +${input.additions || 0}/-${input.deletions || 0}`);
    }

    const block = [
        '[TESTER_SYNTHESIZED_FOCUS]',
        `repo=${input.repo || '-'}`,
        `workingBranch=${input.workingBranch || '-'}`,
        `linearIssueIdentifier=${input.linearIssueIdentifier || '-'}`,
        `prTitle=${input.prTitle || '-'}`,
        `affectedModules=${modules.length > 0 ? modules.join(', ') : '-'}`,
        `riskHotspots=${hotspots.length > 0 ? hotspots.join('; ') : '-'}`,
        'suggestedValidationChecklist:',
        ...checklist.slice(0, 5).map(item => `- ${item}`),
        'possibleRegressionFocus:',
        ...(regressionFocus.length > 0 ? regressionFocus.map(item => `- ${item}`) : ['- Baseline smoke/regression around related user flows']),
        '[/TESTER_SYNTHESIZED_FOCUS]',
    ].join('\n');
    const bounded = truncateWithMarker(block, MAX_TESTER_SYNTHESIZED_FOCUS_CHARS);
    emitTinyEvent({
        type: 'tester_focus_generated',
        taskId: input.taskId,
        role: 'tester',
        metadata: {
            affectedModulesCount: modules.length,
            hotspotCount: hotspots.length,
            changedFiles: input.changedFiles,
            originalLength: block.length,
            finalLength: bounded.length,
            truncated: bounded.length < block.length,
        },
    });
    return bounded;
}

function parsePullRequestNumberFromUrl(url?: string): number | undefined {
    if (!url) return undefined;
    const m = url.match(/\/pull\/(\d+)(?:\/|$)/);
    if (!m) return undefined;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
    return n;
}

export async function buildRoleFetchedPrContext(
    taskId: string,
    role: WorkflowRole,
    log: (level: string, msg: string) => void,
    deps: ReviewerPrFetchDeps = DEFAULT_REVIEWER_PR_FETCH_DEPS,
): Promise<string> {
    if (role !== 'reviewer' && role !== 'tester') return '';
    const linkage = deps.getTaskLinkage(taskId);
    if (!linkage) return '';
    const provider = (linkage.gitProvider || 'github').toLowerCase();
    if (provider !== 'github') return '';
    if (!linkage.repo) return '';
    const prNumber = linkage.pullRequestNumber || parsePullRequestNumberFromUrl(linkage.pullRequestUrl);
    if (!prNumber) return '';

    const fetchStartType = role === 'reviewer' ? 'reviewer_pr_fetch_started' : 'tester_pr_fetch_started';
    const fetchSuccessType = role === 'reviewer' ? 'reviewer_pr_fetch_succeeded' : 'tester_pr_fetch_succeeded';
    const fetchFailedType = role === 'reviewer' ? 'reviewer_pr_fetch_failed' : 'tester_pr_fetch_failed';
    const fallbackType = role === 'reviewer' ? 'reviewer_pr_fetch_fallback_linkage' : 'tester_pr_fetch_fallback_linkage';
    emitTinyEvent({
        type: fetchStartType,
        taskId,
        role,
        metadata: {
            source: provider,
            repo: linkage.repo,
            pullRequestNumber: prNumber,
        },
    });

    try {
        const pr = await deps.getPullRequestDetails(linkage.repo, prNumber);
        const filesPreview = pr.files.slice(0, 10)
            .map(f => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
            .join('\n');
        const startTag = role === 'reviewer' ? '[REVIEWER_FETCHED_PR_CONTEXT]' : '[TESTER_FETCHED_PR_CONTEXT]';
        const endTag = role === 'reviewer' ? '[/REVIEWER_FETCHED_PR_CONTEXT]' : '[/TESTER_FETCHED_PR_CONTEXT]';
        const testerFocus = role === 'tester'
            ? synthesizeTesterFocusBlock({
                repo: linkage.repo,
                workingBranch: linkage.workingBranch || pr.headBranch,
                linearIssueIdentifier: linkage.linearIssueIdentifier,
                prTitle: pr.title,
                prBody: pr.body,
                additions: pr.additions,
                deletions: pr.deletions,
                changedFiles: pr.changedFiles,
                files: pr.files.map(f => f.path),
                taskId,
            })
            : '';
        emitTinyEvent({
            type: fetchSuccessType,
            taskId,
            role,
            metadata: {
                source: provider,
                repo: linkage.repo,
                pullRequestNumber: pr.number,
                changedFiles: pr.changedFiles,
            },
        });
        const body = truncateWithMarker(pr.body || '-', MAX_FETCHED_PR_BODY_CHARS);
        return [
            startTag,
            `repo=${linkage.repo}`,
            `pullRequestNumber=${pr.number}`,
            `pullRequestUrl=${pr.url}`,
            `title=${pr.title}`,
            `state=${pr.state}`,
            `baseBranch=${pr.baseBranch}`,
            `headBranch=${pr.headBranch}`,
            `changes=+${pr.additions}/-${pr.deletions} across ${pr.changedFiles} files`,
            `body=${body}`,
            'filesPreview:',
            filesPreview || '-',
            endTag,
            ...(testerFocus ? ['', testerFocus] : []),
        ].join('\n');
    } catch (error) {
        log('WARN', `[${role.toUpperCase()}_PR_FETCH] Failed to fetch PR context for task ${taskId}: ${(error as Error).message}`);
        warnTinyEvent({
            type: fetchFailedType,
            taskId,
            role,
            message: (error as Error).message,
            metadata: {
                source: provider,
                repo: linkage.repo,
                pullRequestNumber: prNumber,
                fallbackUsed: true,
            },
        });
        emitTinyEvent({
            type: fallbackType,
            taskId,
            role,
            metadata: {
                source: provider,
                repo: linkage.repo,
                pullRequestNumber: prNumber,
                fallbackUsed: true,
            },
        });
        return '';
    }
}

export async function applyTaskLinkageCommands(
    taskId: string,
    role: WorkflowRole,
    agentId: string,
    response: string,
    log: (level: string, msg: string) => void,
    deps: TaskLinkageExecutionDeps = DEFAULT_EXECUTION_DEPS,
): Promise<string> {
    const matches = [...response.matchAll(/\[task_linkage\s+([^\]]+)\]/g)];
    if (matches.length === 0) return response;

    for (const m of matches) {
        const attrs = parseAttributes(m[1] || '');
        const action = (attrs.action || '').trim();
        const overwriteUsed = isTruthy(attrs.force) || isTruthy(attrs.allowOverwrite);
        if (!action) {
            log('WARN', `[TASK_LINKAGE] Command rejected (task=${taskId} role=${role} agent=${agentId}): missing action`);
            warnTinyEvent({
                type: 'linkage_command_rejected',
                taskId,
                role,
                agentId,
                message: 'missing action',
                metadata: { reason: 'missing_action' },
            });
            continue;
        }
        log('INFO', `[TASK_LINKAGE] Command received (task=${taskId} role=${role} agent=${agentId}): action='${action}'`);
        emitTinyEvent({
            type: 'linkage_command_received',
            taskId,
            role,
            agentId,
            metadata: { action, overwriteUsed },
        });
        if (overwriteUsed) {
            emitTinyEvent({
                type: 'linkage_command_overwrite_used',
                taskId,
                role,
                agentId,
                metadata: { action, overwriteUsed: true },
            });
        }

        const linkage = deps.getTaskLinkage(taskId);
        if (!linkage) {
            log('WARN', `[TASK_LINKAGE] Command rejected (task=${taskId} role=${role} action=${action}): linkage not found`);
            warnTinyEvent({
                type: 'linkage_command_rejected',
                taskId,
                role,
                agentId,
                metadata: { action, reason: 'linkage_not_found' },
            });
            continue;
        }

        const decision = evaluateTaskLinkageCommand(role, action, attrs, linkage);
        if (!decision.accepted) {
            log('WARN', `[TASK_LINKAGE] Command rejected (task=${taskId} role=${role} action=${action}): ${decision.reason}`);
            warnTinyEvent({
                type: 'linkage_command_rejected',
                taskId,
                role,
                agentId,
                message: decision.reason,
                metadata: { action, reason: decision.reason },
            });
            continue;
        }

        log('INFO', `[TASK_LINKAGE] Command accepted (task=${taskId} role=${role} action=${action})`);
        emitTinyEvent({
            type: 'linkage_command_accepted',
            taskId,
            role,
            agentId,
            metadata: { action, overwriteUsed },
        });
        try {
            if (action === 'attach_linear') {
                deps.attachLinearIssue(taskId, {
                    linearIssueId: attrs.linearIssueId,
                    linearIssueIdentifier: attrs.linearIssueIdentifier,
                    linearIssueUrl: attrs.linearIssueUrl,
                });
            } else if (action === 'create_linear_issue') {
                const issue = await deps.createIssue(attrs.title, attrs.description, attrs.teamId);
                if (issue?.id && issue?.identifier) {
                    deps.attachLinearIssue(taskId, {
                        linearIssueId: issue.id,
                        linearIssueIdentifier: issue.identifier,
                        linearIssueUrl: issue.url,
                    });
                }
            } else if (action === 'attach_git_branch') {
                deps.attachGitBranch(taskId, {
                    gitProvider: attrs.gitProvider || linkage.gitProvider || 'github',
                    repo: attrs.repo || linkage.repo || '',
                    baseBranch: attrs.baseBranch || linkage.baseBranch || '',
                    workingBranch: attrs.workingBranch,
                });
            } else if (action === 'create_git_branch') {
                const repo = attrs.repo || linkage.repo || '';
                const baseBranch = attrs.baseBranch || linkage.baseBranch || '';
                await deps.createBranch(repo, baseBranch, attrs.workingBranch);
                deps.attachGitBranch(taskId, {
                    gitProvider: attrs.gitProvider || linkage.gitProvider || 'github',
                    repo,
                    baseBranch,
                    workingBranch: attrs.workingBranch,
                });
            } else if (action === 'attach_pull_request') {
                const prNumber = parseRequiredPositiveInt(attrs.pullRequestNumber) ?? linkage.pullRequestNumber;
                const prUrl = attrs.pullRequestUrl || linkage.pullRequestUrl || '';
                if (typeof prNumber === 'number') {
                    deps.attachPullRequest(taskId, {
                        pullRequestNumber: prNumber,
                        pullRequestUrl: prUrl,
                    });
                }
            } else if (action === 'create_pull_request') {
                const pr = await deps.createPullRequest(
                    attrs.repo || linkage.repo || '',
                    attrs.title,
                    attrs.description,
                    attrs.headBranch || linkage.workingBranch || '',
                    attrs.baseBranch || linkage.baseBranch || '',
                );
                deps.attachPullRequest(taskId, {
                    pullRequestNumber: pr.number,
                    pullRequestUrl: pr.url,
                });
            }
            log('INFO', `[TASK_LINKAGE] Linkage updated (task=${taskId} role=${role} action=${action})`);
            emitTinyEvent({
                type: 'linkage_command_linkage_updated',
                taskId,
                role,
                agentId,
                metadata: { action },
            });
        } catch (error) {
            log('WARN', `[TASK_LINKAGE] Command execution failed (task=${taskId} role=${role} action=${action}): ${(error as Error).message}`);
            warnTinyEvent({
                type: 'linkage_command_execution_failed',
                taskId,
                role,
                agentId,
                message: (error as Error).message,
                metadata: { action },
            });
        }
    }

    return response.replace(/\[task_linkage\s+[^\]]+\]\s*/g, '').trim();
}
