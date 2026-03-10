const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-cond-handoff-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'off';

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-cond-handoff-test' },
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
const { getTaskLinkageBySlackThread } = require('../dist/lib/task-linkage.js');
const { processMessageForTest } = require('../dist/queue-processor.js');

initQueueDb();

function msg(id, messageId, agent, text, channelId = 'C-ch', threadTs = 'T-ch') {
    return {
        id: id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-ch',
        sender_id: 'U-ch',
        message: text,
        agent,
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-ch',
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

test('BA mentions ScrumMaster -> ScrumMaster runs', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        if (agentId === 'ba') {
            return `[BA_REQUIREMENTS] Done. [/BA_REQUIREMENTS]\n\n[@scrum_master: please create the Linear issue]`;
        }
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(20001, 'msg_ba_sm', 'ba', '@BA start task login system', 'C-ch-1', 'T-ch-1'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['ba']);
    const smPending = claimAllPendingMessages('scrum_master');
    assert.equal(smPending.length, 1);
    assert.equal(smPending[0].from_agent, 'ba');
});

test('BA mentions @user -> workflow waits, no next agent runs', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        if (agentId === 'ba') {
            return `[BA_REQUIREMENTS] Need clarification. [/BA_REQUIREMENTS]\n\n[@user: Can you confirm the login flow scope?]`;
        }
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(20002, 'msg_ba_user', 'ba', '@BA start task login system', 'C-ch-2', 'T-ch-2'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['ba']);
    assert.equal(claimAllPendingMessages('scrum_master').length, 0);
    assert.equal(claimAllPendingMessages('coder').length, 0);
    const linkage = getTaskLinkageBySlackThread('C-ch-2', 'T-ch-2');
    assert.ok(linkage, 'task linkage should exist for Slack thread');
    assert.equal(linkage.workflowWaitingForUserInput, true);
});

test('BA mentions nobody -> workflow pauses, no next agent runs', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        if (agentId === 'ba') {
            return `[BA_REQUIREMENTS] Analysis complete. Pausing for now. [/BA_REQUIREMENTS]`;
        }
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(20003, 'msg_ba_none', 'ba', '@BA start task login system', 'C-ch-3', 'T-ch-3'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['ba']);
    assert.equal(claimAllPendingMessages('scrum_master').length, 0);
    assert.equal(claimAllPendingMessages('coder').length, 0);
});

test('BA mentions coder (invalid transition) -> rejected, no handoff', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        if (agentId === 'ba') {
            return `[@coder: skip scrum master]`;
        }
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(20004, 'msg_ba_invalid', 'ba', '@BA start task login system', 'C-ch-4', 'T-ch-4'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['ba']);
    assert.equal(claimAllPendingMessages('coder').length, 0);
    assert.equal(claimAllPendingMessages('scrum_master').length, 0);
});

test('greeting to BA -> chat mode, no team progression', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(msg(20005, 'msg_ba_hello', 'ba', 'hello @BA'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['ba']);
    assert.equal(claimAllPendingMessages('scrum_master').length, 0);
    assert.equal(claimAllPendingMessages('coder').length, 0);
});

test.after(() => {
    delete process.env.CODER_WORKER_MODE;
    closeQueueDb();
});
