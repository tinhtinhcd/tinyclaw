const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-config-coder-delegation-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'cursor_handoff';

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-config-coder-delegation-test' },
    roles: {
        coder: { type: 'implementation', readOnly: false },
    },
    workflows: {
        dev_only: { stages: ['coder'] },
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
    teams: {
        dev: {
            name: 'Dev Team',
            agents: ['coder'],
            leader_agent: 'coder',
            workflow: {
                type: 'dev_pipeline',
                workflowId: 'dev_only',
            },
        },
    },
}, null, 2));

const { initQueueDb, getResponsesForChannel, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');

initQueueDb();

test('coder delegation still works in config-driven workflow', async () => {
    const dbMsg = {
        id: 9401,
        message_id: 'msg_cfg_coder_1',
        channel: 'slack',
        sender: 'slack:U-config',
        sender_id: 'U-config',
        message: 'Implement parser changes',
        agent: 'coder',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId: 'C-config',
            threadTs: 'T-config',
            userId: 'U-config',
            messageTs: String(Date.now()),
        }),
        status: 'pending',
        retry_count: 0,
        last_error: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        claimed_by: null,
    };

    await processMessageForTest(dbMsg, [], {
        invokeAgentFn: async (_agent, agentId) => {
            if (agentId === 'coder') {
                throw new Error('coder should use worker delegation, not native invoke');
            }
            return 'ok';
        },
        runIncomingHooksFn: async (text) => ({ text }),
        runOutgoingHooksFn: async (text) => ({ text, metadata: {} }),
    });

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_cfg_coder_1');
    assert.ok(resp);
    assert.ok(resp.message.includes('Coder work delegated via cursor_handoff.'));
});

test.after(() => {
    delete process.env.CODER_WORKER_MODE;
    closeQueueDb();
});
