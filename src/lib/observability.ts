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

function normalizeTinyEvent(event: TinyEvent): TinyEvent {
    return {
        ...event,
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
