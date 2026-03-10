/**
 * Tests for strict mention-driven execution.
 *
 * - hello @ScrumMaster → only ScrumMaster runs
 * - hello @BA → only BA runs
 * - BA mentions @ScrumMaster → ScrumMaster runs
 * - message contains no mention → no agent runs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "tinyclaw-mention-"));
process.env.TINYCLAW_HOME = tempHome;
fs.mkdirSync(tempHome, { recursive: true });
fs.writeFileSync(
    path.join(tempHome, "settings.json"),
    JSON.stringify(
        {
            workspace: { path: process.cwd(), name: "mention-test" },
            agents: {
                ba: {
                    name: "BA",
                    provider: "openrouter",
                    model: "openai/gpt-4.1-mini",
                    working_directory: "ba",
                    role: "ba",
                },
                scrum_master: {
                    name: "Scrum Master",
                    provider: "openrouter",
                    model: "openai/gpt-4.1-mini",
                    working_directory: "scrum_master",
                    role: "scrum_master",
                },
            },
            teams: {
                dev: {
                    name: "Dev Team",
                    agents: ["ba", "scrum_master"],
                    leader_agent: "ba",
                },
            },
        },
        null,
        2
    )
);

const { parseAgentRouting, NO_AGENT_MENTIONED } = require("../dist/lib/routing.js");

test("Test 1: hello @ScrumMaster → only ScrumMaster runs", () => {
    const agents = {
        ba: { name: "BA", provider: "x", model: "y", working_directory: "ba" },
        scrum_master: { name: "Scrum Master", provider: "x", model: "y", working_directory: "sm" },
    };
    const teams = {};
    const r = parseAgentRouting("hello @ScrumMaster", agents, teams);
    assert.equal(r.agentId, "scrum_master");
    assert.equal(r.message, "hello @ScrumMaster");
});

test("Test 2: hello @BA → only BA runs", () => {
    const agents = {
        ba: { name: "BA", provider: "x", model: "y", working_directory: "ba" },
        scrum_master: { name: "Scrum Master", provider: "x", model: "y", working_directory: "sm" },
    };
    const teams = {};
    const r = parseAgentRouting("hello @BA", agents, teams);
    assert.equal(r.agentId, "ba");
});

test("Test 3: @scrum_master prefix → ScrumMaster runs", () => {
    const agents = {
        ba: { name: "BA", provider: "x", model: "y", working_directory: "ba" },
        scrum_master: { name: "Scrum Master", provider: "x", model: "y", working_directory: "sm" },
    };
    const teams = {};
    const r = parseAgentRouting("@scrum_master requirements ready", agents, teams);
    assert.equal(r.agentId, "scrum_master");
    assert.equal(r.message, "requirements ready");
});

test("Test 4: message contains no mention → no agent runs", () => {
    const agents = {
        ba: { name: "BA", provider: "x", model: "y", working_directory: "ba" },
        scrum_master: { name: "Scrum Master", provider: "x", model: "y", working_directory: "sm" },
    };
    const teams = {};
    const r = parseAgentRouting("hello world", agents, teams);
    assert.equal(r.agentId, NO_AGENT_MENTIONED);
});

test("Test 5: @ScrumMaster with different casing matches scrum_master", () => {
    const agents = {
        scrum_master: { name: "Scrum Master", provider: "x", model: "y", working_directory: "sm" },
    };
    const teams = {};
    const r = parseAgentRouting("hi @ScrumMaster", agents, teams);
    assert.equal(r.agentId, "scrum_master");
});

test("Test 6: @user is ignored (not an agent)", () => {
    const agents = {
        ba: { name: "BA", provider: "x", model: "y", working_directory: "ba" },
    };
    const teams = {};
    const r = parseAgentRouting("hello @user", agents, teams);
    assert.equal(r.agentId, NO_AGENT_MENTIONED);
});

test("Test 7: @default at start returns NO_AGENT_MENTIONED", () => {
    const agents = {
        ba: { name: "BA", provider: "x", model: "y", working_directory: "ba" },
    };
    const teams = {};
    const r = parseAgentRouting("@default clear", agents, teams);
    assert.equal(r.agentId, NO_AGENT_MENTIONED);
});
