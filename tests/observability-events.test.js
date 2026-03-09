const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-observability-test-'));
const tempBin = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-observability-bin-'));
process.env.TINYCLAW_HOME = tempHome;
fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-observability-test' },
    agents: {
        coder: {
            name: 'Coder',
            role: 'coder',
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: 'coder',
        },
    },
}, null, 2));

const workerScript = path.join(tempBin, 'mock-observability-worker.js');
fs.writeFileSync(workerScript, `
const fs = require('fs');
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const mode = process.env.MOCK_OBS_WORKER_MODE || 'success';
  const stateFile = process.env.MOCK_OBS_STATE_FILE;
  if (mode === 'timeout') {
    setTimeout(() => process.stdout.write('late output'), 1500);
    return;
  }
  if (mode === 'fail_once_then_success') {
    let count = 0;
    if (stateFile && fs.existsSync(stateFile)) count = Number(fs.readFileSync(stateFile, 'utf8') || '0');
    count += 1;
    if (stateFile) fs.writeFileSync(stateFile, String(count));
    if (count === 1) {
      console.error('transient failure');
      process.exit(2);
      return;
    }
  }
  process.stdout.write(JSON.stringify({ summary: 'ok', branch: 'feature/obs', pullRequestNumber: 101, pullRequestUrl: 'https://github.com/acme/repo/pull/101' }));
});
`);

const { onEvent } = require('../dist/lib/logging.js');
const { CursorCliCodingWorker } = require('../dist/integrations/coder/cli-worker.js');
const { applyTaskLinkageCommands, buildRoleFetchedPrContext, synthesizeTesterFocusBlock } = require('../dist/lib/task-linkage-workflow.js');

const captured = [];
onEvent((type, data) => {
    captured.push({ type, data });
});

function resetEvents() {
    captured.length = 0;
}

function findEvent(type, taskId) {
    return captured.find(e => e.type === type && (!taskId || e.data.taskId === taskId));
}

test('coder worker timeout emits structured timeout event', async () => {
    resetEvents();
    process.env.CODER_WORKER_CLI_CMD = 'node';
    process.env.CODER_WORKER_CLI_ARGS_JSON = JSON.stringify([workerScript]);
    process.env.CODER_WORKER_TIMEOUT_MS = '50';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_OBS_WORKER_MODE = 'timeout';
    const worker = new CursorCliCodingWorker();
    await assert.rejects(() => worker.runTask({
        taskId: 'obs_timeout_task',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/obs-timeout',
        prompt: 'run timeout path',
    }));
    assert.ok(findEvent('worker_timeout', 'obs_timeout_task'));
});

test('coder worker retry emits structured retry event', async () => {
    resetEvents();
    process.env.CODER_WORKER_CLI_CMD = 'node';
    process.env.CODER_WORKER_CLI_ARGS_JSON = JSON.stringify([workerScript]);
    process.env.CODER_WORKER_TIMEOUT_MS = '4000';
    process.env.CODER_WORKER_MAX_RETRIES = '1';
    process.env.MOCK_OBS_WORKER_MODE = 'fail_once_then_success';
    process.env.MOCK_OBS_STATE_FILE = path.join(tempBin, 'obs-retry-count.txt');
    try { fs.unlinkSync(process.env.MOCK_OBS_STATE_FILE); } catch {}
    const worker = new CursorCliCodingWorker();
    const result = await worker.runTask({
        taskId: 'obs_retry_task',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: 'feature/obs-retry',
        prompt: 'run retry path',
    });
    assert.equal(result.pullRequestNumber, 101);
    assert.ok(findEvent('worker_retry', 'obs_retry_task'));
});

test('task_linkage command rejection emits structured event', async () => {
    resetEvents();
    const deps = {
        getTaskLinkage: () => ({ taskId: 'obs_cmd_task' }),
        attachLinearIssue: () => { throw new Error('should not call'); },
        attachGitBranch: () => { throw new Error('should not call'); },
        attachPullRequest: () => { throw new Error('should not call'); },
        createIssue: async () => { throw new Error('should not call'); },
        createBranch: async () => { throw new Error('should not call'); },
        createPullRequest: async () => { throw new Error('should not call'); },
    };
    await applyTaskLinkageCommands(
        'obs_cmd_task',
        'reviewer',
        'reviewer',
        '[task_linkage action="attach_pull_request" pullRequestNumber="12" pullRequestUrl="https://github.com/acme/repo/pull/12"]',
        () => {},
        deps,
    );
    const rejected = findEvent('linkage_command_rejected', 'obs_cmd_task');
    assert.ok(rejected);
    assert.ok(String(rejected.data.message || rejected.data.metadata?.reason || '').length > 0);
});

test('reviewer PR fetch failure emits fallback event', async () => {
    resetEvents();
    const context = await buildRoleFetchedPrContext(
        'obs_fetch_task',
        'reviewer',
        () => {},
        {
            getTaskLinkage: () => ({
                taskId: 'obs_fetch_task',
                gitProvider: 'github',
                repo: 'acme/repo',
                pullRequestNumber: 55,
            }),
            getPullRequestDetails: async () => { throw new Error('boom'); },
        },
    );
    assert.equal(context, '');
    assert.ok(findEvent('reviewer_pr_fetch_failed', 'obs_fetch_task'));
    assert.ok(findEvent('reviewer_pr_fetch_fallback_linkage', 'obs_fetch_task'));
});

test('tester synthesized focus generation emits event', () => {
    resetEvents();
    const block = synthesizeTesterFocusBlock({
        taskId: 'obs_focus_task',
        repo: 'acme/repo',
        workingBranch: 'feature/obs',
        prTitle: 'Update API handler',
        files: ['src/api/handler.ts', 'tests/api/handler.test.ts'],
    });
    assert.ok(block.includes('[TESTER_SYNTHESIZED_FOCUS]'));
    assert.ok(findEvent('tester_focus_generated', 'obs_focus_task'));
});

test.after(() => {
    delete process.env.CODER_WORKER_CLI_CMD;
    delete process.env.CODER_WORKER_CLI_ARGS_JSON;
    delete process.env.CODER_WORKER_TIMEOUT_MS;
    delete process.env.CODER_WORKER_MAX_RETRIES;
    delete process.env.MOCK_OBS_WORKER_MODE;
    delete process.env.MOCK_OBS_STATE_FILE;
});
