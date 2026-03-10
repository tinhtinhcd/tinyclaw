const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-team-chain-test-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: {
        path: process.cwd(),
        name: 'tinyclaw-team-chain-test',
    },
    agents: {
        pm: {
            name: 'PM',
            role: 'pm',
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: 'pm',
        },
        coder: {
            name: 'Coder',
            role: 'coder',
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: 'coder',
        },
    },
    teams: {
        dev: {
            name: 'Dev Team',
            agents: ['pm', 'coder'],
            leader_agent: 'pm',
        },
    },
}, null, 2));

const { initQueueDb, claimAllPendingMessages, getPendingAgents, getResponsesForChannel, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');
const { onEvent } = require('../dist/lib/logging.js');
const {
    getTaskLinkageBySlackThread,
    getTaskLinkage,
    attachLinearIssue,
    attachGitBranch,
    attachPullRequest,
} = require('../dist/lib/task-linkage.js');

function passthroughIncoming(text) {
    return Promise.resolve({ text });
}

function passthroughOutgoing(text) {
    return Promise.resolve({ text, metadata: {} });
}

function buildSlackDbMessage(id, messageId, agent, text, channelId = 'C-team', threadTs = 'T-team') {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-team',
        sender_id: 'U-team',
        message: text,
        agent,
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-team',
            messageTs: String(Date.now()),
        }),
        status: 'pending',
        retry_count: 0,
        last_error: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        claimed_by: null,
    };
}

initQueueDb();

test('PM -> Coder handoff keeps same linkage/task and final metadata is correct', async () => {
    const prompts = { pm: '', coder: '' };
    let createBranchArgs = null;
    const events = [];
    onEvent((type, data) => events.push({ type, data }));

    const invokeAgentFn = async (_agent, agentId, prompt) => {
        if (agentId === 'pm') {
            prompts.pm = prompt;
            return [
                'PM plan ready.',
                '[@coder: Please implement parser fix.]',
            ].join('\n');
        }
        prompts.coder = prompt;
        return [
            'Coder implemented parser fix.',
            '[task_linkage action="create_git_branch" workingBranch="feature/parser-fix"]',
        ].join('\n');
    };

    const deps = {
        getTaskLinkage,
        attachLinearIssue,
        attachGitBranch,
        attachPullRequest,
        createIssue: async () => ({
            id: 'lin_unused',
            identifier: 'ENG-unused',
            url: 'https://linear.app/acme/issue/ENG-unused',
        }),
        createBranch: async (repo, baseBranch, workingBranch) => {
            createBranchArgs = { repo, baseBranch, workingBranch };
            return { ref: `refs/heads/${workingBranch}`, sha: 'abc' };
        },
        createPullRequest: async () => ({ number: 99, url: 'https://example.com/pr/99', state: 'open' }),
    };

    // Seed linkage base git data so coder can derive repo/base for create_git_branch.
    // Use a non-colliding synthetic DB row id so dbCompleteMessage() won't touch newly enqueued internal rows.
    const pmMsg = buildSlackDbMessage(9999, 'msg_team_pm_1', 'pm', 'Please coordinate with dev team');
    await processMessageForTest(pmMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        taskLinkageExecutionDeps: deps,
    });

    const linkageAfterPm = getTaskLinkageBySlackThread('C-team', 'T-team');
    assert.ok(linkageAfterPm);
    const taskId = linkageAfterPm.taskId;
    assert.ok(prompts.pm.includes('[TASK_LINKAGE_CONTEXT]'));

    // Ensure exactly one linkage task exists so far.
    const tasksAfterPm = JSON.parse(fs.readFileSync(path.join(tempHome, 'tasks.json'), 'utf8'));
    assert.equal(tasksAfterPm.length, 1);
    assert.equal(tasksAfterPm[0].id, taskId);

    // Add repo/base before coder step to test derivation through linkage continuity.
    attachGitBranch(taskId, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const pendingAgents = getPendingAgents();
    const internalForCoder = claimAllPendingMessages('coder');
    assert.equal(
        internalForCoder.length,
        1,
        `expected one pending coder internal message, pending agents: ${pendingAgents.join(',')}`,
    );
    const coderMsg = internalForCoder[0];
    assert.equal(coderMsg.agent, 'coder');
    assert.ok(coderMsg.conversation_id);
    assert.equal(coderMsg.from_agent, 'pm');

    await processMessageForTest(coderMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        taskLinkageExecutionDeps: deps,
    });

    // Continuity: same task linkage object, no duplicate linkage task created.
    const linkageAfterCoder = getTaskLinkageBySlackThread('C-team', 'T-team');
    assert.ok(linkageAfterCoder);
    assert.equal(linkageAfterCoder.taskId, taskId);
    assert.equal(linkageAfterCoder.workingBranch, 'feature/parser-fix');
    assert.deepEqual(createBranchArgs, {
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/parser-fix',
    });

    const tasksAfterCoder = JSON.parse(fs.readFileSync(path.join(tempHome, 'tasks.json'), 'utf8'));
    assert.equal(tasksAfterCoder.length, 1);
    assert.equal(tasksAfterCoder[0].id, taskId);

    // Prompt continuity for coder includes linkage context.
    assert.ok(prompts.coder.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(prompts.coder.includes('repo=acme/repo'));
    assert.ok(prompts.coder.includes(`taskId: ${taskId}`));

    // Final outgoing user response comes from completed conversation and is cleaned.
    const responses = getResponsesForChannel('slack');
    const final = responses.find(r => r.message_id === 'msg_team_pm_1');
    assert.ok(final);
    assert.ok(!final.message.includes('[task_linkage'));
    assert.equal(final.message.includes('@pm:'), false);
    assert.equal(final.message.includes('@coder:'), false);
    assert.ok(final.message.includes('Coder implemented parser fix.'));

    // Runtime still emits stage start events for per-role status posting.
    const stepStarts = events.filter(e => e.type === 'chain_step_start' && e.data?.messageId === 'msg_team_pm_1');
    assert.equal(stepStarts.length >= 2, true);
    assert.equal(stepStarts.some(e => e.data?.agentId === 'pm'), true);
    assert.equal(stepStarts.some(e => e.data?.agentId === 'coder'), true);

    const metadata = final.metadata ? JSON.parse(final.metadata) : {};
    assert.equal(metadata.agentId, 'coder');
    assert.equal(metadata.teamId, 'dev');
    assert.equal(metadata.taskId, taskId);
});

test.after(() => {
    closeQueueDb();
});
