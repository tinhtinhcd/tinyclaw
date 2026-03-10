# Virtual Office — Gather/Habbo-Style Plan

This document describes the TinyOffice virtual office upgrade: a lightweight 2D pixel-style office where agents visibly work, show activity states, and walk between desks during handoff.

## Layout Model

### Types

```ts
type OfficePosition = { x: number; y: number };

type OfficeAgentLayout = {
  role: string;
  desk: OfficePosition;
  home: OfficePosition;
};
```

### Role Desk Positions

Fixed desk positions (normalized 0–1, top-left origin):

| Role         | Desk (x, y) |
|--------------|-------------|
| ba           | 0.14, 0.21  |
| scrum_master | 0.25, 0.21  |
| pm           | 0.25, 0.21  |
| architect    | 0.36, 0.21  |
| coder        | 0.47, 0.21  |
| reviewer     | 0.61, 0.63  |
| tester       | 0.72, 0.63  |

- **Desk**: center of the desk cluster
- **Home**: agent standing position (desk + small Y offset)

### Helpers

- `getDeskForRole(role)` — desk position for a role
- `getHomeForRole(role)` — home position for a role
- `getLayoutForAgent(agentId, role)` — full layout for an agent
- `inferRoleFromAgentId(agentId)` — fallback when config role is missing

---

## Agent Visual States

| State       | Description                          |
|------------|--------------------------------------|
| idle       | Standing at desk, no activity        |
| thinking   | Reading context, waiting            |
| working   | Actively processing                  |
| handoff    | Walking toward another role’s desk  |
| unavailable | Optional, for offline agents       |

### State Store

- `agentStates: Record<string, AgentActivityState>`
- `handoffTargets: Record<string, { x: number; y: number }>` — target position during handoff

---

## Animation Mapping

CSS classes drive animations (no game engine):

| State    | CSS Class           | Effect                          |
|----------|---------------------|----------------------------------|
| idle     | `agent-anim-idle`   | Subtle idle animation           |
| thinking | `agent-anim-thinking` | Bobbing / attention effect    |
| working  | `agent-anim-working`  | Typing / desk activity        |
| handoff  | `agent-anim-handoff`  | Walking motion                 |

Position changes use CSS transitions (`left`, `top`, 0.8s ease-in-out).

### Hover Tooltips

| Role         | Label                    |
|--------------|--------------------------|
| BA           | Analyzing requirements   |
| Scrum Master | Planning next stage      |
| Architect    | Designing system         |
| Coder        | Implementing feature     |
| Reviewer     | Reviewing pull request   |
| Tester       | Validating changes       |

---

## Backend Event Mapping

Translation layer in `office-events.ts` maps backend events to agent states:

| Event Type           | Agent State | Notes                    |
|----------------------|-------------|--------------------------|
| `agent_state`        | (from payload) | Direct state override |
| `chain_step_start`   | working    | Agent starts processing  |
| `chain_step_done`    | idle       | Agent finishes            |
| `chain_handoff`      | handoff (from) / thinking (to) | Handoff flow |
| `worker.started`     | working   | Worker task started       |
| `worker.failed`      | thinking  | Fallback / retry          |
| `worker.timeout`     | thinking  | Fallback / retry          |
| `review_fetch.started`| thinking  | Reviewer fetching         |
| `tester_focus.generated` | working | Tester generating focus |
| `linkage.pr_attached`| working   | PR attached to task       |
| `linkage.branch_attached` | working | Branch attached      |
| Unknown              | (no change) | Fallback, no update   |

---

## Handoff Walking Behavior

1. On `chain_handoff`:
   - `fromAgent` → state `handoff`, target = `toAgent`’s home position
   - `toAgent` → state `thinking`

2. Agent position:
   - When `handoff`, use `handoffTargets[agentId]` as target
   - CSS transition animates from current position to target

3. Return home:
   - After 2 seconds in handoff, agent returns to home and state becomes `idle`

4. No pathfinding — linear interpolation from current to target.

---

## Role Avatar Approach

- Each role has a placeholder avatar: `/assets/office/avatar-{role}.svg`
- Roles: `ba`, `scrum_master`, `architect`, `coder`, `reviewer`, `tester`
- Fallback for unknown roles: `avatar-coder.svg`
- User avatar: `char_player.svg`

---

## Assets

| Asset          | Path                          | Purpose              |
|----------------|-------------------------------|----------------------|
| Floor tile     | `/assets/office/floor_tile.svg` | Background          |
| Desk           | `/assets/office/desk.svg`       | Desk cluster        |
| Monitor        | `/assets/office/monitor.svg`    | On desk             |
| Chair          | `/assets/office/chair.svg`      | At desk             |
| Plant          | `/assets/office/plant.svg`     | Decoration          |
| Role avatars   | `/assets/office/avatar-*.svg`   | Agent sprites       |
| Player         | `/assets/office/char_player.svg`| User avatar         |

---

## Limitations

- No pathfinding — straight-line movement only
- No isometric depth — flat 2D layout
- Meeting bubbles can override handoff positions
- Handoff return uses a fixed 2s timeout
- Avatars are simple placeholders, not generated art

---

## Next Steps

1. Replace placeholder avatars with higher-quality pixel art
2. Add optional pathfinding for more natural movement
3. Tune handoff timing based on distance
4. Add sound effects (optional)
5. Support custom layouts via config
