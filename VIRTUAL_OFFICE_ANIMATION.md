# Virtual Office Animation

This document describes how agent activity is visualized in the TinyOffice virtual office UI.

## Agent States

Agents can be in one of four states:

| State     | Description                          | When it occurs                          |
|-----------|--------------------------------------|-----------------------------------------|
| `idle`    | Agent is at desk, not actively working | After finishing a response, or default   |
| `thinking`| Agent is reading context before working | When receiving a handoff from another agent |
| `working` | Agent is actively processing         | When invoking the LLM (chain_step_start) |
| `handoff` | Agent is handing off to another       | When mentioning another agent (chain_handoff) |

## Animation Mapping

Each state maps to a CSS animation applied to the agent sprite:

| State     | Animation class      | Visual effect                                      |
|-----------|----------------------|----------------------------------------------------|
| `idle`    | `agent-anim-idle`    | Gentle vertical bob (standing at desk)              |
| `thinking`| `agent-anim-thinking`| Subtle pulse/scale (reading, processing context)  |
| `working` | `agent-anim-working` | Quick vertical bounce (typing, implementing)       |
| `handoff` | `agent-anim-handoff` | Small lateral movement (walking to deliver)        |

Animations are defined in `tinyoffice/src/app/globals.css` and use lightweight CSS keyframes. No game engines or sprite sheets are used.

## Event Flow

### Backend → SSE → UI

1. **Backend** emits `agent_state` events via `emitEvent('agent_state', { agent, state })` when:
   - `chain_step_start` → `state: 'working'`
   - `chain_step_done` → `state: 'idle'`
   - `chain_handoff` → `fromAgent: 'handoff'`, `toAgent: 'thinking'`

2. **SSE** broadcasts all events to connected clients at `GET /api/events/stream`.

3. **Office UI** subscribes via `subscribeToEvents()` and updates `agentStates` when `agent_state` events arrive.

### Event Payload

```json
{
  "type": "agent_state",
  "agent": "coder",
  "state": "working",
  "timestamp": 1234567890
}
```

### Fallback Derivation

If `agent_state` events are not emitted (e.g. older backend), the office derives state from existing events:

- `chain_step_start` + `agentId` → working
- `chain_step_done` + `agentId` → idle
- `chain_handoff` + `fromAgent` / `toAgent` → handoff / thinking

## Hover Tooltips

When hovering over an agent, a tooltip shows role-specific activity:

| Role          | Idle   | Thinking       | Working              | Handoff    |
|---------------|--------|----------------|----------------------|------------|
| BA            | Idle   | Reading context| Analyzing requirements| Handing off|
| Scrum Master  | Idle   | Reading context| Planning sprint      | Handing off|
| Architect     | Idle   | Reading context| Designing system     | Handing off|
| Coder         | Idle   | Reading context| Implementing feature | Handing off|
| Reviewer      | Idle   | Reading context| Reviewing PR         | Handing off|
| Tester        | Idle   | Reading context| Running tests        | Handing off|

## Backend Integration

Agent state is emitted from:

- `src/runtime/process-message.ts` — on `chain_step_start` and `chain_step_done`
- `src/runtime/handoff-runtime.ts` — on `chain_handoff` (dev_pipeline and mention-based)

The SSE layer (`src/server/sse.ts`) forwards all `emitEvent` calls to the stream, so `agent_state` is automatically broadcast.

## Files

| File                          | Purpose                                      |
|-------------------------------|----------------------------------------------|
| `tinyoffice/src/app/office/page.tsx` | Agent rendering, state store, event handling |
| `tinyoffice/src/app/globals.css`     | Animation keyframes and classes              |
| `tinyoffice/src/lib/api.ts`          | SSE subscription (includes `agent_state`)    |
| `src/runtime/process-message.ts`     | Emits `agent_state` on step start/done       |
| `src/runtime/handoff-runtime.ts`      | Emits `agent_state` on handoff               |
