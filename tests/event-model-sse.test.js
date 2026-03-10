const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-event-model-'));
process.env.TINYCLAW_HOME = tempHome;
fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(path.join(tempHome, 'settings.json'), JSON.stringify({
    workspace: { path: process.cwd(), name: 'tinyclaw-event-model-test' },
    agents: {},
}, null, 2));

const { emitTinyEvent } = require('../dist/lib/observability.js');
const { onEvent } = require('../dist/lib/logging.js');

test('emitTinyEvent is safe without SSE listeners', () => {
    assert.doesNotThrow(() => {
        emitTinyEvent({
            type: 'worker_started',
            taskId: 'safe_no_listener_task',
            message: 'sanity event',
        });
    });
});

test('legacy event names are normalized with stable payload shape', async () => {
    const captured = [];
    onEvent((type, data) => captured.push({ type, data }));

    emitTinyEvent({
        type: 'workflow_role_heuristic_fallback',
        taskId: 'shape_task',
        agentId: 'coder',
        role: 'coder',
        source: 'runtime',
        status: 'ok',
    });

    const evt = captured.find(e => e.data.taskId === 'shape_task');
    assert.ok(evt);
    assert.equal(evt.type, 'role_detect.heuristic_fallback');
    assert.equal(evt.data.type, 'role_detect.heuristic_fallback');
    assert.equal(typeof evt.data.timestamp, 'string');
    assert.equal(typeof evt.data.metadata, 'object');
    assert.equal(evt.data.agentId, 'coder');
    assert.equal(evt.data.role, 'coder');
    assert.equal(evt.data.source, 'runtime');
    assert.equal(evt.data.status, 'ok');
});

test('SSE bridge emits normalized runtime events', () => {
    const { addSSEClient, removeSSEClient } = require('../dist/server/sse.js');
    const writes = [];
    const fakeRes = {
        write: (chunk) => {
            writes.push(String(chunk));
            return true;
        },
    };

    addSSEClient(fakeRes);
    try {
        emitTinyEvent({
            type: 'linkage_created',
            taskId: 'sse_task',
            message: 'created linkage',
        });
    } finally {
        removeSSEClient(fakeRes);
    }

    assert.ok(writes.some(m => m.includes('event: linkage.created')));
    assert.ok(writes.some(m => m.includes('event: runtime.event')));
    assert.ok(writes.some(m => m.includes('"type":"linkage.created"')));
});
