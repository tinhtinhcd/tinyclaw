/**
 * Chat message model and debug event types.
 * Separates conversation messages from internal runtime events.
 */

/** A visible chat message — only these appear in the conversation view */
export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  agentId?: string;
  agentName?: string;
  content: string;
  timestamp: number;
};

/** An internal runtime event — only visible in the debug panel */
export type DebugEvent = {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
  detail?: string;
  data: Record<string, unknown>;
};

/**
 * Events that produce visible chat messages.
 * - response_ready: agent finished composing a reply
 * - chain_step_done: agent completed a processing step (may contain responseText)
 */
export const CHAT_MESSAGE_EVENTS = new Set([
  "response_ready",
  "chain_step_done",
]);

/**
 * Events that are purely internal and should go to the debug stream.
 * Everything not in CHAT_MESSAGE_EVENTS goes here.
 */
export const DEBUG_ONLY_EVENTS = new Set([
  "message_received",
  "agent_state",
  "agent_routed",
  "chain_step_start",
  "chain_handoff",
  "team_chain_start",
  "team_chain_end",
  "processor_start",
  "message_enqueued",
  "worker.started",
  "worker.failed",
  "worker.timeout",
  "review_fetch.started",
  "review_fetch.succeeded",
  "review_fetch.failed",
  "tester_focus.generated",
  "linkage.pr_attached",
  "linkage.branch_attached",
  "runtime.event",
]);

/** Role display labels */
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  ba: "BA",
  scrum_master: "Scrum Master",
  pm: "Scrum Master",
  architect: "Architect",
  coder: "Coder",
  reviewer: "Reviewer",
  tester: "Tester",
};

/** Get a friendly display name for an agent */
export function getAgentDisplayName(agentId: string): string {
  const id = agentId.toLowerCase();
  for (const [key, label] of Object.entries(ROLE_DISPLAY_NAMES)) {
    if (id.includes(key)) return label;
  }
  return agentId;
}
