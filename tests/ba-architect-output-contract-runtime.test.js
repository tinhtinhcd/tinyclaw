const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-ba-architect-contract-'));
process.env.TINYCLAW_HOME = tempHome;

fs.mkdirSync(tempHome, { recursive: true });
fs.mkdirSync(path.join(tempHome, 'logs'), { recursive: true });

const { createTaskLinkage } = require('../dist/lib/task-linkage.js');
const { enrichPromptContext } = require('../dist/runtime/prompt-context.js');

test('architect prompt includes latest BA structured requirements block', async () => {
    const task = createTaskLinkage({
        title: 'Need architecture from BA requirements',
        description: 'user request',
    });
    const upstreamOutputs = [
        [
            '[BA_REQUIREMENTS]',
            'Business Goal:',
            'Improve onboarding conversion',
            'Acceptance Criteria:',
            '- User can complete signup in < 2 min',
            '[/BA_REQUIREMENTS]',
        ].join('\n'),
    ];

    const out = await enrichPromptContext({
        message: 'Please design architecture',
        linkedTaskId: task.id,
        agentId: 'architect',
        agent: {
            name: 'Architect',
            role: 'architect',
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: 'architect',
        },
        teamContext: null,
        log: () => {},
        upstreamOutputs,
    });

    assert.ok(out.message.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(out.message.includes('[BA_REQUIREMENTS_CONTEXT]'));
    assert.ok(out.message.includes('[BA_REQUIREMENTS]'));
    assert.ok(out.message.includes('Improve onboarding conversion'));
});

test('coder prompt includes latest BA + Architect structured blocks', async () => {
    const task = createTaskLinkage({
        title: 'Need coding from architecture',
        description: 'user request',
    });
    const upstreamOutputs = [
        [
            '[BA_REQUIREMENTS]',
            'Business Goal:',
            'Ship invite-only beta',
            '[/BA_REQUIREMENTS]',
        ].join('\n'),
        [
            '[ARCHITECT_DESIGN]',
            'System Goal:',
            'Implement invite token flow',
            'Implementation Plan:',
            '1. API route',
            '2. DB table',
            '[/ARCHITECT_DESIGN]',
        ].join('\n'),
    ];

    const out = await enrichPromptContext({
        message: 'Start implementation',
        linkedTaskId: task.id,
        agentId: 'coder',
        agent: {
            name: 'Coder',
            role: 'coder',
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: 'coder',
        },
        teamContext: null,
        log: () => {},
        upstreamOutputs,
    });

    assert.ok(out.message.includes('[TASK_LINKAGE_CONTEXT]'));
    assert.ok(out.message.includes('[BA_REQUIREMENTS_CONTEXT]'));
    assert.ok(out.message.includes('[ARCHITECT_DESIGN_CONTEXT]'));
    assert.ok(out.message.includes('Ship invite-only beta'));
    assert.ok(out.message.includes('Implement invite token flow'));
});
