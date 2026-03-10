# Config-Driven Workflows

## Why this change

Workflow stages and team roles are now resolved from configuration instead of fixed role assumptions in runtime flow. This allows adding/removing roles without changing core orchestration code.

## Config shape

You can define role behavior in `settings.json`:

```json
{
  "roles": {
    "scrum_master": { "type": "planning", "readOnly": false, "requiresApprovalToAdvance": true },
    "coder": { "type": "implementation", "readOnly": false },
    "reviewer": { "type": "review", "readOnly": true },
    "tester": { "type": "validation", "readOnly": true }
  }
}
```

You can define workflow templates:

```json
{
  "workflows": {
    "full_team": { "stages": ["ba", "scrum_master", "architect", "coder", "reviewer", "tester"] },
    "dev_only": { "stages": ["coder", "reviewer", "tester"] },
    "scrum_master_dev": { "stages": ["scrum_master", "coder", "reviewer", "tester"] }
  }
}
```

Team workflow binding:

```json
{
  "teams": {
    "dev": {
      "name": "AI Dev Team",
      "agents": ["scrum_master", "coder", "reviewer", "tester"],
      "leader_agent": "scrum_master",
      "workflow": {
        "type": "dev_pipeline",
        "workflowId": "scrum_master_dev"
      }
    }
  }
}
```

You can also inline team stages:

```json
{
  "workflow": {
    "type": "dev_pipeline",
    "stages": ["scrum_master", "coder", "reviewer", "tester"]
  }
}
```

## Approval gate config

Approval is stage-role configurable:

- `requiresApprovalToAdvance: true` on a role means runtime stops after that stage and waits for explicit user approval.
- On approval phrase (`approve`, `go ahead`, `continue`, etc.), pipeline advances to the next configured stage.

## Add a role

1. Add a new role in `roles`.
2. Assign at least one team agent with `agent.role = "<new-role>"`.
3. Add the role to workflow `stages`.

No core pipeline code change is required.

## Remove a role

1. Remove role from workflow `stages`.
2. Keep/remove role definition as needed.
3. Team runs with the new shorter stage sequence.

## Backward compatibility

Legacy team workflow fields are still supported:

```json
{
  "workflow": {
    "type": "dev_pipeline",
    "scrum_master": "scrum_master",
    "coder": "coder",
    "reviewer": "reviewer",
    "tester": "tester"
  }
}
```

## What remains specialized

- Reviewer/tester PR enrichment remains role-specific for `reviewer` and `tester`.
- Coder worker delegation remains role-specific for `coder`.
- Task-linkage mutation contract remains strict for known roles (`scrum_master`, `coder`, `reviewer`, `tester`); unknown roles default to read-only command behavior.
