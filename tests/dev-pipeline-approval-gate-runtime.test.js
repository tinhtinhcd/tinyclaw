const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-dev-pipeline-approval-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'off';

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-dev-pipeline-approval-test' },
    agents: {
        pm: { name: 'PM', role: 'pm', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'pm' },
        coder: { name: 'Coder', role: 'coder', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'coder' },
        reviewer: { name: 'Reviewer', role: 'reviewer', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'reviewer' },
        tester: { name: 'Tester', role: 'tester', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'tester' },
    },
    teams: {
        dev: {
            name: 'Dev Team',
            agents: ['pm', 'coder', 'reviewer', 'tester'],
            leader_agent: 'pm',
            workflow: {
                type: 'dev_pipeline',
                pm: 'pm',
                coder: 'coder',
                reviewer: 'reviewer',
                tester: 'tester',
            },
        },
    },
}, null, 2));

const { initQueueDb, getResponsesForChannel, claimAllPendingMessages, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');
const { getTaskLinkageBySlackThread } = require('../dist/lib/task-linkage.js');

function passthroughIncoming(text) {
    return Promise.resolve({ text });
}

function passthroughOutgoing(text) {
    return Promise.resolve({ text, metadata: {} });
}

function buildSlackDbMessage(id, messageId, text, channelId, threadTs) {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-approval',
        sender_id: 'U-approval',
        message: text,
        agent: 'pm',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-approval',
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

test('PM stays gatekeeper until explicit approval', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId, prompt) => {
        calls.push({ agentId, prompt });
        if (agentId === 'pm') return 'PM planning: I will wait for your approval before implementation.';
        if (agentId === 'coder') return 'Coder implementation complete.';
        if (agentId === 'reviewer') return 'Reviewer approved.';
        return 'Tester validated.';
    };

    const channelId = 'C-approve-1';
    const threadTs = 'T-approve-1';

    // 1) Explicit workflow start stays at PM only until approval.
    await processMessageForTest(buildSlackDbMessage(9101, 'msg_approval_hello', 'start task hello @PM', channelId, threadTs), [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });
    assert.equal(calls.some(c => c.agentId === 'coder'), false);
    assert.equal(claimAllPendingMessages('coder').length, 0);

    let linkage = getTaskLinkageBySlackThread(channelId, threadTs);
    assert.ok(linkage);
    assert.equal(linkage.devPipelineAwaitingPmApproval, true);

    // 2) Non-approval follow-up still stays at PM.
    await processMessageForTest(buildSlackDbMessage(9102, 'msg_approval_followup', 'add more details first', channelId, threadTs), [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });
    const coderCallsBeforeApproval = calls.filter(c => c.agentId === 'coder').length;
    assert.equal(coderCallsBeforeApproval, 0);
    linkage = getTaskLinkageBySlackThread(channelId, threadTs);
    assert.ok(linkage);
    assert.equal(linkage.devPipelineAwaitingPmApproval, true);

    // 3) Explicit approval advances to coder (and next stages may continue).
    await processMessageForTest(buildSlackDbMessage(9103, 'msg_approval_yes', 'approve', channelId, threadTs), [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });
    const coderCallsAfterApproval = calls.filter(c => c.agentId === 'coder').length;
    assert.equal(coderCallsAfterApproval >= 1, true);

    linkage = getTaskLinkageBySlackThread(channelId, threadTs);
    assert.ok(linkage);
    assert.equal(linkage.devPipelineAwaitingPmApproval, false);
    assert.equal(typeof linkage.devPipelineApprovedAt, 'number');

    // Final public response exists for each user message and no internal queue spill.
    const responses = getResponsesForChannel('slack');
    assert.ok(responses.find(r => r.message_id === 'msg_approval_hello'));
    assert.ok(responses.find(r => r.message_id === 'msg_approval_followup'));
});

test('Real dev request still stops at PM until approval', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        if (agentId === 'pm') return 'PM plan for JWT login ready. Awaiting approval.';
        if (agentId === 'coder') return 'Coder completed JWT implementation.';
        if (agentId === 'reviewer') return 'Reviewer done.';
        return 'Tester done.';
    };

    const channelId = 'C-approve-2';
    const threadTs = 'T-approve-2';

    await processMessageForTest(
        buildSlackDbMessage(9201, 'msg_approval_real_task', 'implement login with JWT', channelId, threadTs),
        [],
        {
            invokeAgentFn,
            runIncomingHooksFn: passthroughIncoming,
            runOutgoingHooksFn: passthroughOutgoing,
        },
    );

    assert.equal(calls.includes('pm'), true);
    assert.equal(calls.includes('coder'), false);
    const linkage = getTaskLinkageBySlackThread(channelId, threadTs);
    assert.ok(linkage);
    assert.equal(linkage.devPipelineAwaitingPmApproval, true);
});

test.after(() => {
    delete process.env.CODER_WORKER_MODE;
    closeQueueDb();
});
