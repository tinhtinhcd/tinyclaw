import { CursorCodingWorker } from './cursor-worker';
import { CursorCliCodingWorker } from './cli-worker';

export interface CodingWorkerTaskInput {
    taskId: string;
    repo?: string;
    baseBranch?: string;
    workingBranch?: string;
    linearIssueIdentifier?: string;
    prompt: string;
    acceptanceCriteria?: string[];
    slackChannelId?: string;
    slackThreadTs?: string;
}

export interface CodingWorkerTaskResult {
    summary: string;
    branch?: string;
    pullRequestUrl?: string;
    pullRequestNumber?: number;
    notes?: string;
    raw?: unknown;
}

export interface CodingWorker {
    name: string;
    runTask(input: CodingWorkerTaskInput): Promise<CodingWorkerTaskResult>;
}

export function getCodingWorker(): CodingWorker | null {
    const mode = (process.env.CODER_WORKER_MODE || '').trim().toLowerCase();
    if (!mode || mode === 'off' || mode === 'disabled' || mode === 'none') {
        return null;
    }
    if (mode === 'cursor_handoff') {
        return new CursorCodingWorker();
    }
    if (mode === 'cursor_cli' || mode === 'external_worker') {
        return new CursorCliCodingWorker();
    }
    return null;
}
