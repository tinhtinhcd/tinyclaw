const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateTaskLinkageCommand, detectWorkflowRole } = require('../dist/lib/task-linkage-workflow.js');
const { onEvent } = require('../dist/lib/logging.js');

function baseLinkage() {
    return {
        taskId: 'task_1',
        status: 'in_progress',
    };
}

const emittedEvents = [];
onEvent((type, data) => {
    emittedEvents.push({ type, data });
});

test('PM role permissions', async (t) => {
    await t.test('accepts create_linear_issue', () => {
        const decision = evaluateTaskLinkageCommand('pm', 'create_linear_issue', {
            title: 'Fix parser',
            description: 'Handle malformed payload',
            teamId: 'team-1',
        }, baseLinkage());
        assert.equal(decision.accepted, true);
    });

    await t.test('accepts attach_linear', () => {
        const decision = evaluateTaskLinkageCommand('pm', 'attach_linear', {
            linearIssueId: 'issue-1',
            linearIssueIdentifier: 'ENG-1',
        }, baseLinkage());
        assert.equal(decision.accepted, true);
    });

    await t.test('rejects create_git_branch', () => {
        const decision = evaluateTaskLinkageCommand('pm', 'create_git_branch', {
            repo: 'org/repo',
            baseBranch: 'main',
            workingBranch: 'feature/x',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });

    await t.test('rejects create_pull_request', () => {
        const decision = evaluateTaskLinkageCommand('pm', 'create_pull_request', {
            repo: 'org/repo',
            title: 'PR',
            description: 'Desc',
            headBranch: 'feature/x',
            baseBranch: 'main',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });
});

test('Coder role permissions', async (t) => {
    await t.test('accepts create_git_branch', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'create_git_branch', {
            repo: 'org/repo',
            baseBranch: 'main',
            workingBranch: 'feature/x',
        }, baseLinkage());
        assert.equal(decision.accepted, true);
    });

    await t.test('accepts attach_git_branch', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'attach_git_branch', {
            repo: 'org/repo',
            baseBranch: 'main',
            workingBranch: 'feature/x',
            gitProvider: 'github',
        }, baseLinkage());
        assert.equal(decision.accepted, true);
    });

    await t.test('accepts create_pull_request', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'create_pull_request', {
            repo: 'org/repo',
            title: 'PR',
            description: 'Desc',
            headBranch: 'feature/x',
            baseBranch: 'main',
        }, baseLinkage());
        assert.equal(decision.accepted, true);
    });

    await t.test('rejects create_linear_issue', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'create_linear_issue', {
            title: 'Fix parser',
            description: 'Handle malformed payload',
            teamId: 'team-1',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });
});

test('Reviewer and Tester are read-only for mutation commands', async (t) => {
    const mutationCommands = [
        { action: 'create_linear_issue', attrs: { title: 't', description: 'd', teamId: 'team' } },
        { action: 'attach_linear', attrs: { linearIssueId: 'id', linearIssueIdentifier: 'ENG-1' } },
        { action: 'create_git_branch', attrs: { repo: 'org/repo', baseBranch: 'main', workingBranch: 'feature/x' } },
        { action: 'attach_git_branch', attrs: { repo: 'org/repo', baseBranch: 'main', workingBranch: 'feature/x' } },
        { action: 'create_pull_request', attrs: { repo: 'org/repo', title: 'PR', description: 'd', headBranch: 'h', baseBranch: 'b' } },
        { action: 'attach_pull_request', attrs: { pullRequestNumber: '10', pullRequestUrl: 'https://example.com' } },
    ];

    for (const role of ['reviewer', 'tester']) {
        for (const cmd of mutationCommands) {
            await t.test(`${role} rejects ${cmd.action}`, () => {
                const decision = evaluateTaskLinkageCommand(role, cmd.action, cmd.attrs, baseLinkage());
                assert.equal(decision.accepted, false);
            });
        }
    }
});

test('Payload validation matrix', async (t) => {
    await t.test('create_linear_issue missing title -> reject', () => {
        const decision = evaluateTaskLinkageCommand('pm', 'create_linear_issue', {
            description: 'Desc',
            teamId: 'team-1',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });

    await t.test('create_linear_issue missing description -> reject', () => {
        const decision = evaluateTaskLinkageCommand('pm', 'create_linear_issue', {
            title: 'Title',
            teamId: 'team-1',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });

    await t.test('attach_git_branch missing repo -> reject', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'attach_git_branch', {
            baseBranch: 'main',
            workingBranch: 'feature/x',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });

    await t.test('attach_git_branch missing workingBranch -> reject', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'attach_git_branch', {
            repo: 'org/repo',
            baseBranch: 'main',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });

    await t.test('create_pull_request missing title -> reject', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'create_pull_request', {
            repo: 'org/repo',
            description: 'Desc',
            headBranch: 'feature/x',
            baseBranch: 'main',
        }, baseLinkage());
        assert.equal(decision.accepted, false);
    });

    await t.test('attach_pull_request missing pullRequestNumber and pullRequestUrl -> reject', () => {
        const decision = evaluateTaskLinkageCommand('coder', 'attach_pull_request', {}, baseLinkage());
        assert.equal(decision.accepted, false);
    });
});

test('State guards and overwrite behavior', async (t) => {
    await t.test('reject duplicate Linear creation when already linked', () => {
        const linkage = { ...baseLinkage(), linearIssueId: 'existing', linearIssueIdentifier: 'ENG-1' };
        const decision = evaluateTaskLinkageCommand('pm', 'create_linear_issue', {
            title: 'New issue',
            description: 'Desc',
            teamId: 'team-1',
        }, linkage);
        assert.equal(decision.accepted, false);
    });

    await t.test('allow Linear creation overwrite with force=true', () => {
        const linkage = { ...baseLinkage(), linearIssueId: 'existing', linearIssueIdentifier: 'ENG-1' };
        const decision = evaluateTaskLinkageCommand('pm', 'create_linear_issue', {
            title: 'New issue',
            description: 'Desc',
            teamId: 'team-1',
            force: 'true',
        }, linkage);
        assert.equal(decision.accepted, true);
    });

    await t.test('reject duplicate branch creation when workingBranch already linked', () => {
        const linkage = { ...baseLinkage(), repo: 'org/repo', baseBranch: 'main', workingBranch: 'feature/existing' };
        const decision = evaluateTaskLinkageCommand('coder', 'create_git_branch', {
            repo: 'org/repo',
            baseBranch: 'main',
            workingBranch: 'feature/new',
        }, linkage);
        assert.equal(decision.accepted, false);
    });

    await t.test('allow branch overwrite with allowOverwrite=true', () => {
        const linkage = { ...baseLinkage(), repo: 'org/repo', baseBranch: 'main', workingBranch: 'feature/existing' };
        const decision = evaluateTaskLinkageCommand('coder', 'create_git_branch', {
            repo: 'org/repo',
            baseBranch: 'main',
            workingBranch: 'feature/new',
            allowOverwrite: 'true',
        }, linkage);
        assert.equal(decision.accepted, true);
    });

    await t.test('reject duplicate PR creation when PR already linked', () => {
        const linkage = { ...baseLinkage(), pullRequestNumber: 22, pullRequestUrl: 'https://example.com/pr/22' };
        const decision = evaluateTaskLinkageCommand('coder', 'create_pull_request', {
            repo: 'org/repo',
            title: 'PR',
            description: 'Desc',
            headBranch: 'feature/x',
            baseBranch: 'main',
        }, linkage);
        assert.equal(decision.accepted, false);
    });

    await t.test('allow PR creation overwrite with force=true', () => {
        const linkage = { ...baseLinkage(), pullRequestNumber: 22, pullRequestUrl: 'https://example.com/pr/22' };
        const decision = evaluateTaskLinkageCommand('coder', 'create_pull_request', {
            repo: 'org/repo',
            title: 'PR',
            description: 'Desc',
            headBranch: 'feature/x',
            baseBranch: 'main',
            force: 'true',
        }, linkage);
        assert.equal(decision.accepted, true);
    });
});

test('Role detection prefers explicit role over heuristics', () => {
    emittedEvents.length = 0;
    const role = detectWorkflowRole('coder-bot', {
        name: 'Agent',
        role: 'reviewer',
        working_directory: '.',
    });
    assert.equal(role, 'reviewer');
    assert.equal(emittedEvents.some(e => e.type === 'role_detect.heuristic_fallback'), false);
});

test('Role detection heuristic fallback still works for legacy IDs', () => {
    emittedEvents.length = 0;
    const role = detectWorkflowRole('qa_legacy_bot', {
        name: 'Agent',
        working_directory: '.',
    });
    assert.equal(role, 'tester');
    assert.equal(emittedEvents.some(e => e.type === 'role_detect.heuristic_fallback'), true);
});

test('Role detection accepts explicit custom role names', () => {
    emittedEvents.length = 0;
    const role = detectWorkflowRole('dev-agent', {
        name: 'Agent',
        role: 'team_lead',
        working_directory: '.',
    });
    assert.equal(role, 'team_lead');
    assert.equal(emittedEvents.some(e => e.type === 'role_detect.invalid_explicit'), false);
    assert.equal(emittedEvents.some(e => e.type === 'role_detect.heuristic_fallback'), false);
});

test('Role detection maps workflow role pm to scrum_master before heuristics', () => {
    emittedEvents.length = 0;
    const role = detectWorkflowRole('dev-agent', {
        name: 'Agent',
        workflowRole: 'pm',
        working_directory: '.',
    });
    assert.equal(role, 'scrum_master');
    assert.equal(emittedEvents.some(e => e.type === 'role_detect.heuristic_fallback'), false);
});
