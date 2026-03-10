const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-ba-architect-approval-gate-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'off';

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-ba-architect-approval-gate' },
    roles: {
        ba: { type: 'analysis', readOnly: false },
        pm: { type: 'planning', readOnly: false, requiresApprovalToAdvance: true },
        architect: { type: 'design', readOnly: false },
        coder: { type: 'implementation', readOnly: false },
    },
    workflows: {
        full_team: { stages: ['ba', 'pm', 'architect', 'coder'] },
    },
    agents: {
        ba: { name: 'BA', role: 'ba', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'ba' },
        pm: { name: 'PM', role: 'pm', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'pm' },
        architect: { name: 'Architect', role: 'architect', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'architect' },
        coder: { name: 'Coder', role: 'coder', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'coder' },
    },
    teams: {
        full: {
            name: 'Full Team',
            agents: ['ba', 'pm', 'architect', 'coder'],
            leader_agent: 'ba',
            workflow: { type: 'dev_pipeline', workflowId: 'full_team' },
        },
    },
}, null, 2));

const { initQueueDb, claimAllPendingMessages, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');
const { getTaskLinkageBySlackThread } = require('../dist/lib/task-linkage.js');

initQueueDb();

function msg(id, messageId, text) {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-full',
        sender_id: 'U-full',
        message: text,
        agent: 'ba',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId: 'C-full',
            threadTs: 'T-full',
            userId: 'U-full',
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

test('approval gate works with BA and Architect in configured workflow', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        if (agentId === 'ba') return 'BA clarifies scope and requirements.';
        if (agentId === 'pm') return 'PM plan drafted. Awaiting approval.';
        if (agentId === 'architect') return 'Architect design prepared.';
        if (agentId === 'coder') return 'Coder implemented.';
        return 'done';
    };

    await processMessageForTest(msg(9501, 'msg_ba_1', 'Need new feature'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });

    // BA should hand off to PM automatically (no approval gate on BA).
    const pmPending = claimAllPendingMessages('pm');
    assert.equal(pmPending.length, 1);
    await processMessageForTest(pmPending[0], [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });

    // PM should stop on approval gate; architect should not be queued yet.
    const architectPendingBeforeApproval = claimAllPendingMessages('architect');
    assert.equal(architectPendingBeforeApproval.length, 0);
    const linkage = getTaskLinkageBySlackThread('C-full', 'T-full');
    assert.ok(linkage);
    assert.equal(linkage.devPipelineAwaitingApproval, true);
    assert.equal(linkage.devPipelineAwaitingRole, 'pm');
    assert.equal(linkage.devPipelineNextRole, 'architect');

    // Approval should route next step to architect.
    await processMessageForTest(msg(9502, 'msg_ba_approve', 'approve'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.equal(calls.includes('architect'), true);
});

test.after(() => {
    delete process.env.CODER_WORKER_MODE;
    closeQueueDb();
});
