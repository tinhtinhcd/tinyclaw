const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-ba-architect-guidance-'));
process.env.TINYCLAW_HOME = tempHome;

const {
    createTaskLinkage,
} = require('../dist/lib/task-linkage.js');
const {
    buildTaskLinkageContext,
} = require('../dist/lib/task-linkage-workflow.js');

fs.mkdirSync(tempHome, { recursive: true });
fs.mkdirSync(path.join(tempHome, 'logs'), { recursive: true });

test('BA role gets BA-specific guidance', () => {
    const task = createTaskLinkage({
        title: 'BA guidance task',
        description: 'Need requirement analysis',
    });
    const ctx = buildTaskLinkageContext(task.id, 'ba', () => {});
    assert.ok(ctx.includes('BA guidance: clarify business goals'));
    assert.ok(ctx.includes('acceptance criteria/user-story style outcomes'));
    assert.ok(ctx.includes('Do not behave like coder/reviewer/tester.'));
    assert.ok(ctx.includes('[BA_REQUIREMENTS]'));
    assert.ok(ctx.includes('Business Goal:'));
    assert.ok(ctx.includes('Acceptance Criteria:'));
    assert.ok(ctx.includes('[/BA_REQUIREMENTS]'));
});

test('Architect role gets Architect-specific guidance', () => {
    const task = createTaskLinkage({
        title: 'Architect guidance task',
        description: 'Need technical design',
    });
    const ctx = buildTaskLinkageContext(task.id, 'architect', () => {});
    assert.ok(ctx.includes('Architect guidance: produce implementation-oriented technical design before coding.'));
    assert.ok(ctx.includes('Define components/modules/services'));
    assert.ok(ctx.includes('Do not act as reviewer/tester'));
    assert.ok(ctx.includes('[ARCHITECT_DESIGN]'));
    assert.ok(ctx.includes('System Goal:'));
    assert.ok(ctx.includes('Implementation Plan:'));
    assert.ok(ctx.includes('[/ARCHITECT_DESIGN]'));
});
