const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-tester-pr-fetch-test-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-tester-pr-fetch-test' },
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
const { buildRoleFetchedPrContext } = require('../dist/lib/task-linkage-workflow.js');
const {
    createTaskLinkage,
    attachLinearIssue,
    attachGitBranch,
    attachPullRequest,
    getTaskLinkageBySlackThread,
    getTaskLinkage,
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
        sender: 'slack:U-test-fetch',
        sender_id: 'U-test-fetch',
        message: text,
        agent: 'tester',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-test-fetch',
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
        title: 'tester fetch task',
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        currentOwnerAgentId: 'tester',
        status: 'review',
    });
    attachLinearIssue(task.id, {
        linearIssueId: 'lin_920',
        linearIssueIdentifier: 'ENG-920',
        linearIssueUrl: 'https://linear.app/acme/issue/ENG-920',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/tester-fetch',
    });
    attachPullRequest(task.id, {
        pullRequestNumber: 606,
        pullRequestUrl: 'https://github.com/acme/repo/pull/606',
    });
    return task;
}

initQueueDb();

test('tester prompt includes fetched PR context block when fetch succeeds', async () => {
    const task = seedLinkedTask('C-tpf-1', 'T-tpf-1');
    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return 'Tester completed validation with fetched context.';
    };
    const fetchReviewerPrContextFn = (taskId, role, log) => buildRoleFetchedPrContext(
        taskId,
        role,
        log,
        {
            getTaskLinkage,
            getPullRequestDetails: async () => ({
                number: 606,
                title: 'Fix parser edge cases',
                state: 'open',
                url: 'https://github.com/acme/repo/pull/606',
                body: 'Covers parser boundary conditions.',
                baseBranch: 'main',
                headBranch: 'feature/tester-fetch',
                additions: 40,
                deletions: 12,
                changedFiles: 5,
                files: [
                    { path: 'src/api/parser.ts', status: 'modified', additions: 18, deletions: 4 },
                    { path: 'src/lib/validator.ts', status: 'modified', additions: 12, deletions: 3 },
                    { path: 'tests/parser.spec.ts', status: 'modified', additions: 10, deletions: 5 },
                ],
            }),
        },
    );

    const dbMsg = buildSlackDbMessage(9501, 'msg_tester_fetch_ok', 'Validate current PR with fetched context', 'C-tpf-1', 'T-tpf-1');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        fetchReviewerPrContextFn,
    });

    assert.ok(capturedPrompt.includes('[TESTER_FETCHED_PR_CONTEXT]'));
    assert.ok(capturedPrompt.includes('title=Fix parser edge cases'));
    assert.ok(capturedPrompt.includes('pullRequestNumber=606'));
    assert.ok(capturedPrompt.includes('[TESTER_SYNTHESIZED_FOCUS]'));
    assert.ok(capturedPrompt.includes('affectedModules=src, tests'));

    const linkage = getTaskLinkageBySlackThread('C-tpf-1', 'T-tpf-1');
    assert.equal(linkage.taskId, task.id);
});

test('tester fetch failure falls back to linkage-only context safely', async () => {
    const task = seedLinkedTask('C-tpf-2', 'T-tpf-2');
    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return 'Tester completed validation with fallback context.';
    };
    const fetchReviewerPrContextFn = async () => {
        throw new Error('mock tester fetch failure');
    };

    const before = getTaskLinkageBySlackThread('C-tpf-2', 'T-tpf-2');
    const dbMsg = buildSlackDbMessage(9502, 'msg_tester_fetch_fail', 'Validate fallback case', 'C-tpf-2', 'T-tpf-2');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        fetchReviewerPrContextFn,
    });

    assert.ok(capturedPrompt.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(capturedPrompt.includes('[TESTER_LINKED_PR_CONTEXT]'));
    assert.ok(!capturedPrompt.includes('[TESTER_FETCHED_PR_CONTEXT]'));
    assert.ok(!capturedPrompt.includes('[TESTER_SYNTHESIZED_FOCUS]'));

    const after = getTaskLinkageBySlackThread('C-tpf-2', 'T-tpf-2');
    assert.equal(after.taskId, before.taskId);
    assert.equal(after.pullRequestNumber, before.pullRequestNumber);
    assert.equal(after.pullRequestUrl, before.pullRequestUrl);

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_tester_fetch_fail');
    assert.ok(resp);
    const metadata = resp.metadata ? JSON.parse(resp.metadata) : {};
    assert.equal(metadata.agentId, 'tester');
    assert.equal(metadata.taskId, task.id);
});

test('tester synthesizer degrades gracefully with partial linkage and no fetched PR', async () => {
    const task = createTaskLinkage({
        title: 'tester partial synth',
        slackChannelId: 'C-tpf-3',
        slackThreadTs: 'T-tpf-3',
        currentOwnerAgentId: 'tester',
        status: 'review',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/partial-only',
    });

    let capturedPrompt = '';
    const invokeAgentFn = async (_agent, _agentId, prompt) => {
        capturedPrompt = prompt;
        return 'Tester partial synthesis path.';
    };

    const dbMsg = buildSlackDbMessage(9503, 'msg_tester_partial_synth', 'Validate partial context', 'C-tpf-3', 'T-tpf-3');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn,
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    assert.ok(capturedPrompt.includes('[TESTER_SYNTHESIZED_FOCUS]'));
    assert.ok(capturedPrompt.includes('repo=acme/repo'));
    assert.ok(capturedPrompt.includes('workingBranch=feature/partial-only'));
    assert.ok(!capturedPrompt.includes('[TESTER_FETCHED_PR_CONTEXT]'));
});

test('tester no linkage context still works without synthesized block', async () => {
    const dbMsg = {
        ...buildSlackDbMessage(9504, 'msg_tester_no_context', 'General testing request', 'C-tpf-4', 'T-tpf-4'),
        source_metadata: null,
    };
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn: async () => 'Tester no-context path.',
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_tester_no_context');
    assert.ok(resp);
    assert.ok(resp.message.includes('Tester no-context path.'));
});

test.after(() => {
    closeQueueDb();
});
