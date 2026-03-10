/**
 * Office UI utilities: message parsing, avatars, tooltips.
 */

import { inferRoleFromAgentId } from "./office-layout";
import { getLabelForState, type AgentActivityState } from "./office-state";
import type { AgentConfig } from "@/lib/api";

const ASSET_EXT = ".svg";

export function getAgentTooltip(
  agentId: string,
  agent: AgentConfig,
  state: AgentActivityState
): string {
  const role = (agent.role || inferRoleFromAgentId(agentId)).toLowerCase().replace(" ", "_");
  const r = role === "pm" ? "scrum_master" : role;
  return `@${agentId}: ${getLabelForState(r, state)}`;
}

export function getAvatarForRole(role: string): string {
  const r = role.toLowerCase().replace(" ", "_");
  const known = ["ba", "scrum_master", "pm", "architect", "coder", "reviewer", "tester"];
  const key = known.includes(r) ? (r === "pm" ? "scrum_master" : r) : "coder";
  return `/assets/office/avatar-${key}${ASSET_EXT}`;
}

export function extractTargets(msg: string): string[] {
  const targets: string[] = [];
  const bracketMatches = msg.matchAll(/\[@(\w[\w-]*?):/g);
  for (const m of bracketMatches) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }
  if (targets.length === 0) {
    const atMatch = msg.match(/^@(\w[\w-]*)/);
    if (atMatch) targets.push(atMatch[1]);
  }
  return targets;
}

export interface MsgSegment {
  type: "mention" | "text";
  agent?: string;
  text: string;
}

export function parseMessage(msg: string): MsgSegment[] {
  const segments: MsgSegment[] = [];
  const regex = /\[@(\w[\w-]*?):\s*(.*?)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(msg)) !== null) {
    if (match.index > lastIndex) {
      const before = msg.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", text: before });
    }
    segments.push({ type: "mention", agent: match[1], text: match[2] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < msg.length) {
    const remaining = msg.slice(lastIndex).trim();
    if (remaining) segments.push({ type: "text", text: remaining });
  }

  if (segments.length === 0) segments.push({ type: "text", text: msg });
  return segments;
}
