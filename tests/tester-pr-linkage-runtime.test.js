const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-tester-pr-test-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-tester-pr-test' },
    agents: {
        tester: {
            name: 'Tester',
            role: 'tester',
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: 'tester',
        },
    },
}, null, 2));

const { initQueueDb, getResponsesForChannel, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');
const {
    createTaskLinkage,
    attachLinearIssue,
    attachGitBranch,
    attachPullRequest,
    getTaskLinkageBySlackThread,
} = require('../dist/lib/task-linkage.js');

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
        sender: 'slack:U-test',
        sender_id: 'U-test',
        message: text,
        agent: 'tester',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-test',
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

test('tester receives linked PR context and metadata remains correct', async () => {
    const task = createTaskLinkage({
        title: 'tester linked pr',
        slackChannelId: 'C-test-1',
        slackThreadTs: 'T-test-1',
        currentOwnerAgentId: 'tester',
        status: 'review',
    });
    attachLinearIssue(task.id, {
        linearIssueId: 'lin_990',
        linearIssueIdentifier: 'ENG-990',
        linearIssueUrl: 'https://linear.app/acme/issue/ENG-990',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/test-focus',
    });
    attachPullRequest(task.id, {
        pullRequestNumber: 404,
        pullRequestUrl: 'https://github.com/acme/repo/pull/404',
    });

    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return 'Tester validation summary completed.';
    };

    const dbMsg = buildSlackDbMessage(9401, 'msg_tester_1', 'Please validate this PR', 'C-test-1', 'T-test-1');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    assert.ok(capturedPrompt.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(capturedPrompt.includes('[TESTER_LINKED_PR_CONTEXT]'));
    assert.ok(capturedPrompt.includes('taskId=' + task.id));
    assert.ok(capturedPrompt.includes('linearIssueIdentifier=ENG-990'));
    assert.ok(capturedPrompt.includes('repo=acme/repo'));
    assert.ok(capturedPrompt.includes('workingBranch=feature/test-focus'));
    assert.ok(capturedPrompt.includes('pullRequestNumber=404'));
    assert.ok(capturedPrompt.includes('pullRequestUrl=https://github.com/acme/repo/pull/404'));
    assert.ok(capturedPrompt.includes('do not ask user again for PR number/URL/repo'));

    const linkage = getTaskLinkageBySlackThread('C-test-1', 'T-test-1');
    assert.equal(linkage.taskId, task.id);
    assert.equal(linkage.pullRequestNumber, 404);

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_tester_1');
    assert.ok(resp);
    const metadata = resp.metadata ? JSON.parse(resp.metadata) : {};
    assert.equal(metadata.agentId, 'tester');
    assert.equal(metadata.taskId, task.id);
});

test.after(() => {
    closeQueueDb();
});
