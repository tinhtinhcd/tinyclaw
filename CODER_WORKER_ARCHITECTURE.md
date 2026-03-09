# Coder Worker Architecture

## Why Delegate Coder

TinyClaw keeps PM/Reviewer/Tester as native orchestration agents, but Coder may need a stronger coding executor path (such as Cursor).  
Delegation allows real coding work while keeping TinyClaw as:

- orchestration runtime,
- source of truth for task linkage,
- owner of cross-system state (Slack/Linear/Git/PR).

## Abstraction

Path: `src/integrations/coder/`

- `coder-worker.ts`
  - `CodingWorker` interface
  - `CodingWorkerTaskInput`
  - `CodingWorkerTaskResult`
  - `getCodingWorker()` factory (env-driven)
- `cursor-worker.ts`
  - `CursorCodingWorker` MVP implementation (`cursor_handoff`)
- `cli-worker.ts`
  - `CursorCliCodingWorker` executable worker (`cursor_cli`)
  - runs local CLI command with JSON input/output contract

Interface:

```ts
interface CodingWorker {
  runTask(input: CodingWorkerTaskInput): Promise<CodingWorkerTaskResult>;
}
```

## Where Delegation Happens

Delegation hook is in `src/queue-processor.ts` during `processMessage`:

1. Role/linkage is resolved.
2. If role is `coder` and `CODER_WORKER_MODE` resolves to a worker:
   - build worker input from shared linkage + current prompt context;
   - execute worker;
   - attach returned branch/PR info to linkage when present;
   - use worker summary as coder response.
3. Otherwise fallback to normal native `invokeAgent(...)`.

No Slack or queue redesign is required.

## Worker Modes

- `CODER_WORKER_MODE=off` (or unset): native coder agent invocation
- `CODER_WORKER_MODE=cursor_handoff`: structured handoff summary only
- `CODER_WORKER_MODE=cursor_cli` (or `external_worker` alias): local executable worker mode

### `cursor_cli` Configuration

- `CODER_WORKER_CLI_CMD` (default: `cursor`)
- `CODER_WORKER_CLI_ARGS_JSON` (JSON string array; example: `["worker","run","--json"]`)
- `CODER_WORKER_TIMEOUT_MS` (default: `60000`)
- `CODER_WORKER_MAX_RETRIES` (default: `0`)

Runtime passes `CodingWorkerTaskInput` JSON to worker stdin.
Expected stdout is JSON containing:

- `summary` (required for good UX; fallback text used if missing)
- optional `branch`
- optional `pullRequestNumber`
- optional `pullRequestUrl`
- optional `notes`

If stdout is non-JSON, output is treated as summary-only text.
If command exits non-zero, coder step fails clearly and linkage is not forcibly mutated.

## Output Validation Rules

For JSON worker output:

- `summary` must be string when present
- `branch` must be string when present
- `pullRequestUrl` must be string when present
- `pullRequestNumber` must be positive integer or numeric string when present
- `notes` must be string when present

Invalid JSON field types are treated as validation failures (not silently accepted).
Numeric-string PR numbers are normalized to numbers.

## Timeout and Retry Behavior

- Worker process is terminated if it exceeds `CODER_WORKER_TIMEOUT_MS`.
- Retry logic applies to execution failures/timeouts only.
- Retries are capped by `CODER_WORKER_MAX_RETRIES`.
- Validation failures are not retried (they indicate bad worker contract output).
- On final failure, TinyClaw returns coder error response and does not attach fabricated linkage values.

## Linkage Reuse

Coder worker input reuses shared linkage fields:

- `taskId`
- `repo`
- `baseBranch`
- `workingBranch`
- `linearIssueIdentifier`
- Slack thread metadata when available

If worker returns:

- `branch` -> backend attaches git branch linkage
- `pullRequestNumber` + `pullRequestUrl` -> backend attaches PR linkage

## MVP vs Future

### MVP now

- `cursor_handoff` worker produces structured delegation output
- `cursor_cli` provides real executable delegation via local command runner
- backend integration point is stable and testable
- no Cursor cloud/API hard dependency required (local CLI contract first)

### Future

- harden `cursor_cli` contract tooling and retries
- add a first-party Cursor executor with richer status artifacts
- add richer execution status callbacks
- optional streaming updates back to Slack thread
- stronger acceptance-criteria parsing and execution planning

## Current Limitations

- `cursor_cli` assumes worker command availability on host machine.
- PR auto-attachment requires worker to return both `pullRequestNumber` and `pullRequestUrl`.
- TinyClaw does not yet validate that returned branch/PR actually exist remotely.
- Retry attempts are process-level retries; there is no backoff policy yet.
