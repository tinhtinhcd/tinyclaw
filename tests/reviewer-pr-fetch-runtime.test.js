const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-reviewer-pr-fetch-test-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-reviewer-pr-fetch-test' },
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
        sender: 'slack:U-review-fetch',
        sender_id: 'U-review-fetch',
        message: text,
        agent: 'reviewer',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-review-fetch',
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

function seedLinkedTask(channelId, threadTs) {
    const task = createTaskLinkage({
        title: 'reviewer fetch task',
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        currentOwnerAgentId: 'reviewer',
        status: 'review',
    });
    attachLinearIssue(task.id, {
        linearIssueId: 'lin_910',
        linearIssueIdentifier: 'ENG-910',
        linearIssueUrl: 'https://linear.app/acme/issue/ENG-910',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/review-fetch',
    });
    attachPullRequest(task.id, {
        pullRequestNumber: 555,
        pullRequestUrl: 'https://github.com/acme/repo/pull/555',
    });
    return task;
}

initQueueDb();

test('reviewer prompt includes fetched PR context block when fetch succeeds', async () => {
    const task = seedLinkedTask('C-rpf-1', 'T-rpf-1');
    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return 'Review completed with fetched context.';
    };
    const fetchReviewerPrContextFn = async () => [
        '[REVIEWER_FETCHED_PR_CONTEXT]',
        'title=Fix parser edge cases',
        'state=open',
        'baseBranch=main',
        'headBranch=feature/review-fetch',
        '[/REVIEWER_FETCHED_PR_CONTEXT]',
    ].join('\n');

    const dbMsg = buildSlackDbMessage(9301, 'msg_review_fetch_ok', 'Review current PR with fetched context', 'C-rpf-1', 'T-rpf-1');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        fetchReviewerPrContextFn,
    });

    assert.ok(capturedPrompt.includes('[REVIEWER_FETCHED_PR_CONTEXT]'));
    assert.ok(capturedPrompt.includes('title=Fix parser edge cases'));
    assert.ok(capturedPrompt.includes('pullRequestNumber=555'));

    const linkage = getTaskLinkageBySlackThread('C-rpf-1', 'T-rpf-1');
    assert.equal(linkage.taskId, task.id);
    assert.equal(linkage.pullRequestNumber, 555);
    assert.equal(linkage.pullRequestUrl, 'https://github.com/acme/repo/pull/555');
});

test('fetch failure falls back to linkage-only reviewer context without breaking flow', async () => {
    const task = seedLinkedTask('C-rpf-2', 'T-rpf-2');
    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return 'Review completed with linkage-only fallback.';
    };
    const fetchReviewerPrContextFn = async () => {
        throw new Error('mock fetch failure');
    };

    const before = getTaskLinkageBySlackThread('C-rpf-2', 'T-rpf-2');
    const dbMsg = buildSlackDbMessage(9302, 'msg_review_fetch_fail', 'Review fallback case', 'C-rpf-2', 'T-rpf-2');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        fetchReviewerPrContextFn,
    });

    assert.ok(capturedPrompt.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(capturedPrompt.includes('[REVIEWER_LINKED_PR_CONTEXT]'));
    assert.ok(!capturedPrompt.includes('[REVIEWER_FETCHED_PR_CONTEXT]'));

    const after = getTaskLinkageBySlackThread('C-rpf-2', 'T-rpf-2');
    assert.equal(after.taskId, before.taskId);
    assert.equal(after.pullRequestNumber, before.pullRequestNumber);
    assert.equal(after.pullRequestUrl, before.pullRequestUrl);

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_review_fetch_fail');
    assert.ok(resp);
    const metadata = resp.metadata ? JSON.parse(resp.metadata) : {};
    assert.equal(metadata.agentId, 'reviewer');
    assert.equal(metadata.taskId, task.id);
});

test.after(() => {
    closeQueueDb();
});
