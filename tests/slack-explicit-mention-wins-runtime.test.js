/**
 * Runtime test: explicit @BA mention is NOT overridden by inbound bot fallback.
 * When user sends "@BA analyze" via the Scrum Master bot (inboundBotId), we must route to BA.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-slack-explicit-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'off';

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'slack-explicit-test' },
    agents: {
        ba: { name: 'BA', role: 'ba', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'ba' },
        scrum_master: { name: 'Scrum Master', role: 'scrum_master', provider: 'openrouter', model: 'openai/gpt-4.1-mini', working_directory: 'sm' },
    },
    teams: {
        dev: { name: 'Dev Team', agents: ['ba', 'scrum_master'], leader_agent: 'ba' },
    },
    channels: {
        slack: {
            role_bot_map: { scrum_master: 'BOT_SM' },
        },
    },
}, null, 2));

const { initQueueDb, claimAllPendingMessages, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');

initQueueDb();

function slackMsg(id, messageId, text, inboundBotId = 'BOT_SM') {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-user',
        sender_id: 'U-user',
        message: text,
        agent: null,
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId: 'C-ch',
            threadTs: 'T-ch',
            userId: 'U-user',
            messageTs: String(Date.now()),
            inboundBotId,
        }),
        status: 'pending',
        retry_count: 0,
        last_error: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        claimed_by: null,
    };
}

test('explicit @BA routes to BA even when inbound bot is Scrum Master', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(slackMsg(9001, 'msg_ba_explicit', '@BA analyze login flow'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['ba']);
    assert.equal(claimAllPendingMessages('scrum_master').length, 0);
});

test('hi @Scrum Master routes to Scrum Master (display name)', async () => {
    const calls = [];
    const invokeAgentFn = async (_agent, agentId) => {
        calls.push(agentId);
        return `reply-from-${agentId}`;
    };
    await processMessageForTest(slackMsg(9002, 'msg_sm_display', 'hi @Scrum Master'), [], {
        invokeAgentFn,
        runIncomingHooksFn: async text => ({ text }),
        runOutgoingHooksFn: async text => ({ text, metadata: {} }),
    });
    assert.deepEqual(calls, ['scrum_master']);
});

test.after(() => {
    delete process.env.CODER_WORKER_MODE;
    closeQueueDb();
});
