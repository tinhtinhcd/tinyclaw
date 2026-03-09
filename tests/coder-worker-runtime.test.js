const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-coder-worker-test-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'cursor_handoff';

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: {
        path: process.cwd(),
        name: 'tinyclaw-coder-worker-test',
    },
    agents: {
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
const { createTaskLinkage, attachGitBranch, getTaskLinkageBySlackThread } = require('../dist/lib/task-linkage.js');

function passthroughIncoming(text) {
    return Promise.resolve({ text });
}

function passthroughOutgoing(text) {
    return Promise.resolve({ text, metadata: {} });
}

function buildSlackDbMessage(id, messageId, agent, text, channelId = 'C-coder', threadTs = 'T-coder') {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-coder',
        sender_id: 'U-coder',
        message: text,
        agent,
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-coder',
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

test('coder delegates through coding worker and updates linkage', async () => {
    const task = createTaskLinkage({
        title: 'Coder worker task',
        slackChannelId: 'C-coder',
        slackThreadTs: 'T-coder',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    let nativeInvokeCalled = false;
    const invokeAgentFn = async () => {
        nativeInvokeCalled = true;
        return 'native response';
    };

    const dbMsg = buildSlackDbMessage(8001, 'msg_coder_worker_1', 'coder', 'Implement this task');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    assert.equal(nativeInvokeCalled, false);

    const linkage = getTaskLinkageBySlackThread('C-coder', 'T-coder');
    assert.ok(linkage);
    assert.equal(linkage.taskId, task.id);
    assert.ok(linkage.workingBranch);

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_coder_worker_1');
    assert.ok(resp);
    assert.ok(resp.message.includes('Coder work delegated via cursor_handoff.'));
    const metadata = resp.metadata ? JSON.parse(resp.metadata) : {};
    assert.equal(metadata.agentId, 'coder');
    assert.equal(metadata.taskId, task.id);
});

test.after(() => {
    closeQueueDb();
    delete process.env.CODER_WORKER_MODE;
});
