const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-coder-cli-test-'));
const tempBin = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-coder-cli-bin-'));
process.env.TINYCLAW_HOME = tempHome;
process.env.CODER_WORKER_MODE = 'cursor_cli';
process.env.CODER_WORKER_CLI_CMD = 'node';

const workerScript = path.join(tempBin, 'mock-coder-worker.js');
fs.writeFileSync(workerScript, `
const fs = require('fs');
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const mode = process.env.MOCK_CODER_WORKER_MODE || 'success';
  const stateFile = process.env.MOCK_CODER_WORKER_STATE_FILE;
  if (mode === 'fail') {
    console.error('mock failure');
    process.exit(2);
    return;
  }
  if (mode === 'timeout') {
    setTimeout(() => process.stdout.write('late output'), 2000);
    return;
  }
  if (mode === 'malformed_json') {
    process.stdout.write(JSON.stringify({
      summary: 123,
      branch: true
    }));
    return;
  }
  if (mode === 'numeric_pr') {
    process.stdout.write(JSON.stringify({
      summary: 'numeric pr complete',
      branch: payload.workingBranch || 'feature/numeric-pr',
      pullRequestNumber: '88',
      pullRequestUrl: 'https://github.com/acme/repo/pull/88'
    }));
    return;
  }
  if (mode === 'plain_text') {
    process.stdout.write('plain text summary from worker');
    return;
  }
  if (mode === 'fail_once_then_success') {
    let count = 0;
    if (stateFile && fs.existsSync(stateFile)) {
      count = Number(fs.readFileSync(stateFile, 'utf8') || '0');
    }
    count += 1;
    if (stateFile) fs.writeFileSync(stateFile, String(count));
    if (count === 1) {
      console.error('transient failure');
      process.exit(2);
      return;
    }
  }
  if (mode === 'partial') {
    process.stdout.write(JSON.stringify({
      summary: 'partial execution complete',
      branch: payload.workingBranch || 'feature/partial-branch'
    }));
    return;
  }
  process.stdout.write(JSON.stringify({
    summary: 'full execution complete',
    branch: payload.workingBranch || 'feature/full-branch',
    pullRequestNumber: 77,
    pullRequestUrl: 'https://github.com/acme/repo/pull/77',
    notes: 'mocked full result'
  }));
});
`);
process.env.CODER_WORKER_CLI_ARGS_JSON = JSON.stringify([workerScript]);

fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-coder-cli-test' },
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

const { initQueueDb, getResponsesForChannel, closeQueueDb } = require('../dist/lib/db.js');
const { processMessageForTest } = require('../dist/queue-processor.js');
const { createTaskLinkage, attachGitBranch, getTaskLinkageBySlackThread } = require('../dist/lib/task-linkage.js');
const { onEvent } = require('../dist/lib/logging.js');

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
        sender: 'slack:U-cli',
        sender_id: 'U-cli',
        message: text,
        agent: 'coder',
        files: null,
        conversation_id: null,
        from_agent: null,
        source: 'slack',
        source_metadata: JSON.stringify({
            channelId,
            threadTs,
            userId: 'U-cli',
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
const eventBuffer = [];
onEvent((type, data) => {
    eventBuffer.push({ type, data });
});

test('cursor_cli success attaches branch and PR linkage', async () => {
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'success';
    const task = createTaskLinkage({
        title: 'cli success',
        slackChannelId: 'C-cli-1',
        slackThreadTs: 'T-cli-1',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const dbMsg = buildSlackDbMessage(9101, 'msg_cli_success', 'Implement with cli worker', 'C-cli-1', 'T-cli-1');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const linkage = getTaskLinkageBySlackThread('C-cli-1', 'T-cli-1');
    assert.equal(linkage.workingBranch, 'feature/full-branch');
    assert.equal(linkage.pullRequestNumber, 77);
    assert.equal(linkage.pullRequestUrl, 'https://github.com/acme/repo/pull/77');
});

test('cursor_cli partial result only attaches available fields', async () => {
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'partial';
    const task = createTaskLinkage({
        title: 'cli partial',
        slackChannelId: 'C-cli-2',
        slackThreadTs: 'T-cli-2',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const dbMsg = buildSlackDbMessage(9102, 'msg_cli_partial', 'Implement partially', 'C-cli-2', 'T-cli-2');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const linkage = getTaskLinkageBySlackThread('C-cli-2', 'T-cli-2');
    assert.equal(linkage.workingBranch, 'feature/partial-branch');
    assert.equal(linkage.pullRequestNumber, undefined);
    assert.equal(linkage.pullRequestUrl, undefined);
});

test('cursor_cli failure does not corrupt linkage and fails clearly', async () => {
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'fail';
    const task = createTaskLinkage({
        title: 'cli fail',
        slackChannelId: 'C-cli-3',
        slackThreadTs: 'T-cli-3',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const dbMsg = buildSlackDbMessage(9103, 'msg_cli_fail', 'Implement but fail', 'C-cli-3', 'T-cli-3');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const linkage = getTaskLinkageBySlackThread('C-cli-3', 'T-cli-3');
    assert.equal(linkage.workingBranch, '');
    assert.equal(linkage.pullRequestNumber, undefined);
    assert.equal(linkage.pullRequestUrl, undefined);

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_cli_fail');
    assert.ok(resp);
    assert.ok(resp.message.includes('Sorry, I encountered an error processing your request.'));
});

test('cursor_cli malformed JSON output fails validation clearly', async () => {
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'malformed_json';
    const task = createTaskLinkage({
        title: 'cli malformed',
        slackChannelId: 'C-cli-4',
        slackThreadTs: 'T-cli-4',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const dbMsg = buildSlackDbMessage(9104, 'msg_cli_malformed', 'Implement malformed', 'C-cli-4', 'T-cli-4');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const linkage = getTaskLinkageBySlackThread('C-cli-4', 'T-cli-4');
    assert.equal(linkage.workingBranch, '');
    assert.equal(linkage.pullRequestNumber, undefined);
    assert.equal(linkage.pullRequestUrl, undefined);

    const responses = getResponsesForChannel('slack');
    const resp = responses.find(r => r.message_id === 'msg_cli_malformed');
    assert.ok(resp);
    assert.ok(resp.message.includes('Sorry, I encountered an error processing your request.'));
});

test('cursor_cli accepts numeric-string PR number and normalizes it', async () => {
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'numeric_pr';
    const task = createTaskLinkage({
        title: 'cli numeric pr',
        slackChannelId: 'C-cli-5',
        slackThreadTs: 'T-cli-5',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const dbMsg = buildSlackDbMessage(9105, 'msg_cli_numeric_pr', 'Implement numeric pr', 'C-cli-5', 'T-cli-5');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const linkage = getTaskLinkageBySlackThread('C-cli-5', 'T-cli-5');
    assert.equal(linkage.pullRequestNumber, 88);
    assert.equal(linkage.pullRequestUrl, 'https://github.com/acme/repo/pull/88');
});

test('cursor_cli timeout fails clearly without linkage corruption', async () => {
    process.env.CODER_WORKER_TIMEOUT_MS = '100';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'timeout';
    const task = createTaskLinkage({
        title: 'cli timeout',
        slackChannelId: 'C-cli-6',
        slackThreadTs: 'T-cli-6',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const dbMsg = buildSlackDbMessage(9106, 'msg_cli_timeout', 'Implement timeout', 'C-cli-6', 'T-cli-6');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const linkage = getTaskLinkageBySlackThread('C-cli-6', 'T-cli-6');
    assert.equal(linkage.workingBranch, '');
    assert.equal(linkage.pullRequestNumber, undefined);
    assert.equal(linkage.pullRequestUrl, undefined);
});

test('cursor_cli retry recovers from transient execution failure', async () => {
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '1';
    process.env.MOCK_CODER_WORKER_MODE = 'fail_once_then_success';
    process.env.MOCK_CODER_WORKER_STATE_FILE = path.join(tempBin, 'retry-count.txt');
    try { fs.unlinkSync(process.env.MOCK_CODER_WORKER_STATE_FILE); } catch {}
    const task = createTaskLinkage({
        title: 'cli retry',
        slackChannelId: 'C-cli-7',
        slackThreadTs: 'T-cli-7',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });

    const dbMsg = buildSlackDbMessage(9107, 'msg_cli_retry', 'Implement retry', 'C-cli-7', 'T-cli-7');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });

    const linkage = getTaskLinkageBySlackThread('C-cli-7', 'T-cli-7');
    assert.equal(linkage.workingBranch, 'feature/full-branch');
    assert.equal(linkage.pullRequestNumber, 77);
    assert.equal(linkage.pullRequestUrl, 'https://github.com/acme/repo/pull/77');
});

test('cursor_cli structured mode rejects plain text stdout', async () => {
    eventBuffer.length = 0;
    process.env.CODER_WORKER_OUTPUT_MODE = 'structured';
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'plain_text';
    const task = createTaskLinkage({
        title: 'cli structured plain text reject',
        slackChannelId: 'C-cli-8',
        slackThreadTs: 'T-cli-8',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });
    const dbMsg = buildSlackDbMessage(9108, 'msg_cli_plaintext_reject', 'Implement plain text reject', 'C-cli-8', 'T-cli-8');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });
    const linkage = getTaskLinkageBySlackThread('C-cli-8', 'T-cli-8');
    assert.equal(linkage.workingBranch, '');
    assert.equal(linkage.pullRequestNumber, undefined);
    const resp = getResponsesForChannel('slack').find(r => r.message_id === 'msg_cli_plaintext_reject');
    assert.ok(resp);
    assert.ok(resp.message.includes('Sorry, I encountered an error processing your request.'));
    assert.equal(eventBuffer.some(e => e.type === 'worker.output_parse_failed' && e.data.taskId === linkage.taskId), true);
});

test('cursor_cli summary mode accepts plain text stdout', async () => {
    eventBuffer.length = 0;
    process.env.CODER_WORKER_OUTPUT_MODE = 'summary';
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'plain_text';
    const task = createTaskLinkage({
        title: 'cli summary plain text accept',
        slackChannelId: 'C-cli-9',
        slackThreadTs: 'T-cli-9',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });
    const dbMsg = buildSlackDbMessage(9109, 'msg_cli_plaintext_accept', 'Implement plain text accept', 'C-cli-9', 'T-cli-9');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });
    const resp = getResponsesForChannel('slack').find(r => r.message_id === 'msg_cli_plaintext_accept');
    assert.ok(resp);
    assert.ok(resp.message.includes('plain text summary from worker'));
    assert.equal(eventBuffer.some(e => e.type === 'worker.succeeded' && e.data.taskId === task.id && e.data.metadata?.summaryOnly === true), true);
});

test('invalid CODER_WORKER_CLI_ARGS_JSON emits config error event', async () => {
    eventBuffer.length = 0;
    process.env.CODER_WORKER_OUTPUT_MODE = 'structured';
    process.env.CODER_WORKER_CLI_ARGS_JSON = '{"bad":true';
    process.env.CODER_WORKER_TIMEOUT_MS = '5000';
    process.env.CODER_WORKER_MAX_RETRIES = '0';
    process.env.MOCK_CODER_WORKER_MODE = 'success';
    const task = createTaskLinkage({
        title: 'cli invalid args config',
        slackChannelId: 'C-cli-10',
        slackThreadTs: 'T-cli-10',
        currentOwnerAgentId: 'coder',
        status: 'in_progress',
    });
    attachGitBranch(task.id, {
        gitProvider: 'github',
        repo: 'acme/repo',
        baseBranch: 'main',
        workingBranch: '',
    });
    const dbMsg = buildSlackDbMessage(9110, 'msg_cli_bad_args', 'Implement bad args', 'C-cli-10', 'T-cli-10');
    await processMessageForTest(dbMsg, [], {
        runIncomingHooksFn: passthroughIncoming,
        runOutgoingHooksFn: passthroughOutgoing,
    });
    const resp = getResponsesForChannel('slack').find(r => r.message_id === 'msg_cli_bad_args');
    assert.ok(resp);
    assert.ok(resp.message.includes('Sorry, I encountered an error processing your request.'));
    assert.equal(eventBuffer.some(e => e.type === 'worker.args_config_invalid' && e.data.taskId === task.id), true);
    process.env.CODER_WORKER_CLI_ARGS_JSON = JSON.stringify([workerScript]);
});

test.after(() => {
    closeQueueDb();
    delete process.env.MOCK_CODER_WORKER_MODE;
    delete process.env.MOCK_CODER_WORKER_STATE_FILE;
    delete process.env.CODER_WORKER_MODE;
    delete process.env.CODER_WORKER_CLI_CMD;
    delete process.env.CODER_WORKER_CLI_ARGS_JSON;
    delete process.env.CODER_WORKER_TIMEOUT_MS;
    delete process.env.CODER_WORKER_MAX_RETRIES;
    delete process.env.CODER_WORKER_OUTPUT_MODE;
});
