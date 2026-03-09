# TinyClaw Code Map

## Core Runtime

src/
queue-processor.ts      → main orchestration loop
routing.ts              → parse agent/team mentions
conversation.ts         → conversation locking
db.ts                   → SQLite queue

Team workflow support:
dev_pipeline mode       → PM → Coder → Reviewer → Tester (strict sequence)

## AI Invocation

src/lib/
invoke.ts               → run Claude/Codex CLI
config.ts               → agent configuration
plugins.ts              → plugin loader

## API Server

src/server/
index.ts                → main server
routes/
agents.ts
teams.ts
tasks.ts
messages.ts
logs.ts

## UI

tinyoffice/
frontend dashboard

## Ignore For Now

node_modules/
docs/
tests/
