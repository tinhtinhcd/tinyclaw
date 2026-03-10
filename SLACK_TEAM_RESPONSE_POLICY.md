# Slack Team Response Policy

## What was happening before

For team-chain conversations, runtime completion aggregated all agent outputs into one final public message:

- `@pm: ...`
- `@coder: ...`
- (and so on)

This caused internal handoff transcript style content to appear directly in Slack threads.

## Policy now

Public team-chain content follows a single explicit policy:

- Default: `final_agent_only`
- The final public message uses only the final active role's response.
- Per-role status updates are still emitted separately (via `chain_step_start` event consumers such as Slack status posting).

Optional override:

- Set `TEAM_PUBLIC_RESPONSE_POLICY=aggregate` to restore old aggregate behavior.

## What remains visible vs internal

Visible in Slack:

- Stage/status updates per role (PM analyzing, Coder implementing, etc.).
- One final content response from the final role by default.

Internal/system-only:

- Intermediary handoff messages between agents.
- Full multi-step transcript remains in saved chat history and internal runtime events.
