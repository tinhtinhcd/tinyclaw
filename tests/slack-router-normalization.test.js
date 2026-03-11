const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSlackMessageText } = require('../dist/integrations/slack/slack-router.js');
const { parseAgentRouting } = require('../dist/lib/routing.js');

const agents = {
    ba: { name: 'BA', provider: 'x', model: 'y', working_directory: 'ba', role: 'ba' },
    scrum_master: { name: 'Scrum Master', provider: 'x', model: 'y', working_directory: 'sm', role: 'scrum_master' },
};

test('normalizes Slack user mention with display label to routable @mention', () => {
    const normalized = normalizeSlackMessageText('hi <@U123|BA> can you help?');
    const route = parseAgentRouting(normalized, agents, {});

    assert.equal(normalized, 'hi @BA can you help?');
    assert.equal(route.agentId, 'ba');
});

test('strips leading app mention and preserves display-label agent mention', () => {
    const normalized = normalizeSlackMessageText('<@BAPP> hi <@U777|Scrum Master>');
    const route = parseAgentRouting(normalized, agents, {});

    assert.equal(normalized, 'hi @Scrum Master');
    assert.equal(route.agentId, 'scrum_master');
});
