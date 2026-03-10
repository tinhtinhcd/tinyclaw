const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-context-budget-test-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-context-budget-test' },
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

const { applyContextBudget } = require('../dist/lib/context-budget.js');
const { buildRoleFetchedPrContext } = require('../dist/lib/task-linkage-workflow.js');
const { onEvent } = require('../dist/lib/logging.js');
const { initQueueDb, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');
const {
    createTaskLinkage,
    attachGitBranch,
    attachPullRequest,
    getTaskLinkage,
} = require('../dist/lib/task-linkage.js');

const events = [];
onEvent((type, data) => {
    events.push({ type, data });
});

function buildSlackDbMessage(id, messageId, text, channelId, threadTs) {
    return {
        id,
        message_id: messageId,
        channel: 'slack',
        sender: 'slack:U-budget',
        sender_id: 'U-budget',
        message: text,
        agent: 'tester',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-budget',
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

function passthroughIncoming(text) {
    return Promise.resolve({ text });
}
function passthroughOutgoing(text) {
    return Promise.resolve({ text, metadata: {} });
}

initQueueDb();

test('context budget keeps TASK block and drops lowest priority when needed', () => {
    const blocks = [
        { name: 'TASK_LINKAGE_CONTEXT', content: '[TASK_LINKAGE_CONTEXT]\n' + 'A'.repeat(500), priority: 100 },
        { name: 'TESTER_LINKED_PR_CONTEXT', content: '[TESTER_LINKED_PR_CONTEXT]\n' + 'B'.repeat(400), priority: 70 },
        { name: 'TESTER_FETCHED_PR_CONTEXT', content: '[TESTER_FETCHED_PR_CONTEXT]\n' + 'C'.repeat(700), priority: 50 },
        { name: 'TESTER_SYNTHESIZED_FOCUS', content: '[TESTER_SYNTHESIZED_FOCUS]\n' + 'D'.repeat(600), priority: 30 },
    ];
    const result = applyContextBudget(blocks, 1000);
    const names = result.map(b => b.name);
    assert.ok(names.includes('TASK_LINKAGE_CONTEXT'));
    assert.ok(!names.includes('TESTER_SYNTHESIZED_FOCUS'));
    assert.ok(result.some(b => b.content.includes('... (truncated)')));
});

test('fetched PR context caps body and file preview size', async () => {
    const result = await buildRoleFetchedPrContext('task_ctx_budget', 'tester', () => {}, {
        getTaskLinkage: () => ({
            taskId: 'task_ctx_budget',
            gitProvider: 'github',
            repo: 'acme/repo',
            pullRequestNumber: 321,
            workingBranch: 'feature/budget',
        }),
        getPullRequestDetails: async () => ({
            number: 321,
            title: 'Big PR',
            state: 'open',
            url: 'https://github.com/acme/repo/pull/321',
            body: 'X'.repeat(2600),
            baseBranch: 'main',
            headBranch: 'feature/budget',
            additions: 100,
            deletions: 50,
            changedFiles: 25,
            files: Array.from({ length: 20 }, (_, i) => ({
                path: `src/mod-${i}.ts`,
                status: 'modified',
                additions: 1,
                deletions: 1,
            })),
        }),
    });
    assert.ok(result.includes('body='));
    assert.ok(result.includes('... (truncated)'));
    const fileLines = result.split('\n').filter(line => line.startsWith('- src/mod-'));
    assert.equal(fileLines.length, 10);
});

test('runtime budget emits truncation/drop events and preserves core context', async () => {
    events.length = 0;
    process.env.PROMPT_CONTEXT_MAX_CHARS = '900';
    const task = createTaskLinkage({
        title: 'budget runtime task',
        slackChannelId: 'C-budget-1',
        slackThreadTs: 'T-budget-1',
        currentOwnerAgentId: 'tester',
        status: 'review',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/budget',
    });
    attachPullRequest(task.id, {
        pullRequestNumber: 909,
        pullRequestUrl: 'https://github.com/acme/repo/pull/909',
    });
    let capturedPrompt = '';
    const dbMsg = buildSlackDbMessage(9801, 'msg_budget_runtime', 'Validate budget behavior', 'C-budget-1', 'T-budget-1');
    await processMessageForTest(dbMsg, [], {
        invokeAgentFn: async (_agent, _agentId, prompt) => {
            capturedPrompt = prompt;
            return 'budget check response';
        },
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
        fetchReviewerPrContextFn: async () => ([
            '[TESTER_FETCHED_PR_CONTEXT]',
            `body=${'Y'.repeat(4000)}`,
            'filesPreview:',
            ...Array.from({ length: 30 }, (_, i) => `- src/file-${i}.ts (modified, +1/-1)`),
            '[/TESTER_FETCHED_PR_CONTEXT]',
            '',
            '[TESTER_SYNTHESIZED_FOCUS]',
            'riskHotspots=' + 'R'.repeat(2500),
            '[/TESTER_SYNTHESIZED_FOCUS]',
        ].join('\n')),
    });
    assert.ok(capturedPrompt.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(events.some(e => e.type === 'context_budget_truncation'));
    assert.ok(events.some(e => e.type === 'context_block_dropped'));
    delete process.env.PROMPT_CONTEXT_MAX_CHARS;
});

test.after(() => {
    closeQueueDb();
    delete process.env.PROMPT_CONTEXT_MAX_CHARS;
});

