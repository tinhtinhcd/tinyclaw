/**
 * Map backend events to agent visual states.
 * Small explicit translation layer — no backend changes.
 */

import type { AgentActivityState } from "./office-state";

export type BackendEvent = {
  type: string;
  agentId?: string;
  agent?: string;
  role?: string;
  fromAgent?: string;
  toAgent?: string;
  [key: string]: unknown;
};

export type EventToStateResult = {
  agentId: string;
  state: AgentActivityState;
  targetAgentId?: string;
} | null;

export function eventToAgentState(event: BackendEvent): EventToStateResult[] {
  const results: EventToStateResult[] = [];
  const agentId = event.agentId ?? event.agent;

  switch (event.type) {
    case "agent_state":
      if (agentId && event.state) {
        const state = String(event.state) as AgentActivityState;
        if (["idle", "thinking", "working", "handoff", "unavailable"].includes(state)) {
          results.push({ agentId, state });
        }
      }
      break;

    case "chain_step_start":
      if (agentId) results.push({ agentId, state: "working" });
      break;

    case "chain_step_done":
      if (agentId) results.push({ agentId, state: "idle" });
      break;

    case "chain_handoff":
      if (event.fromAgent) results.push({ agentId: event.fromAgent, state: "handoff", targetAgentId: event.toAgent });
      if (event.toAgent) results.push({ agentId: event.toAgent, state: "thinking" });
      break;

    case "worker.started":
      if (agentId) results.push({ agentId, state: "working" });
      break;

    case "worker.failed":
    case "worker.timeout":
      if (agentId) results.push({ agentId, state: "thinking" });
      break;

    case "review_fetch.started":
    case "review_fetch.succeeded":
    case "review_fetch.failed":
      if (agentId) results.push({ agentId, state: "thinking" });
      break;

    case "tester_focus.generated":
      if (agentId) results.push({ agentId, state: "working" });
      break;

    case "linkage.pr_attached":
    case "linkage.branch_attached":
      if (agentId) results.push({ agentId, state: "working" });
      break;

    default:
      break;
  }

  return results;
}
