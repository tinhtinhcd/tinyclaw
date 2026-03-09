const test = require('node:test');
const assert = require('node:assert/strict');

const { applyTaskLinkageCommands } = require('../dist/lib/task-linkage-workflow.js');

function makeHarness(initialLinkage = {}) {
    const state = {
        linkage: {
            taskId: 'task_1',
            status: 'in_progress',
            ...initialLinkage,
        },
        calls: {
            createIssue: 0,
            createBranch: 0,
            createPullRequest: 0,
            attachLinearIssue: 0,
            attachGitBranch: 0,
            attachPullRequest: 0,
        },
    };

    const deps = {
        getTaskLinkage: () => ({ ...state.linkage }),
        attachLinearIssue: (_taskId, patch) => {
            state.calls.attachLinearIssue += 1;
            state.linkage.linearIssueId = patch.linearIssueId;
            state.linkage.linearIssueIdentifier = patch.linearIssueIdentifier;
            state.linkage.linearIssueUrl = patch.linearIssueUrl;
            return { ...state.linkage };
        },
        attachGitBranch: (_taskId, patch) => {
            state.calls.attachGitBranch += 1;
            state.linkage.gitProvider = patch.gitProvider;
            state.linkage.repo = patch.repo;
            state.linkage.baseBranch = patch.baseBranch;
            state.linkage.workingBranch = patch.workingBranch;
            return { ...state.linkage };
        },
        attachPullRequest: (_taskId, patch) => {
            state.calls.attachPullRequest += 1;
            state.linkage.pullRequestNumber = patch.pullRequestNumber;
            state.linkage.pullRequestUrl = patch.pullRequestUrl;
            return { ...state.linkage };
        },
        createIssue: async () => {
            state.calls.createIssue += 1;
            return {
                id: 'lin_1',
                identifier: 'ENG-101',
                url: 'https://linear.app/acme/issue/ENG-101',
            };
        },
        createBranch: async () => {
            state.calls.createBranch += 1;
            return { ref: 'refs/heads/feature/x', sha: 'abc' };
        },
        createPullRequest: async () => {
            state.calls.createPullRequest += 1;
            return { number: 42, url: 'https://github.com/acme/repo/pull/42', state: 'open' };
        },
    };

    return { state, deps };
}

function noOpLog() {}

test('accepted commands mutate linkage: create_linear_issue', async () => {
    const { state, deps } = makeHarness();
    const response = 'PM update\n[task_linkage action="create_linear_issue" title="Fix bug" description="Handle malformed payload" teamId="team-1"]';
    const cleaned = await applyTaskLinkageCommands('task_1', 'pm', 'pm', response, noOpLog, deps);

    assert.equal(state.calls.createIssue, 1);
    assert.equal(state.calls.attachLinearIssue, 1);
    assert.equal(state.linkage.linearIssueId, 'lin_1');
    assert.equal(state.linkage.linearIssueIdentifier, 'ENG-101');
    assert.ok(!cleaned.includes('[task_linkage'));
});

test('accepted commands mutate linkage: create_git_branch', async () => {
    const { state, deps } = makeHarness();
    const response = 'Coder update\n[task_linkage action="create_git_branch" repo="acme/repo" baseBranch="main" workingBranch="feature/x"]';
    const cleaned = await applyTaskLinkageCommands('task_1', 'coder', 'coder', response, noOpLog, deps);

    assert.equal(state.calls.createBranch, 1);
    assert.equal(state.calls.attachGitBranch, 1);
    assert.equal(state.linkage.repo, 'acme/repo');
    assert.equal(state.linkage.baseBranch, 'main');
    assert.equal(state.linkage.workingBranch, 'feature/x');
    assert.ok(!cleaned.includes('[task_linkage'));
});

test('accepted commands mutate linkage: create_pull_request', async () => {
    const { state, deps } = makeHarness({ repo: 'acme/repo', baseBranch: 'main', workingBranch: 'feature/x' });
    const response = 'Coder ready for review\n[task_linkage action="create_pull_request" repo="acme/repo" title="Fix bug" description="Desc" headBranch="feature/x" baseBranch="main"]';
    const cleaned = await applyTaskLinkageCommands('task_1', 'coder', 'coder', response, noOpLog, deps);

    assert.equal(state.calls.createPullRequest, 1);
    assert.equal(state.calls.attachPullRequest, 1);
    assert.equal(state.linkage.pullRequestNumber, 42);
    assert.equal(state.linkage.pullRequestUrl, 'https://github.com/acme/repo/pull/42');
    assert.ok(!cleaned.includes('[task_linkage'));
});

test('rejected invalid-role command does not mutate linkage', async () => {
    const { state, deps } = makeHarness();
    const snapshot = { ...state.linkage };
    const response = '[task_linkage action="create_git_branch" repo="acme/repo" baseBranch="main" workingBranch="feature/x"]';
    await applyTaskLinkageCommands('task_1', 'pm', 'pm', response, noOpLog, deps);

    assert.deepEqual(state.linkage, snapshot);
    assert.equal(state.calls.createBranch, 0);
    assert.equal(state.calls.attachGitBranch, 0);
});

test('rejected missing-field command does not mutate linkage', async () => {
    const { state, deps } = makeHarness();
    const snapshot = { ...state.linkage };
    const response = '[task_linkage action="create_pull_request" repo="acme/repo" description="Desc" headBranch="feature/x" baseBranch="main"]';
    await applyTaskLinkageCommands('task_1', 'coder', 'coder', response, noOpLog, deps);

    assert.deepEqual(state.linkage, snapshot);
    assert.equal(state.calls.createPullRequest, 0);
    assert.equal(state.calls.attachPullRequest, 0);
});

test('rejected duplicate/state-guard command does not mutate linkage', async () => {
    const { state, deps } = makeHarness({ pullRequestNumber: 10, pullRequestUrl: 'https://github.com/acme/repo/pull/10' });
    const snapshot = { ...state.linkage };
    const response = '[task_linkage action="create_pull_request" repo="acme/repo" title="New PR" description="Desc" headBranch="feature/x" baseBranch="main"]';
    await applyTaskLinkageCommands('task_1', 'coder', 'coder', response, noOpLog, deps);

    assert.deepEqual(state.linkage, snapshot);
    assert.equal(state.calls.createPullRequest, 0);
    assert.equal(state.calls.attachPullRequest, 0);
});

test('response cleanup strips all task_linkage tags from user-facing text', async () => {
    const { deps } = makeHarness();
    const response = [
        'First line',
        '[task_linkage action="attach_linear" linearIssueId="lin_1" linearIssueIdentifier="ENG-1"]',
        'Middle line',
        '[task_linkage action="attach_linear" linearIssueId="lin_2" linearIssueIdentifier="ENG-2"]',
        'Final line',
    ].join('\n');

    const cleaned = await applyTaskLinkageCommands('task_1', 'pm', 'pm', response, noOpLog, deps);
    assert.ok(!cleaned.includes('[task_linkage'));
    assert.ok(cleaned.includes('First line'));
    assert.ok(cleaned.includes('Middle line'));
    assert.ok(cleaned.includes('Final line'));
});
