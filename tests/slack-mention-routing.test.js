/**
 * Tests for Slack mention routing and normalization.
 *
 * - "hi @Scrum Master" routes to Scrum Master
 * - "@BA" routes to BA
 * - explicit @BA mention is not overridden by inbound bot fallback
 * - no mention shows guidance message
 * - alias forms map correctly to canonical role
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-slack-mention-'));
process.env.TINYCLAW_HOME = tempHome;
fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(
    path.join(tempHome, 'settings.json'),
    JSON.stringify(
        {
            workspace: { path: process.cwd(), name: 'slack-mention-test' },
            agents: {
                ba: {
                    name: 'BA',
                    provider: 'openrouter',
                    model: 'openai/gpt-4.1-mini',
                    working_directory: 'ba',
                    role: 'ba',
                },
                scrum_master: {
                    name: 'Scrum Master',
                    provider: 'openrouter',
                    model: 'openai/gpt-4.1-mini',
                    working_directory: 'scrum_master',
                    role: 'scrum_master',
                },
                coder: {
                    name: 'Coder',
                    provider: 'openrouter',
                    model: 'openai/gpt-4.1-mini',
                    working_directory: 'coder',
                    role: 'coder',
                },
            },
            teams: {
                dev: {
                    name: 'Dev Team',
                    agents: ['ba', 'scrum_master', 'coder'],
                    leader_agent: 'ba',
                },
            },
        },
        null,
        2
    )
);

const { parseAgentRouting, NO_AGENT_MENTIONED } = require('../dist/lib/routing.js');

test('hi @Scrum Master routes to Scrum Master', () => {
    const agents = {
        ba: { name: 'BA', provider: 'x', model: 'y', working_directory: 'ba', role: 'ba' },
        scrum_master: { name: 'Scrum Master', provider: 'x', model: 'y', working_directory: 'sm', role: 'scrum_master' },
        coder: { name: 'Coder', provider: 'x', model: 'y', working_directory: 'coder', role: 'coder' },
    };
    const teams = {};
    const r = parseAgentRouting('hi @Scrum Master', agents, teams);
    assert.equal(r.agentId, 'scrum_master');
});

test('@BA routes to BA', () => {
    const agents = {
        ba: { name: 'BA', provider: 'x', model: 'y', working_directory: 'ba', role: 'ba' },
        scrum_master: { name: 'Scrum Master', provider: 'x', model: 'y', working_directory: 'sm', role: 'scrum_master' },
    };
    const teams = {};
    const r = parseAgentRouting('@BA analyze login', agents, teams);
    assert.equal(r.agentId, 'ba');
});

test('alias Scrum Master (space) maps to scrum_master', () => {
    const agents = {
        scrum_master: { name: 'Scrum Master', provider: 'x', model: 'y', working_directory: 'sm', role: 'scrum_master' },
    };
    const teams = {};
    const r = parseAgentRouting('hello @Scrum Master', agents, teams);
    assert.equal(r.agentId, 'scrum_master');
});

test('alias PM maps to scrum_master', () => {
    const agents = {
        scrum_master: { name: 'Scrum Master', provider: 'x', model: 'y', working_directory: 'sm', role: 'scrum_master' },
    };
    const teams = {};
    const r = parseAgentRouting('hello @PM', agents, teams);
    assert.equal(r.agentId, 'scrum_master');
});

test('alias Coder maps to coder', () => {
    const agents = {
        coder: { name: 'Coder', provider: 'x', model: 'y', working_directory: 'coder', role: 'coder' },
    };
    const teams = {};
    const r = parseAgentRouting('@Coder implement feature', agents, teams);
    assert.equal(r.agentId, 'coder');
});

test('no mention returns NO_AGENT_MENTIONED', () => {
    const agents = {
        ba: { name: 'BA', provider: 'x', model: 'y', working_directory: 'ba', role: 'ba' },
    };
    const teams = {};
    const r = parseAgentRouting('hello world', agents, teams);
    assert.equal(r.agentId, NO_AGENT_MENTIONED);
});

test('supports @ScrumMaster and @scrum_master as same agent', () => {
    const agents = {
        scrum_master: { name: 'Scrum Master', provider: 'x', model: 'y', working_directory: 'sm', role: 'scrum_master' },
    };
    const teams = {};
    assert.equal(parseAgentRouting('hi @ScrumMaster', agents, teams).agentId, 'scrum_master');
    assert.equal(parseAgentRouting('hi @scrum_master', agents, teams).agentId, 'scrum_master');
});

test('explicit @BA mention wins (routing unit)', () => {
    const agents = {
        ba: { name: 'BA', provider: 'x', model: 'y', working_directory: 'ba', role: 'ba' },
        scrum_master: { name: 'Scrum Master', provider: 'x', model: 'y', working_directory: 'sm', role: 'scrum_master' },
    };
    const teams = {};
    const r = parseAgentRouting('@BA analyze this', agents, teams);
    assert.equal(r.agentId, 'ba');
});
