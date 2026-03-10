# Slack Mention Normalization

This document describes how Slack mentions are parsed and routed to TinyClaw agents.

## Canonical Agent IDs

Agents are identified by their **agent id** in settings (e.g. `ba`, `scrum_master`, `coder`). These are the canonical identifiers used internally.

## Supported Aliases

The following aliases map to canonical roles. When a user mentions any of these, the system finds the agent with the matching role.

| Canonical Role | Aliases |
|----------------|---------|
| `scrum_master` | Scrum Master, ScrumMaster, scrum_master, PM, SM |
| `ba` | BA, Business Analyst |
| `architect` | Architect |
| `coder` | Coder, Developer, Dev |
| `reviewer` | Reviewer, Review |
| `tester` | Tester, Test, QA |

Matching is **case-insensitive** and ignores spaces, underscores, and hyphens. So `@Scrum Master`, `@ScrumMaster`, and `@scrum_master` all resolve to the agent with role `scrum_master`.

## Mention Priority Rules

1. **Explicit mention wins** — If the message contains a valid `@mention` that resolves to an agent, that agent is routed. The inbound bot (which channel/DM the message came from) is **ignored**.

2. **Inbound bot fallback** — Only when there is **no** valid explicit mention does the system use the inbound bot mapping. If the message was sent via a bot configured in `role_bot_map` (e.g. the Scrum Master bot), and the user did not mention any agent, the message is routed to that bot's mapped agent.

3. **No mention** — If there is no valid mention and no inbound bot mapping, the user receives a guidance message: "Please mention an agent with @agent_id (e.g. @Scrum Master, @BA) to route your message."

## Display-Name Style Mentions

Slack users often type display names with spaces (e.g. `@Scrum Master`). The parser supports:

- **Multi-word mentions**: `@Scrum Master`, `@Scrum Master` (stops at punctuation or end)
- **Single-word**: `@BA`, `@ScrumMaster`, `@scrum_master`
- **Prefix form**: `@Scrum Master requirements` → routes to Scrum Master, message = "requirements"

## Fallback Behavior

| Scenario | Result |
|----------|--------|
| "hi @Scrum Master" | Routes to Scrum Master |
| "@BA analyze login" | Routes to BA |
| "@BA analyze" via Scrum Master bot DM | Routes to BA (explicit mention wins) |
| "hello" via Scrum Master bot DM | Routes to Scrum Master (bot fallback) |
| "hello" (no bot context) | No agent runs; guidance message shown |

## Implementation Notes

- **routing.ts**: `parseAgentRouting`, `extractMentions`, `resolveMention`, `ROLE_ALIASES`
- **process-message.ts**: Uses `parseAgentRouting`; applies inbound bot fallback only when `routing.agentId === NO_AGENT_MENTIONED`
- **slack-router.ts**: `normalizeSlackMessageText` strips leading app mention (`<@BOT_ID>`) before routing

## Related Files

- `src/lib/routing.ts` — mention extraction, alias resolution
- `src/runtime/process-message.ts` — routing, inbound bot fallback
- `src/integrations/slack/slack-router.ts` — Slack message normalization
