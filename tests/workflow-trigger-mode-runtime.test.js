const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-workflow-trigger-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'off';

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-workflow-trigger-test' },
    roles: {
        ba: { type: 'analysis', readOnly: false },
        scrum_master: { type: 'planning', readOnly: false, requiresApprovalToAdvance: false },
        coder: { type: 'implementation', readOnly: false },
    },
    workflows: {
        full_team: { stages: ['ba', 'scrum_master', 'coder'] },
    },
    agents: {
        ba: { name: 'BA', role: 'ba', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'ba' },
        scrum_master: { name: 'Scrum Master', role: 'scrum_master', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'scrum_master' },
        coder: { name: 'Coder', role: 'coder', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'coder' },
    },
    teams: {
        dev: {
            name: 'Dev Team',
            agents: ['ba', 'scrum_master', 'coder'],
            leader_agent: 'ba',
            workflow: { type: 'dev_pipeline', workflowId: 'full_team' },
        },
    },
}, null, 2));

const { initQueueDb, claimAllPendingMessages, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');

initQueueDb();

function msg(id, messageId, agent, text, channelId = 'C-wf', threadTs = 'T-wf') {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-wf',
        sender_id: 'U-wf',
        message: text,
        agent,
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-wf',
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

test('hello @Scrum Master -> only Scrum Master replies (chat mode)', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(11001, 'msg_sm_chat', 'scrum_master', 'hello @Scrum Master'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['scrum_master']);
    assert.equal(claimAllPendingMessages('ba').length, 0);
    assert.equal(claimAllPendingMessages('coder').length, 0);
});

test('@BA analyze login system -> BA only (chat mode)', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(11002, 'msg_ba_chat', 'ba', '@BA analyze login system', 'C-wf-2', 'T-wf-2'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['ba']);
    assert.equal(claimAllPendingMessages('scrum_master').length, 0);
    assert.equal(claimAllPendingMessages('coder').length, 0);
});

test('@Scrum Master start task login system -> workflow mode, handoff when SM mentions coder', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        if (agentId === 'scrum_master') {
            return `reply-from-${agentId}\n\n[@coder: please implement the login system]`;
        }
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(11003, 'msg_sm_start_workflow', 'scrum_master', '@Scrum Master start task login system', 'C-wf-3', 'T-wf-3'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['scrum_master']);
    const coderPending = claimAllPendingMessages('coder');
    assert.equal(coderPending.length, 1);
    assert.equal(coderPending[0].from_agent, 'scrum_master');
});

test.after(() => {
    delete process.env.CODER_WORKER_MODE;
    closeQueueDb();
});
