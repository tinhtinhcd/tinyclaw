const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-runtime-test-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: {
        path: process.cwd(),
        name: 'tinyclaw-test',
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
}, null, 2));

const { initQueueDb, getResponsesForChannel, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');
const {
    getTaskLinkageBySlackThread,
    updateTaskLinkage,
} = require('../dist/lib/task-linkage.js');

function noOpLog() {}

function passthroughIncoming(text) {
    return Promise.resolve({ text });
}

function passthroughOutgoing(text) {
    return Promise.resolve({ text, metadata: {} });
}

function buildSlackDbMessage(id, messageId, agent, text, channelId = 'C1', threadTs = 'T1') {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U1',
        sender_id: 'U1',
        message: text,
        agent,
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U1',
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

test('PM runtime flow: linkage context injected, create_linear_issue applied, response cleaned, metadata correct', async () => {
    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return [
            'PM analysis completed.',
            '[task_linkage action="create_linear_issue" title="Fix parser bug" description="Handle malformed payload from Slack." teamId="team-1"]',
        ].join('\n');
    };

    const deps = {
        getTaskLinkage: require('../dist/lib/task-linkage.js').getTaskLinkage,
        attachLinearIssue: require('../dist/lib/task-linkage.js').attachLinearIssue,
        attachGitBranch: require('../dist/lib/task-linkage.js').attachGitBranch,
        attachPullRequest: require('../dist/lib/task-linkage.js').attachPullRequest,
        createIssue: async () => ({
            id: 'lin_1',
            identifier: 'ENG-501',
            url: 'https://linear.app/acme/issue/ENG-501',
        }),
        createBranch: async () => ({ ref: 'refs/heads/unused', sha: 'abc' }),
        createPullRequest: async () => ({ number: 1, url: 'https://example.com/p/1', state: 'open' }),
    };

    const dbMsg = buildSlackDbMessage(1, 'msg_pm_1', 'pm', 'Start PM planning');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        taskLinkageExecutionDeps: deps,
    });

    assert.ok(capturedPrompt.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(capturedPrompt.includes('PM guidance:'));

    const linkage = getTaskLinkageBySlackThread('C1', 'T1');
    assert.ok(linkage);
    assert.equal(linkage.linearIssueId, 'lin_1');
    assert.equal(linkage.linearIssueIdentifier, 'ENG-501');

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_pm_1');
    assert.ok(resp);
    assert.ok(!resp.message.includes('[task_linkage'));
    assert.ok(resp.message.includes('PM analysis completed.'));

    const metadata = resp.metadata ? JSON.parse(resp.metadata) : {};
    assert.equal(metadata.agentId, 'pm');
    assert.equal(metadata.taskId, linkage.taskId);
});

test('Coder runtime flow: existing linkage context injected, create_git_branch applied, cleaned response + metadata', async () => {
    const linkage = getTaskLinkageBySlackThread('C1', 'T1');
    assert.ok(linkage);

    updateTaskLinkage(linkage.taskId, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
    });

    let capturedPrompt = '';
    let createBranchArgs = null;
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return [
            'Coder implementation started.',
            '[task_linkage action="create_git_branch" workingBranch="feature/parser-fix"]',
        ].join('\n');
    };

    const deps = {
        getTaskLinkage: require('../dist/lib/task-linkage.js').getTaskLinkage,
        attachLinearIssue: require('../dist/lib/task-linkage.js').attachLinearIssue,
        attachGitBranch: require('../dist/lib/task-linkage.js').attachGitBranch,
        attachPullRequest: require('../dist/lib/task-linkage.js').attachPullRequest,
        createIssue: async () => ({ id: 'unused', identifier: 'UNUSED-1', url: 'https://example.com' }),
        createBranch: async (repo, baseBranch, workingBranch) => {
            createBranchArgs = { repo, baseBranch, workingBranch };
            return { ref: `refs/heads/${workingBranch}`, sha: 'def' };
        },
        createPullRequest: async () => ({ number: 2, url: 'https://example.com/p/2', state: 'open' }),
    };

    const dbMsg = buildSlackDbMessage(2, 'msg_coder_1', 'coder', 'Please start coding');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        taskLinkageExecutionDeps: deps,
    });

    assert.ok(capturedPrompt.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(capturedPrompt.includes('repo=acme/repo'));
    assert.ok(capturedPrompt.includes('base=main'));
    assert.deepEqual(createBranchArgs, {
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/parser-fix',
    });

    const updated = getTaskLinkageBySlackThread('C1', 'T1');
    assert.equal(updated.workingBranch, 'feature/parser-fix');

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_coder_1');
    assert.ok(resp);
    assert.ok(!resp.message.includes('[task_linkage'));
    assert.ok(resp.message.includes('Coder implementation started.'));

    const metadata = resp.metadata ? JSON.parse(resp.metadata) : {};
    assert.equal(metadata.agentId, 'coder');
    assert.equal(metadata.taskId, updated.taskId);
});

test.after(() => {
    closeQueueDb();
});
