const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-reviewer-pr-test-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-reviewer-pr-test' },
    agents: {
        reviewer: {
            name: 'Reviewer',
            role: 'reviewer',
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: 'reviewer',
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
        sender: 'slack:U-review',
        sender_id: 'U-review',
        message: text,
        agent: 'reviewer',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-review',
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

test('reviewer receives linked PR context and metadata remains correct', async () => {
    const task = createTaskLinkage({
        title: 'review linked pr',
        slackChannelId: 'C-review-1',
        slackThreadTs: 'T-review-1',
        currentOwnerAgentId: 'reviewer',
        status: 'review',
    });
    attachLinearIssue(task.id, {
        linearIssueId: 'lin_900',
        linearIssueIdentifier: 'ENG-900',
        linearIssueUrl: 'https://linear.app/acme/issue/ENG-900',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/pr-review',
    });
    attachPullRequest(task.id, {
        pullRequestNumber: 321,
        pullRequestUrl: 'https://github.com/acme/repo/pull/321',
    });

    const before = getTaskLinkageBySlackThread('C-review-1', 'T-review-1');
    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return 'Review summary: linked PR context consumed.';
    };

    const dbMsg = buildSlackDbMessage(9201, 'msg_review_1', 'Please review current PR', 'C-review-1', 'T-review-1');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    assert.ok(capturedPrompt.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(capturedPrompt.includes('[REVIEWER_LINKED_PR_CONTEXT]'));
    assert.ok(capturedPrompt.includes('taskId=' + task.id));
    assert.ok(capturedPrompt.includes('linearIssueIdentifier=ENG-900'));
    assert.ok(capturedPrompt.includes('repo=acme/repo'));
    assert.ok(capturedPrompt.includes('workingBranch=feature/pr-review'));
    assert.ok(capturedPrompt.includes('pullRequestNumber=321'));
    assert.ok(capturedPrompt.includes('pullRequestUrl=https://github.com/acme/repo/pull/321'));
    assert.ok(capturedPrompt.includes('do not ask user again for PR number/URL/repo'));

    const after = getTaskLinkageBySlackThread('C-review-1', 'T-review-1');
    assert.equal(after.taskId, before.taskId);
    assert.equal(after.pullRequestNumber, 321);
    assert.equal(after.pullRequestUrl, 'https://github.com/acme/repo/pull/321');
    assert.equal(after.workingBranch, 'feature/pr-review');

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_review_1');
    assert.ok(resp);
    assert.ok(!resp.message.includes('[task_linkage'));
    const metadata = resp.metadata ? JSON.parse(resp.metadata) : {};
    assert.equal(metadata.agentId, 'reviewer');
    assert.equal(metadata.taskId, task.id);
});

test.after(() => {
    closeQueueDb();
});
