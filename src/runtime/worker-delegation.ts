import { AgentConfig, TeamConfig } from '../lib/types';
import { invokeAgent } from '../lib/invoke';
import { getTaskLinkage, attachGitBranch, attachPullRequest } from '../lib/task-linkage';
import { getCodingWorker } from '../integrations/coder/coder-worker';
import { WorkflowRole } from '../lib/task-linkage-workflow';
import { emitTinyEvent } from '../lib/observability';

export async function runWorkerOrInvokeAgent(params: {
    role: WorkflowRole;
    linkedTaskId?: string;
    messageData: { sourceMetadata?: Record<string, unknown> };
    message: string;
    agent: AgentConfig;
    agentId: string;
    workspacePath: string;
    shouldReset: boolean;
    agents: Record<string, AgentConfig>;
    teams: Record<string, TeamConfig>;
    invokeAgentFn?: typeof invokeAgent;
    log: (level: string, msg: string) => void;
}): Promise<string> {
    const {
        role, linkedTaskId, messageData, message, agent, agentId, workspacePath, shouldReset, agents, teams, log,
    } = params;
    const invokeAgentFn = params.invokeAgentFn || invokeAgent;
    const worker = role === 'coder' ? getCodingWorker() : null;
    if (worker && linkedTaskId) {
        emitTinyEvent({
            type: 'worker_mode_selected',
            taskId: linkedTaskId,
            agentId,
            role,
            metadata: { workerMode: worker.name },
        });
        const linkage = getTaskLinkage(linkedTaskId);
        const md = messageData.sourceMetadata || {};
        const slackChannelId = typeof md.channelId === 'string' ? md.channelId : undefined;
        const slackThreadTs = typeof md.threadTs === 'string' ? md.threadTs : undefined;
        log('INFO', `[CODER_WORKER] Delegating coder task ${linkedTaskId} to worker '${worker.name}'`);
        const workerResult = await worker.runTask({
            taskId: linkedTaskId,
            repo: linkage?.repo,
            baseBranch: linkage?.baseBranch,
            workingBranch: linkage?.workingBranch,
            linearIssueIdentifier: linkage?.linearIssueIdentifier,
            prompt: message,
            slackChannelId,
            slackThreadTs,
        });

        if (workerResult.branch && linkage?.repo && linkage?.baseBranch) {
            attachGitBranch(linkedTaskId, {
                gitProvider: linkage.gitProvider || 'github',
                repo: linkage.repo,
                baseBranch: linkage.baseBranch,
                workingBranch: workerResult.branch,
            });
            emitTinyEvent({
                type: 'worker_branch_attached',
                taskId: linkedTaskId,
                agentId,
                role,
                metadata: {
                    workerMode: worker.name,
                    repo: linkage.repo,
                    baseBranch: linkage.baseBranch,
                    workingBranch: workerResult.branch,
                },
            });
        }

        if (
            typeof workerResult.pullRequestNumber === 'number'
            && workerResult.pullRequestUrl
        ) {
            attachPullRequest(linkedTaskId, {
                pullRequestNumber: workerResult.pullRequestNumber,
                pullRequestUrl: workerResult.pullRequestUrl,
            });
            emitTinyEvent({
                type: 'worker_pull_request_attached',
                taskId: linkedTaskId,
                agentId,
                role,
                metadata: {
                    workerMode: worker.name,
                    pullRequestNumber: workerResult.pullRequestNumber,
                    pullRequestUrl: workerResult.pullRequestUrl,
                },
            });
        }

        log('INFO', `[CODER_WORKER] Delegation complete for task ${linkedTaskId}`);
        return workerResult.summary;
    }

    return invokeAgentFn(agent, agentId, message, workspacePath, shouldReset, agents, teams);
}

