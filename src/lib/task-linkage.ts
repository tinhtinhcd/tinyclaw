import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';
import { log } from './logging';
import { emitTinyEvent } from './observability';
import { Task, TaskLinkage, TaskStatus } from './types';

const TASKS_FILE = path.join(TINYCLAW_HOME, 'tasks.json');

function readTasks(): Task[] {
    try {
        if (!fs.existsSync(TASKS_FILE)) return [];
        return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')) as Task[];
    } catch {
        return [];
    }
}

function writeTasks(tasks: Task[]): void {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2) + '\n');
}

function ensureTaskLinkage(task: Task): TaskLinkage {
    if (!task.linkage) {
        task.linkage = {
            taskId: task.id,
            status: task.status,
        };
    }
    if (!task.linkage.taskId) task.linkage.taskId = task.id;
    return task.linkage;
}

function updateTask(taskId: string, mutate: (task: Task) => void): Task {
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx < 0) throw new Error(`Task '${taskId}' not found`);
    const task = tasks[idx]!;
    mutate(task);
    task.updatedAt = Date.now();
    tasks[idx] = task;
    writeTasks(tasks);
    return task;
}

export function createTaskLinkage(input: {
    title: string;
    description?: string;
    slackChannelId?: string;
    slackThreadTs?: string;
    currentOwnerAgentId?: string;
    status?: TaskStatus;
}): Task {
    if (input.slackChannelId && input.slackThreadTs) {
        const existing = getTaskLinkageBySlackThread(input.slackChannelId, input.slackThreadTs);
        if (existing) {
            return getTaskById(existing.taskId)!;
        }
    }

    const now = Date.now();
    const task: Task = {
        id: `task_${now}_${Math.random().toString(36).slice(2, 6)}`,
        title: input.title,
        description: input.description || '',
        status: input.status || 'backlog',
        assignee: input.currentOwnerAgentId || '',
        assigneeType: input.currentOwnerAgentId ? 'agent' : '',
        createdAt: now,
        updatedAt: now,
        linkage: {
            taskId: '',
            slackChannelId: input.slackChannelId,
            slackThreadTs: input.slackThreadTs,
            currentOwnerAgentId: input.currentOwnerAgentId,
            status: input.status || 'backlog',
        },
    };
    task.linkage!.taskId = task.id;

    const tasks = readTasks();
    tasks.push(task);
    writeTasks(tasks);
    log('INFO', `[TASK_LINKAGE] Created linkage task ${task.id} (slack:${input.slackChannelId || '-'}:${input.slackThreadTs || '-'})`);
    emitTinyEvent({
        type: 'linkage_created',
        taskId: task.id,
        status: task.status,
        metadata: {
            slackChannelId: input.slackChannelId,
            slackThreadTs: input.slackThreadTs,
            owner: input.currentOwnerAgentId,
        },
    });
    return task;
}

export function getTaskById(taskId: string): Task | null {
    return readTasks().find(t => t.id === taskId) || null;
}

export function getTaskLinkage(taskId: string): TaskLinkage | null {
    const task = getTaskById(taskId);
    if (!task) return null;
    return task.linkage || null;
}

export function getTaskLinkageBySlackThread(channelId: string, threadTs: string): TaskLinkage | null {
    const task = readTasks().find(t => t.linkage?.slackChannelId === channelId && t.linkage?.slackThreadTs === threadTs);
    return task?.linkage || null;
}

export function updateTaskLinkage(taskId: string, patch: Partial<TaskLinkage>): TaskLinkage {
    const task = updateTask(taskId, t => {
        const linkage = ensureTaskLinkage(t);
        Object.assign(linkage, patch);
        linkage.taskId = t.id;
    });
    log('INFO', `[TASK_LINKAGE] Updated linkage for ${taskId}`);
    return task.linkage!;
}

export function attachLinearIssue(
    taskId: string,
    params: { linearIssueId: string; linearIssueIdentifier: string; linearIssueUrl?: string },
): TaskLinkage {
    const linkage = updateTaskLinkage(taskId, {
        linearIssueId: params.linearIssueId,
        linearIssueIdentifier: params.linearIssueIdentifier,
        linearIssueUrl: params.linearIssueUrl,
    });
    log('INFO', `[TASK_LINKAGE] Attached Linear issue ${params.linearIssueIdentifier} to ${taskId}`);
    emitTinyEvent({
        type: 'linkage_linear_attached',
        taskId,
        metadata: {
            linearIssueId: params.linearIssueId,
            linearIssueIdentifier: params.linearIssueIdentifier,
            linearIssueUrl: params.linearIssueUrl,
        },
    });
    return linkage;
}

export function attachGitBranch(
    taskId: string,
    params: { gitProvider: string; repo: string; baseBranch: string; workingBranch: string },
): TaskLinkage {
    const linkage = updateTaskLinkage(taskId, {
        gitProvider: params.gitProvider,
        repo: params.repo,
        baseBranch: params.baseBranch,
        workingBranch: params.workingBranch,
    });
    log('INFO', `[TASK_LINKAGE] Attached git branch ${params.repo}:${params.workingBranch} to ${taskId}`);
    emitTinyEvent({
        type: 'linkage_git_branch_attached',
        taskId,
        metadata: {
            gitProvider: params.gitProvider,
            repo: params.repo,
            baseBranch: params.baseBranch,
            workingBranch: params.workingBranch,
        },
    });
    return linkage;
}

export function attachPullRequest(
    taskId: string,
    params: { pullRequestNumber: number; pullRequestUrl: string },
): TaskLinkage {
    const linkage = updateTaskLinkage(taskId, {
        pullRequestNumber: params.pullRequestNumber,
        pullRequestUrl: params.pullRequestUrl,
    });
    log('INFO', `[TASK_LINKAGE] Attached PR #${params.pullRequestNumber} to ${taskId}`);
    emitTinyEvent({
        type: 'linkage_pull_request_attached',
        taskId,
        metadata: {
            pullRequestNumber: params.pullRequestNumber,
            pullRequestUrl: params.pullRequestUrl,
        },
    });
    return linkage;
}

export function setTaskOwner(taskId: string, agentId: string): TaskLinkage {
    const task = updateTask(taskId, t => {
        t.assignee = agentId;
        t.assigneeType = 'agent';
        const linkage = ensureTaskLinkage(t);
        linkage.currentOwnerAgentId = agentId;
    });
    log('INFO', `[TASK_LINKAGE] Owner changed for ${taskId}: ${agentId}`);
    emitTinyEvent({
        type: 'linkage_owner_changed',
        taskId,
        agentId,
        metadata: { owner: agentId },
    });
    return task.linkage!;
}

export function setTaskStatus(taskId: string, status: TaskStatus): TaskLinkage {
    const task = updateTask(taskId, t => {
        t.status = status;
        const linkage = ensureTaskLinkage(t);
        linkage.status = status;
    });
    log('INFO', `[TASK_LINKAGE] Status changed for ${taskId}: ${status}`);
    emitTinyEvent({
        type: 'linkage_status_changed',
        taskId,
        status,
        metadata: { status },
    });
    return task.linkage!;
}
