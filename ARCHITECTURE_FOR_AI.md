# TinyClaw Architecture Summary (for AI agents)

## Overview

TinyClaw is a lightweight multi-agent orchestration runtime.

Core components:

* Message queue (SQLite)
* Agent routing system
* Agent-to-agent handoff
* CLI model invocation (Claude / Codex)
* REST API + SSE event stream
* Web dashboard (TinyOffice)

## Execution Flow

User Message
→ Queue (SQLite)
→ Queue Processor
→ Routing (Agent or Team)
→ Invoke AI Provider
→ Parse agent response
→ Detect teammate mentions
→ Enqueue new tasks
→ Broadcast events (SSE)

## Key Modules

### queue-processor.ts

Main runtime loop
Responsibilities:

* fetch message from queue
* route to agent/team
* call model
* detect handoff
* enqueue next message

### invoke.ts

Responsible for executing AI providers:

* Claude CLI
* Codex CLI
* OpenCode CLI

Uses spawn() to run commands.

### routing.ts

Parses:

* @agent
* @team
* [@teammate: message]

### db.ts

SQLite queue implementation:
Tables:

* messages
* responses

Features:

* retry
* dead letter
* stale message recovery

### plugins.ts

Plugin system:
Hooks:

* transformIncoming
* transformOutgoing
* event listeners

### server/

REST API for:

* agents
* teams
* tasks
* logs
* messages

Also exposes SSE events.

## Team Collaboration Model

User → @team
Leader agent receives request.

Agent response may contain:

[@coder: implement feature]

System enqueues message for coder agent.

Chain continues until no pending tasks.

### Optional Dev Pipeline Mode

Teams can now opt into a strict workflow:

PM → Coder → Reviewer → Tester

When `team.workflow.type = "dev_pipeline"`:

* Queue processor enforces stage order automatically.
* Teammate mentions are ignored during that conversation.
* Each stage receives the original user request plus previous stage output.
* Conversation completes after tester finishes (or max message guard triggers).

## Limitations

* No central planner
* Task board not integrated with execution
* Roles enforced mostly by prompts
* Limited dev workflow integrations
