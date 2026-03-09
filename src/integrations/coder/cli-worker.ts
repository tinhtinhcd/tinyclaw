import { spawn } from 'child_process';
import { CodingWorker, CodingWorkerTaskInput, CodingWorkerTaskResult } from './coder-worker';
import { emitTinyEvent, errorTinyEvent, warnTinyEvent } from '../../lib/observability';

interface CliRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

class WorkerExecutionError extends Error {
    constructor(
        message: string,
        public readonly retryable: boolean,
        public readonly reason: 'timeout' | 'spawn' | 'exit' | 'unknown' = 'unknown',
    ) {
        super(message);
    }
}

function parseArgsJson(value?: string): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
            return parsed;
        }
    } catch {
        // ignore malformed JSON
    }
    return [];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
    return n;
}

function runCli(command: string, args: string[], input: string, timeoutMs: number): Promise<CliRunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'pipe' });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new WorkerExecutionError(`cursor_cli timed out after ${timeoutMs}ms`, true, 'timeout'));
        }, timeoutMs);

        child.stdout.on('data', (buf: Buffer) => {
            stdout += buf.toString();
        });
        child.stderr.on('data', (buf: Buffer) => {
            stderr += buf.toString();
        });
        child.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new WorkerExecutionError(`cursor_cli spawn error: ${err.message}`, true, 'spawn'));
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                exitCode: code ?? -1,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
            });
        });

        child.stdin.write(input);
        child.stdin.end();
    });
}

function toOptionalString(value: unknown, fieldName: string): string | undefined {
    if (typeof value === 'undefined') return undefined;
    if (typeof value !== 'string') {
        throw new Error(`field '${fieldName}' must be a string when present`);
    }
    return value;
}

function toOptionalPrNumber(value: unknown): number | undefined {
    if (typeof value === 'undefined') return undefined;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed)) {
            return parsed;
        }
    }
    throw new Error("field 'pullRequestNumber' must be a positive integer or numeric string when present");
}

function normalizeResult(raw: Record<string, unknown>, fallbackSummary: string): CodingWorkerTaskResult {
    const summary = typeof raw.summary === 'undefined'
        ? fallbackSummary
        : toOptionalString(raw.summary, 'summary') || fallbackSummary;
    const branch = toOptionalString(raw.branch, 'branch');
    const pullRequestUrl = toOptionalString(raw.pullRequestUrl, 'pullRequestUrl');
    const pullRequestNumber = toOptionalPrNumber(raw.pullRequestNumber);
    const notes = toOptionalString(raw.notes, 'notes');

    return {
        summary,
        branch,
        pullRequestUrl,
        pullRequestNumber,
        notes,
        raw,
    };
}

export class CursorCliCodingWorker implements CodingWorker {
    name = 'cursor_cli';

    async runTask(input: CodingWorkerTaskInput): Promise<CodingWorkerTaskResult> {
        const command = process.env.CODER_WORKER_CLI_CMD || 'cursor';
        const args = parseArgsJson(process.env.CODER_WORKER_CLI_ARGS_JSON);
        const timeoutMs = parsePositiveInt(process.env.CODER_WORKER_TIMEOUT_MS, 60000);
        const maxRetries = parsePositiveInt(process.env.CODER_WORKER_MAX_RETRIES, 0);
        const payload = JSON.stringify({
            taskId: input.taskId,
            repo: input.repo,
            baseBranch: input.baseBranch,
            workingBranch: input.workingBranch,
            linearIssueIdentifier: input.linearIssueIdentifier,
            prompt: input.prompt,
            acceptanceCriteria: input.acceptanceCriteria || [],
            slackChannelId: input.slackChannelId,
            slackThreadTs: input.slackThreadTs,
        });
        emitTinyEvent({
            type: 'worker_started',
            taskId: input.taskId,
            agentId: 'coder',
            role: 'coder',
            metadata: {
                workerMode: this.name,
                timeoutMs,
                maxRetries,
                repo: input.repo,
                baseBranch: input.baseBranch,
                workingBranch: input.workingBranch,
            },
        });

        let out: CliRunResult | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                out = await runCli(command, args, payload, timeoutMs);
                if (out.exitCode !== 0) {
                    throw new WorkerExecutionError(
                        `cursor_cli failed (exit=${out.exitCode}): ${out.stderr || out.stdout || 'no output'}`,
                        true,
                        'exit',
                    );
                }
                break;
            } catch (error) {
                const err = error as Error;
                const retryable = error instanceof WorkerExecutionError ? error.retryable : true;
                const reason = error instanceof WorkerExecutionError ? error.reason : 'unknown';
                if (reason === 'timeout') {
                    errorTinyEvent({
                        type: 'worker_timeout',
                        taskId: input.taskId,
                        agentId: 'coder',
                        role: 'coder',
                        message: err.message,
                        metadata: {
                            workerMode: this.name,
                            timeoutMs,
                            retryAttempt: attempt,
                            maxRetries,
                            repo: input.repo,
                            workingBranch: input.workingBranch,
                        },
                    });
                }
                if (attempt < maxRetries && retryable) {
                    warnTinyEvent({
                        type: 'worker_retry',
                        taskId: input.taskId,
                        agentId: 'coder',
                        role: 'coder',
                        message: err.message,
                        metadata: {
                            workerMode: this.name,
                            timeoutMs,
                            retryAttempt: attempt + 1,
                            maxRetries,
                            repo: input.repo,
                            workingBranch: input.workingBranch,
                        },
                    });
                    continue;
                }
                errorTinyEvent({
                    type: 'worker_failed',
                    taskId: input.taskId,
                    agentId: 'coder',
                    role: 'coder',
                    message: err.message,
                    metadata: {
                        workerMode: this.name,
                        timeoutMs,
                        retryAttempt: attempt,
                        maxRetries,
                        repo: input.repo,
                        workingBranch: input.workingBranch,
                    },
                });
                throw err;
            }
        }
        if (!out) throw new Error('cursor_cli failed without output');

        // Expected output is JSON; fallback to plain-text summary only when output is not JSON.
        let parsed: Record<string, unknown> | null = null;
        try {
            parsed = JSON.parse(out.stdout) as Record<string, unknown>;
        } catch {
            // keep null; treat as non-JSON summary-only output
        }

        if (!parsed) {
            const result = {
                summary: out.stdout || 'Coder worker executed via cursor_cli.',
                notes: 'cursor_cli returned non-JSON output; treated as summary only.',
                raw: { stdout: out.stdout },
            };
            emitTinyEvent({
                type: 'worker_succeeded',
                taskId: input.taskId,
                agentId: 'coder',
                role: 'coder',
                metadata: {
                    workerMode: this.name,
                    summaryOnly: true,
                    repo: input.repo,
                    workingBranch: input.workingBranch,
                },
            });
            return result;
        }

        try {
            const normalized = normalizeResult(parsed, 'Coder worker executed via cursor_cli.');
            emitTinyEvent({
                type: 'worker_succeeded',
                taskId: input.taskId,
                agentId: 'coder',
                role: 'coder',
                metadata: {
                    workerMode: this.name,
                    repo: input.repo,
                    workingBranch: normalized.branch || input.workingBranch,
                    pullRequestNumber: normalized.pullRequestNumber,
                },
            });
            return normalized;
        } catch (error) {
            errorTinyEvent({
                type: 'worker_validation_failed',
                taskId: input.taskId,
                agentId: 'coder',
                role: 'coder',
                message: (error as Error).message,
                metadata: {
                    workerMode: this.name,
                    repo: input.repo,
                    workingBranch: input.workingBranch,
                },
            });
            throw new Error(`cursor_cli output validation failed: ${(error as Error).message}`);
        }
    }
}
