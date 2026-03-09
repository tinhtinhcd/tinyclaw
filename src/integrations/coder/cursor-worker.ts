import { CodingWorker, CodingWorkerTaskInput, CodingWorkerTaskResult } from './coder-worker';

function buildSuggestedBranch(taskId: string): string {
    const suffix = taskId.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 24);
    return `feature/${suffix || 'task-update'}`;
}

export class CursorCodingWorker implements CodingWorker {
    name = 'cursor_handoff';

    async runTask(input: CodingWorkerTaskInput): Promise<CodingWorkerTaskResult> {
        const branch = input.workingBranch || buildSuggestedBranch(input.taskId);
        const summaryLines = [
            `Coder work delegated via ${this.name}.`,
            `Task: ${input.taskId}`,
            `Repo: ${input.repo || '(missing repo linkage)'}`,
            `Base: ${input.baseBranch || '(missing base branch linkage)'}`,
            `Working branch: ${branch}`,
            input.linearIssueIdentifier ? `Linear: ${input.linearIssueIdentifier}` : 'Linear: (not linked)',
            '',
            'Handoff package prepared for Cursor execution.',
        ];

        return {
            summary: summaryLines.join('\n'),
            branch,
            notes: 'MVP delegation mode: structured handoff only; real Cursor automation can replace this worker later.',
            raw: {
                worker: this.name,
                input,
            },
        };
    }
}
