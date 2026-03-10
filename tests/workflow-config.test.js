const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTeamWorkflow } = require('../dist/runtime/workflow-config.js');

function buildAgents(ids) {
    const out = {};
    for (const [id, role] of ids) {
        out[id] = {
            name: id.toUpperCase(),
            role,
            provider: 'openrouter',
            model: 'openai/gpt-4.1-mini',
            working_directory: id,
        };
    }
    return out;
}

test('full_team workflow resolves ba->scrum_master->architect->coder->reviewer->tester', () => {
    const settings = {
        roles: {
            ba: { type: 'analysis' },
            scrum_master: { type: 'planning', requiresApprovalToAdvance: true },
            architect: { type: 'design' },
            coder: { type: 'implementation' },
            reviewer: { type: 'review', readOnly: true },
            tester: { type: 'validation', readOnly: true },
        },
        workflows: {
            full_team: { stages: ['ba', 'scrum_master', 'architect', 'coder', 'reviewer', 'tester'] },
        },
    };
    const agents = buildAgents([
        ['ba1', 'ba'],
        ['scrum_master1', 'scrum_master'],
        ['arch1', 'architect'],
        ['dev1', 'coder'],
        ['rev1', 'reviewer'],
        ['qa1', 'tester'],
    ]);
    const team = {
        name: 'Full',
        agents: ['ba1', 'scrum_master1', 'arch1', 'dev1', 'rev1', 'qa1'],
        leader_agent: 'scrum_master1',
        workflow: { type: 'dev_pipeline', workflowId: 'full_team' },
    };
    const resolved = resolveTeamWorkflow({
        teamId: 'full',
        team,
        agents,
        settings,
    });
    assert.ok(resolved);
    assert.deepEqual(resolved.stages.map(s => s.role), ['ba', 'scrum_master', 'architect', 'coder', 'reviewer', 'tester']);
    assert.deepEqual(resolved.stages.map(s => s.agentId), ['ba1', 'scrum_master1', 'arch1', 'dev1', 'rev1', 'qa1']);
    assert.equal(resolved.stages[1].requiresApprovalToAdvance, true);
    assert.equal(resolved.stages[4].readOnly, true);
    assert.equal(resolved.stages[5].readOnly, true);
});

test('dev_only and scrum_master_dev workflows resolve from config templates', () => {
    const settings = {
        workflows: {
            dev_only: { stages: ['coder', 'reviewer', 'tester'] },
            scrum_master_dev: { stages: ['scrum_master', 'coder', 'reviewer', 'tester'] },
        },
    };
    const agents = buildAgents([
        ['scrum_master', 'scrum_master'],
        ['coder', 'coder'],
        ['reviewer', 'reviewer'],
        ['tester', 'tester'],
    ]);
    const devOnly = resolveTeamWorkflow({
        teamId: 'dev_only',
        team: {
            name: 'Dev Only',
            agents: ['coder', 'reviewer', 'tester'],
            leader_agent: 'coder',
            workflow: { type: 'dev_pipeline', workflowId: 'dev_only' },
        },
        agents,
        settings,
    });
    assert.ok(devOnly);
    assert.deepEqual(devOnly.stages.map(s => s.role), ['coder', 'reviewer', 'tester']);

    const scrumMasterDev = resolveTeamWorkflow({
        teamId: 'scrum_master_dev',
        team: {
            name: 'ScrumMaster+Dev',
            agents: ['scrum_master', 'coder', 'reviewer', 'tester'],
            leader_agent: 'scrum_master',
            workflow: { type: 'dev_pipeline', workflowId: 'scrum_master_dev' },
        },
        agents,
        settings,
    });
    assert.ok(scrumMasterDev);
    assert.deepEqual(scrumMasterDev.stages.map(s => s.role), ['scrum_master', 'coder', 'reviewer', 'tester']);
});

test('workflow without reviewer remains valid when config removes role', () => {
    const settings = {
        workflows: {
            scrum_master_coder: { stages: ['scrum_master', 'coder'] },
        },
    };
    const agents = buildAgents([
        ['scrum_master', 'scrum_master'],
        ['coder', 'coder'],
    ]);
    const resolved = resolveTeamWorkflow({
        teamId: 'scrum_master_coder',
        team: {
            name: 'Scrum Master Coder',
            agents: ['scrum_master', 'coder'],
            leader_agent: 'scrum_master',
            workflow: { type: 'dev_pipeline', workflowId: 'scrum_master_coder' },
        },
        agents,
        settings,
    });
    assert.ok(resolved);
    assert.deepEqual(resolved.stages.map(s => s.role), ['scrum_master', 'coder']);
});
