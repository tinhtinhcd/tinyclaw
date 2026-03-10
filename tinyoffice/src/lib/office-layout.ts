/**
 * Office layout model for role-based desk positions.
 * Gather/Habbo-style: each role has a stable desk area in a natural office arrangement.
 * Positions use pixel coordinates within an OFFICE_WIDTH × OFFICE_HEIGHT viewport.
 */

export type OfficePosition = {
  x: number;
  y: number;
};

export type OfficeAgentLayout = {
  role: string;
  desk: OfficePosition;
  home: OfficePosition;
  zone: string;
};

/** Scene viewport size in logical pixels */
export const OFFICE_WIDTH = 960;
export const OFFICE_HEIGHT = 540;

/** Wall height in pixels (top strip) */
export const WALL_HEIGHT = 64;

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

/**
 * Fixed desk positions for roles (pixel coords, origin = top-left).
 * Layout: U-shaped arrangement with open center for meetings/handoffs.
 *
 *  ┌──────────────────────────────────────────────┐
 *  │   WALL WALL WALL WALL WALL WALL WALL WALL    │
 *  │                                              │
 *  │  [BA]       [Scrum]    [Architect]           │
 *  │                                              │
 *  │              (meeting                        │
 *  │                area)                         │
 *  │                                              │
 *  │         [Coder]      [Reviewer]   [Tester]   │
 *  │                                              │
 *  └──────────────────────────────────────────────┘
 */
const ROLE_DESK_POSITIONS: Record<string, { pos: OfficePosition; zone: string }> = {
  ba:           { pos: { x: 120, y: 160 }, zone: "Analysis Corner" },
  scrum_master: { pos: { x: 360, y: 160 }, zone: "Planning Desk" },
  pm:           { pos: { x: 360, y: 160 }, zone: "Planning Desk" },
  architect:    { pos: { x: 600, y: 160 }, zone: "Design Desk" },
  coder:        { pos: { x: 240, y: 380 }, zone: "Implementation Desk" },
  reviewer:     { pos: { x: 520, y: 380 }, zone: "Review Desk" },
  tester:       { pos: { x: 760, y: 380 }, zone: "Testing Desk" },
};

/** Offset from desk center for agent sprite (slightly below desk = sitting in front) */
const AGENT_OFFSET_Y = 36;

/** Meeting area center (for handoff midpoints) */
export const MEETING_CENTER: OfficePosition = { x: 440, y: 280 };

export function getDeskForRole(role: string): OfficePosition {
  const r = role.toLowerCase().trim();
  return ROLE_DESK_POSITIONS[r]?.pos ?? ROLE_DESK_POSITIONS.coder.pos;
}

export function getZoneForRole(role: string): string {
  const r = role.toLowerCase().trim();
  return ROLE_DESK_POSITIONS[r]?.zone ?? "Office";
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
  const zone = getZoneForRole(role);
  return { role, desk, home, zone };
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

/** Convert pixel position to percentage (for legacy compatibility) */
export function toPercent(pos: OfficePosition): { x: number; y: number } {
  return { x: pos.x / OFFICE_WIDTH, y: pos.y / OFFICE_HEIGHT };
}

/** Convert percentage position to pixel coords */
export function toPixel(pct: { x: number; y: number }): OfficePosition {
  return { x: Math.round(pct.x * OFFICE_WIDTH), y: Math.round(pct.y * OFFICE_HEIGHT) };
}

export { WORKFLOW_ROLES, ROLE_DESK_POSITIONS, AGENT_OFFSET_Y };
