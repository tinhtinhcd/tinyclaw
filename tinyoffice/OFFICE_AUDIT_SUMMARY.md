# TinyOffice Audit Summary

## 1. Current Office Rendering Model

**Location**: `tinyoffice/src/app/office/page.tsx` (single page, no sub-routes)

**Rendering**:
- Agents are rendered as `<img>` sprites at percentage-based positions (0–1 normalized coords)
- Desk positions: 14 fixed slots in `DESK_POSITIONS` array, assigned by index (agent 0 → slot 0, etc.)
- Positions are **not role-based** — assignment is by agent list order, not role
- Agent movement: when a speech bubble has `[@target]`, both agents move toward a midpoint (computed in `agentRenderPositions`)
- CSS transition `left 0.8s ease-in-out, top 0.8s ease-in-out` animates position changes
- Sprites cycle: `char_1`, `char_2`, `char_3`, `char_player` (4 variants, no role-specific avatars)

**Desk clusters**: Each agent gets a desk + monitor + chair at their slot. Plants at 5 fixed decorative positions.

## 2. State/Data Already Available

| Data | Source | Notes |
|------|--------|-------|
| `agentStates` | `useState<Record<string, AgentActivityState>>` | idle, thinking, working, handoff |
| `bubbles` | SSE `chain_step_done`, `response_ready`, `message_received` | Speech bubbles with targets |
| `statusEvents` | SSE chain events | Activity bar |
| `agentPositions` | `getAgents()` + `DESK_POSITIONS` | id, agent, deskPos, sprite |
| `agentRenderPositions` | Derived from bubbles + deskPosMap | Current x,y per agent |
| SSE | `subscribeToEvents()` | agent_state, chain_step_*, chain_handoff |

**Backend events already emitted** (no backend changes needed):
- `agent_state` { agent, state }
- `chain_step_start` / `chain_step_done` { agentId }
- `chain_handoff` { fromAgent, toAgent }
- `worker.started`, `worker.failed`, etc. (via observability) — need to subscribe
- `review_fetch.started`, `tester_focus.generated` — need to subscribe

## 3. SSE/Event-Stream Wiring

- **API**: `subscribeToEvents()` in `tinyoffice/src/lib/api.ts`
- **Endpoint**: `GET ${API_BASE}/api/events/stream`
- **EventSource**: Subscribes to named event types via `es.addEventListener(type, handler)`
- **Current types**: message_received, agent_routed, chain_step_start, chain_step_done, chain_handoff, team_chain_start, team_chain_end, response_ready, processor_start, message_enqueued, agent_state
- **Missing**: `worker.started`, `worker.failed`, `review_fetch.started`, `tester_focus.generated`, `runtime.event` (catch-all for normalized events)

## 4. Assets

**Referenced** (in page.tsx):
- `/assets/office/floor_tile.png`
- `/assets/office/desk.png`
- `/assets/office/monitor.png`
- `/assets/office/chair.png`
- `/assets/office/plant.png`
- `/assets/office/char_1.png`, `char_2.png`, `char_3.png`, `char_player.png`

**Actual**: `tinyoffice/public/` contains only `vercel.svg`. No `assets/office/` folder exists. **All office assets are missing.**

## 5. CSS/Animation Logic

**globals.css**:
- `agent-anim-idle`, `agent-anim-thinking`, `agent-anim-working`, `agent-anim-handoff` — CSS keyframe animations
- `animate-pulse-dot`, `animate-slide-up`, `animate-dash`
- Animations are in-place (transform/scale/opacity), not position-based walking

## 6. Smallest Safe Implementation Plan

1. **Office layout model** — Add role-based desk mapping (ba, scrum_master, architect, coder, reviewer, tester) with fixed positions. Keep as local constant.
2. **Agent visual state** — Extend existing `agentStates` with `position`, `targetPosition`, `label`. Add `unavailable` if useful.
3. **Event mapping** — Add `runtime.event` and worker/review_fetch/tester_focus events to SSE subscription. Map to agent_state in a small translation layer.
4. **Handoff walking** — When `chain_handoff` fires: set source `targetPosition` = next role's desk (or midpoint), animate with CSS transition. Clear target when done.
5. **Role avatars** — Replace sprite index with role-based mapping (colored placeholder or role icon). Easy to swap later.
6. **Placeholder assets** — Add minimal SVG or data-URI placeholders for floor, desk, chair, monitor, plant, and role avatars so the office renders without 404s.
