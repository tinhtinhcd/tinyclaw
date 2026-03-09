# Runtime Hardening Notes

## 1) Incoming hook ordering

### Change
- Incoming hooks now run on the routed/batched message **before** internal runtime context is injected.
- Internal blocks are appended after hooks:
  - `[TASK_LINKAGE_CONTEXT]`
  - `[REVIEWER_FETCHED_PR_CONTEXT]`
  - `[TESTER_FETCHED_PR_CONTEXT]`
  - `[TESTER_SYNTHESIZED_FOCUS]`

### Why
- Prevents plugin/incoming hook logic from reading or mutating internal orchestration context.
- Keeps hooks focused on user/system message content.

## 2) Stricter coder worker stdout contract

### Change
- `cursor_cli` worker now supports explicit output modes:
  - `CODER_WORKER_OUTPUT_MODE=structured` (default): stdout must be one valid JSON object.
  - `CODER_WORKER_OUTPUT_MODE=summary`: plain text stdout is accepted as summary-only fallback.
- In structured mode, non-JSON/noisy stdout now fails clearly.
- Structured fields remain validated (`summary`, `branch`, `pullRequestUrl`, `pullRequestNumber`, `notes`, `raw`).

### Why
- Prevents silent loss of branch/PR structured data when worker stdout is malformed.
- Encourages worker logs to go to `stderr`, leaving stdout for machine-readable result payloads.

### Config hardening
- `CODER_WORKER_CLI_ARGS_JSON` is now strict:
  - must be valid JSON
  - must be an array of strings
- Invalid values emit an observability error event and fail clearly.

## 3) Explicit-role-first workflow role detection

### Detection priority
1. explicit `agent.role` (`pm|coder|reviewer|tester`)
2. explicit mapped role (workflow mapping path)
3. legacy heuristic fallback via `agentId` substrings
4. `unknown`

### Backward compatibility
- Legacy IDs still work through heuristics.
- If heuristics are used, a warning observability event is emitted.
- If an explicit but invalid `agent.role` is configured, role resolves to `unknown` (safe/read-only path) and does not heuristic-override it.

## 4) New warnings/events

- `workflow_role_heuristic_fallback`
- `workflow_role_invalid_explicit`
- `worker_args_config_invalid`
- `worker_output_mode_invalid`
- `worker_output_parse_failed`

## 5) Current limitations

- Structured mode currently expects plain JSON object on stdout (no envelope protocol yet).
- No dedicated worker schema versioning yet.
- No persistent event store; relies on current event bus/log/SSE path.
