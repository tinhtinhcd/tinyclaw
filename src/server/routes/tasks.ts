import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { Task, TaskStatus } from '../../lib/types';
import { TINYCLAW_HOME } from '../../lib/config';
import { log } from '../../lib/logging';
import {
    attachGitBranch,
    attachLinearIssue,
    attachPullRequest,
    getTaskLinkage,
    getTaskLinkageBySlackThread,
    setTaskOwner,
    setTaskStatus,
    updateTaskLinkage,
} from '../../lib/task-linkage';

const TASKS_FILE = path.join(TINYCLAW_HOME, 'tasks.json');

function readTasks(): Task[] {
    try {
        if (!fs.existsSync(TASKS_FILE)) return [];
        return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function writeTasks(tasks: Task[]): void {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2) + '\n');
}

const app = new Hono();

// GET /api/tasks
app.get('/api/tasks', (c) => {
    return c.json(readTasks());
});

// POST /api/tasks
app.post('/api/tasks', async (c) => {
    const body = await c.req.json() as Partial<Task>;
    if (!body.title) {
        return c.json({ error: 'title is required' }, 400);
    }
    const tasks = readTasks();
    const task: Task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: body.title,
        description: body.description || '',
        status: body.status || 'backlog',
        assignee: body.assignee || '',
        assigneeType: body.assigneeType || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    tasks.push(task);
    writeTasks(tasks);
    log('INFO', `[API] Task created: ${task.title}`);
    return c.json({ ok: true, task });
});

// PUT /api/tasks/reorder — must be before /api/tasks/:id
app.put('/api/tasks/reorder', async (c) => {
    const body = await c.req.json() as { columns: Record<string, string[]> };
    if (!body.columns) {
        return c.json({ error: 'columns map is required' }, 400);
    }
    const tasks = readTasks();
    for (const [status, taskIds] of Object.entries(body.columns)) {
        for (const taskId of taskIds) {
            const task = tasks.find(t => t.id === taskId);
            if (task) {
                task.status = status as TaskStatus;
                if (task.linkage) task.linkage.status = task.status;
                task.updatedAt = Date.now();
            }
        }
    }
    writeTasks(tasks);
    return c.json({ ok: true });
});

// PUT /api/tasks/:id
app.put('/api/tasks/:id', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as Partial<Task>;
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return c.json({ error: 'task not found' }, 404);
    tasks[idx] = { ...tasks[idx], ...body, id: taskId, updatedAt: Date.now() };
    if (tasks[idx].linkage) {
        if (tasks[idx].status) tasks[idx].linkage!.status = tasks[idx].status;
        if (tasks[idx].assigneeType === 'agent') {
            tasks[idx].linkage!.currentOwnerAgentId = tasks[idx].assignee;
        }
    }
    writeTasks(tasks);
    log('INFO', `[API] Task updated: ${taskId}`);
    return c.json({ ok: true, task: tasks[idx] });
});

// GET /api/tasks/:id/linkage
app.get('/api/tasks/:id/linkage', (c) => {
    const taskId = c.req.param('id');
    const linkage = getTaskLinkage(taskId);
    if (!linkage) return c.json({ error: 'task linkage not found' }, 404);
    return c.json(linkage);
});

// GET /api/tasks/by-thread?channelId=...&threadTs=...
app.get('/api/tasks/by-thread', (c) => {
    const channelId = c.req.query('channelId');
    const threadTs = c.req.query('threadTs');
    if (!channelId || !threadTs) {
        return c.json({ error: 'channelId and threadTs are required' }, 400);
    }
    const linkage = getTaskLinkageBySlackThread(channelId, threadTs);
    if (!linkage) return c.json({ error: 'task linkage not found' }, 404);
    return c.json(linkage);
});

// PATCH /api/tasks/:id/linkage
app.patch('/api/tasks/:id/linkage', async (c) => {
    try {
        const taskId = c.req.param('id');
        const body = await c.req.json() as Record<string, unknown>;
        const linkage = updateTaskLinkage(taskId, body);
        return c.json({ ok: true, linkage });
    } catch (error) {
        return c.json({ error: (error as Error).message }, 404);
    }
});

// POST /api/tasks/:id/linkage/linear
app.post('/api/tasks/:id/linkage/linear', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as {
        linearIssueId?: string;
        linearIssueIdentifier?: string;
        linearIssueUrl?: string;
    };
    if (!body.linearIssueId || !body.linearIssueIdentifier) {
        return c.json({ error: 'linearIssueId and linearIssueIdentifier are required' }, 400);
    }
    try {
        const linkage = attachLinearIssue(taskId, {
            linearIssueId: body.linearIssueId,
            linearIssueIdentifier: body.linearIssueIdentifier,
            linearIssueUrl: body.linearIssueUrl,
        });
        return c.json({ ok: true, linkage });
    } catch (error) {
        return c.json({ error: (error as Error).message }, 404);
    }
});

// POST /api/tasks/:id/linkage/git-branch
app.post('/api/tasks/:id/linkage/git-branch', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as {
        gitProvider?: string;
        repo?: string;
        baseBranch?: string;
        workingBranch?: string;
    };
    if (!body.gitProvider || !body.repo || !body.baseBranch || !body.workingBranch) {
        return c.json({ error: 'gitProvider, repo, baseBranch, and workingBranch are required' }, 400);
    }
    try {
        const linkage = attachGitBranch(taskId, {
            gitProvider: body.gitProvider,
            repo: body.repo,
            baseBranch: body.baseBranch,
            workingBranch: body.workingBranch,
        });
        return c.json({ ok: true, linkage });
    } catch (error) {
        return c.json({ error: (error as Error).message }, 404);
    }
});

// POST /api/tasks/:id/linkage/pull-request
app.post('/api/tasks/:id/linkage/pull-request', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as {
        pullRequestNumber?: number;
        pullRequestUrl?: string;
    };
    if (typeof body.pullRequestNumber !== 'number' || !body.pullRequestUrl) {
        return c.json({ error: 'pullRequestNumber and pullRequestUrl are required' }, 400);
    }
    try {
        const linkage = attachPullRequest(taskId, {
            pullRequestNumber: body.pullRequestNumber,
            pullRequestUrl: body.pullRequestUrl,
        });
        return c.json({ ok: true, linkage });
    } catch (error) {
        return c.json({ error: (error as Error).message }, 404);
    }
});

// POST /api/tasks/:id/linkage/owner
app.post('/api/tasks/:id/linkage/owner', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as { agentId?: string };
    if (!body.agentId) return c.json({ error: 'agentId is required' }, 400);
    try {
        const linkage = setTaskOwner(taskId, body.agentId);
        return c.json({ ok: true, linkage });
    } catch (error) {
        return c.json({ error: (error as Error).message }, 404);
    }
});

// POST /api/tasks/:id/linkage/status
app.post('/api/tasks/:id/linkage/status', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json() as { status?: TaskStatus };
    if (!body.status) return c.json({ error: 'status is required' }, 400);
    try {
        const linkage = setTaskStatus(taskId, body.status);
        return c.json({ ok: true, linkage });
    } catch (error) {
        return c.json({ error: (error as Error).message }, 404);
    }
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', (c) => {
    const taskId = c.req.param('id');
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return c.json({ error: 'task not found' }, 404);
    tasks.splice(idx, 1);
    writeTasks(tasks);
    log('INFO', `[API] Task deleted: ${taskId}`);
    return c.json({ ok: true });
});

export default app;
