import { spawn } from 'child_process';
import { CodingWorker, CodingWorkerTaskInput, CodingWorkerTaskResult } from './coder-worker';
import { emitTinyEvent, errorTinyEvent, warnTinyEvent } from '../../lib/observability';

interface CliRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
type WorkerOutputMode = 'structured' | 'summary';

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
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`CODER_WORKER_CLI_ARGS_JSON must be valid JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(parsed) || !parsed.every(v => typeof v === 'string')) {
        throw new Error('CODER_WORKER_CLI_ARGS_JSON must be a JSON array of strings');
    }
    return parsed;
}

function resolveOutputMode(raw?: string): WorkerOutputMode {
    const value = (raw || 'structured').trim().toLowerCase();
    if (value === 'structured' || value === 'summary') return value;
    return 'structured';
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
        let args: string[] = [];
        try {
            args = parseArgsJson(process.env.CODER_WORKER_CLI_ARGS_JSON);
        } catch (error) {
            errorTinyEvent({
                type: 'worker_args_config_invalid',
                taskId: input.taskId,
                agentId: 'coder',
                role: 'coder',
                message: (error as Error).message,
                metadata: {
                    workerMode: this.name,
                    rawArgsJson: process.env.CODER_WORKER_CLI_ARGS_JSON || '',
                },
            });
            throw error;
        }
        const timeoutMs = parsePositiveInt(process.env.CODER_WORKER_TIMEOUT_MS, 60000);
        const maxRetries = parsePositiveInt(process.env.CODER_WORKER_MAX_RETRIES, 0);
        const rawOutputMode = process.env.CODER_WORKER_OUTPUT_MODE;
        const outputMode = resolveOutputMode(rawOutputMode);
        if (rawOutputMode && outputMode !== rawOutputMode.trim().toLowerCase()) {
            warnTinyEvent({
                type: 'worker_output_mode_invalid',
                taskId: input.taskId,
                agentId: 'coder',
                role: 'coder',
                message: `Invalid CODER_WORKER_OUTPUT_MODE='${rawOutputMode}', defaulting to 'structured'`,
                metadata: { workerMode: this.name, configuredOutputMode: rawOutputMode },
            });
        }
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
                outputMode,
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

        const trimmed = out.stdout.trim();
        if (outputMode === 'summary') {
            let parsed: Record<string, unknown> | null = null;
            try {
                parsed = JSON.parse(trimmed) as Record<string, unknown>;
            } catch {
                parsed = null;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                const result = {
                    summary: trimmed || 'Coder worker executed via cursor_cli.',
                    notes: 'cursor_cli returned summary-mode plain text output.',
                    raw: { stdout: out.stdout },
                };
                emitTinyEvent({
                    type: 'worker_succeeded',
                    taskId: input.taskId,
                    agentId: 'coder',
                    role: 'coder',
                    metadata: {
                        workerMode: this.name,
                        outputMode,
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
                        outputMode,
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
                        outputMode,
                        repo: input.repo,
                        workingBranch: input.workingBranch,
                    },
                });
                throw new Error(`cursor_cli output validation failed: ${(error as Error).message}`);
            }
        }

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch (error) {
            errorTinyEvent({
                type: 'worker_output_parse_failed',
                taskId: input.taskId,
                agentId: 'coder',
                role: 'coder',
                message: (error as Error).message,
                metadata: {
                    workerMode: this.name,
                    outputMode,
                    stdoutPreview: trimmed.slice(0, 160),
                },
            });
            throw new Error(
                'cursor_cli structured output must be a single JSON object on stdout. ' +
                'Use stderr for logs or set CODER_WORKER_OUTPUT_MODE=summary for plain text output.',
            );
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            errorTinyEvent({
                type: 'worker_output_parse_failed',
                taskId: input.taskId,
                agentId: 'coder',
                role: 'coder',
                message: 'Structured output is not a JSON object',
                metadata: {
                    workerMode: this.name,
                    outputMode,
                },
            });
            throw new Error('cursor_cli structured output must be a JSON object.');
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
                    outputMode,
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
                    outputMode,
                    repo: input.repo,
                    workingBranch: input.workingBranch,
                },
            });
            throw new Error(`cursor_cli output validation failed: ${(error as Error).message}`);
        }
    }
}
