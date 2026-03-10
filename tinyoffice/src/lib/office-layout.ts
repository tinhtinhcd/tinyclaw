/**
 * Office layout model for role-based desk positions.
 * Gather/Habbo-style: each role has a stable desk area.
 */

export type OfficePosition = {
  x: number;
  y: number;
};

export type OfficeAgentLayout = {
  role: string;
  desk: OfficePosition;
  home: OfficePosition;
};

/** Role order for workflow (BA → SM → Architect → Coder → Reviewer → Tester) */
const WORKFLOW_ROLES = [
  "ba",
  "scrum_master",
  "pm",
  "architect",
  "coder",
  "reviewer",
  "tester",
] as const;

/** Fixed desk positions for roles (normalized 0-1, top-left origin) */
const ROLE_DESK_POSITIONS: Record<string, OfficePosition> = {
  ba: { x: 0.14, y: 0.21 },
  scrum_master: { x: 0.25, y: 0.21 },
  pm: { x: 0.25, y: 0.21 },
  architect: { x: 0.36, y: 0.21 },
  coder: { x: 0.47, y: 0.21 },
  reviewer: { x: 0.61, y: 0.63 },
  tester: { x: 0.72, y: 0.63 },
};

/** Offset from desk center for agent sprite (slightly in front of desk) */
const AGENT_OFFSET_Y = 0.06;

export function getDeskForRole(role: string): OfficePosition {
  const r = role.toLowerCase().trim();
  return ROLE_DESK_POSITIONS[r] ?? ROLE_DESK_POSITIONS.coder;
}

export function getHomeForRole(role: string): OfficePosition {
  const desk = getDeskForRole(role);
  return { x: desk.x, y: desk.y + AGENT_OFFSET_Y };
}

export function getLayoutForAgent(
  agentId: string,
  role: string
): OfficeAgentLayout {
  const desk = getDeskForRole(role);
  const home = { x: desk.x, y: desk.y + AGENT_OFFSET_Y };
  return { role, desk, home };
}

/** Infer role from agent id when config role is missing */
export function inferRoleFromAgentId(agentId: string): string {
  const id = agentId.toLowerCase();
  if (id.includes("ba") && !id.includes("scrum")) return "ba";
  if (id.includes("scrum") || id.includes("pm")) return "scrum_master";
  if (id.includes("architect")) return "architect";
  if (id.includes("coder") || id.includes("dev")) return "coder";
  if (id.includes("review")) return "reviewer";
  if (id.includes("test") || id.includes("qa")) return "tester";
  return "coder";
}

export { WORKFLOW_ROLES, ROLE_DESK_POSITIONS, AGENT_OFFSET_Y };
