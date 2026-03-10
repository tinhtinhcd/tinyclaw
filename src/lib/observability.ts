import { emitEvent, log } from './logging';

export interface TinyEvent {
    type: string;
    taskId?: string;
    conversationId?: string;
    agentId?: string;
    teamId?: string;
    role?: string;
    source?: string;
    status?: string;
    message?: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
}

const EVENT_TYPE_NORMALIZATION: Record<string, string> = {
    worker_mode_selected: 'worker.mode_selected',
    worker_started: 'worker.started',
    worker_succeeded: 'worker.succeeded',
    worker_failed: 'worker.failed',
    worker_timeout: 'worker.timeout',
    worker_retry: 'worker.retry',
    worker_validation_failed: 'worker.validation_failed',
    worker_output_parse_failed: 'worker.output_parse_failed',
    worker_args_config_invalid: 'worker.args_config_invalid',
    worker_output_mode_invalid: 'worker.output_mode_invalid',
    worker_branch_attached: 'worker.branch_attached',
    worker_pull_request_attached: 'worker.pr_attached',

    linkage_created: 'linkage.created',
    linkage_resolved_slack_thread: 'linkage.resolved_slack_thread',
    linkage_linear_attached: 'linkage.linear_attached',
    linkage_git_branch_attached: 'linkage.branch_attached',
    linkage_pull_request_attached: 'linkage.pr_attached',
    linkage_owner_changed: 'linkage.owner_changed',
    linkage_status_changed: 'linkage.status_changed',

    linkage_command_received: 'command_validation.received',
    linkage_command_accepted: 'command_validation.accepted',
    linkage_command_rejected: 'command_validation.rejected',
    linkage_command_execution_failed: 'command_validation.execution_failed',
    linkage_command_linkage_updated: 'command_validation.linkage_updated',
    linkage_command_overwrite_used: 'command_validation.overwrite_used',

    reviewer_pr_fetch_started: 'review_fetch.started',
    reviewer_pr_fetch_succeeded: 'review_fetch.succeeded',
    reviewer_pr_fetch_failed: 'review_fetch.failed',
    reviewer_pr_fetch_fallback_linkage: 'review_fetch.fallback_linkage',
    tester_pr_fetch_started: 'review_fetch.started',
    tester_pr_fetch_succeeded: 'review_fetch.succeeded',
    tester_pr_fetch_failed: 'review_fetch.failed',
    tester_pr_fetch_fallback_linkage: 'review_fetch.fallback_linkage',

    tester_focus_generated: 'tester_focus.generated',
    tester_focus_skipped: 'tester_focus.skipped',

    workflow_role_heuristic_fallback: 'role_detect.heuristic_fallback',
    workflow_role_invalid_explicit: 'role_detect.invalid_explicit',

    context_budget_truncation: 'context_budget.truncation',
    context_block_dropped: 'context_budget.block_dropped',
    context_budget_applied: 'context_budget.applied',
};

function normalizeEventType(type: string): string {
    return EVENT_TYPE_NORMALIZATION[type] || type;
}

function normalizeTinyEvent(event: TinyEvent): TinyEvent {
    const type = normalizeEventType(event.type);
    return {
        ...event,
        type,
        timestamp: event.timestamp || new Date().toISOString(),
        metadata: event.metadata || {},
    };
}

function dispatch(level: 'INFO' | 'WARN' | 'ERROR', event: TinyEvent): void {
    const normalized = normalizeTinyEvent(event);
    const label = `[OBS][${normalized.type}]`;
    const taskLabel = normalized.taskId ? ` task=${normalized.taskId}` : '';
    const roleLabel = normalized.role ? ` role=${normalized.role}` : '';
    const msg = normalized.message ? ` ${normalized.message}` : '';
    try {
        log(level, `${label}${taskLabel}${roleLabel}${msg}`);
    } catch {
        // Ignore console/file logging errors for runtime safety.
    }
    try {
        emitEvent(normalized.type, normalized as unknown as Record<string, unknown>);
    } catch {
        // Ignore event listener failures for runtime safety.
    }
}

export function emitTinyEvent(event: TinyEvent): void {
    dispatch('INFO', event);
}

export function warnTinyEvent(event: TinyEvent): void {
    dispatch('WARN', event);
}

export function errorTinyEvent(event: TinyEvent): void {
    dispatch('ERROR', event);
}
