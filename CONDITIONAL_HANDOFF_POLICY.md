# Conditional Handoff Policy

This document describes the mention-driven workflow model and conditional handoff targets.

## Overview

Agents run only when explicitly mentioned. Handoff between agents is driven by mentions in agent responses. An agent may hand off to:

1. **Another agent** — next role runs
2. **User** — workflow waits for user input
3. **Nobody** — workflow pauses

## Mention Format

Handoffs use bracket tags:

- `[@agent_id: message]` — hand off to a teammate
- `[@user: message]` — hand off to the user (clarification/approval needed)
- No handoff tag — workflow pauses

Examples:

```
[@scrum_master: Please create the Linear issue for this.]
[@user: Can you confirm the login flow scope?]
```

## Agent → Agent

When an agent mentions a valid next role (e.g. BA mentions `[@scrum_master: ...]`):

- The mentioned agent is enqueued and runs
- Transition is validated against workflow config (e.g. BA may only hand off to scrum_master, not coder)
- Invalid transitions are rejected and logged

## Agent → User

When an agent mentions `[@user: ...]`:

- No next agent is enqueued
- Task/conversation is marked as waiting for user input (`workflowWaitingForUserInput`)
- The user receives the response and can reply when ready
- Workflow resumes when the user sends a new message

Use when:

- Requirements need clarification
- Approval or confirmation is needed
- Blocked on user decision

## No Handoff

When an agent response contains no valid handoff mention:

- No next agent is enqueued
- Workflow pauses at the current state
- Conversation completes; user receives the response

Use when:

- Agent is done but should not advance yet
- Pausing for external events
- Deliberate stop

## Transition Validation

Workflow config defines allowed transitions. For dev_pipeline:

- Each role may hand off only to the **next role in the sequence**
- `user` is always an allowed target
- Invalid transitions (e.g. BA → coder, skipping scrum_master) are rejected

## Role Guidance

Agents receive guidance on when to hand off:

- **BA**: If requirements clear → mention next role. If unclear → mention @user. May stop without handoff.
- **Scrum Master / Architect / Coder / Reviewer**: When ready → mention next role. If blocked → mention @user. May stop without handoff.
- **Tester**: When done → may mention @user or stop. Mention next role only if workflow continues.

## Examples

### Clear requirements

```
BA: [BA_REQUIREMENTS] ... [/BA_REQUIREMENTS]
[@scrum_master: Please create the Linear issue.]
```
→ Scrum Master runs

### Unclear requirements

```
BA: [BA_REQUIREMENTS] Need clarification on scope. [/BA_REQUIREMENTS]
[@user: Can you confirm the login flow scope?]
```
→ Workflow waits for user

### Pause

```
BA: [BA_REQUIREMENTS] Analysis complete. [/BA_REQUIREMENTS]
```
→ No handoff, workflow pauses

### Invalid transition

```
BA: [@coder: Skip scrum master]
```
→ Rejected; BA may only hand off to scrum_master or user

## Greeting / Chat Mode

Simple mentions like `hello @BA` run in **chat mode**:

- Only the mentioned agent replies
- No workflow pipeline starts
- No team progression

Workflow starts only when explicit commands are detected (e.g. "create task", "start working", "implement").
