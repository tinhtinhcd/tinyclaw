/**
 * Animation helpers for office sprites.
 * Maps agent states to CSS classes and provides walking interpolation.
 */

import type { AgentActivityState } from "./office-state";
import type { OfficePosition } from "./office-layout";

/** Map agent activity state to CSS animation class */
export function getAnimationClass(state: AgentActivityState): string {
  switch (state) {
    case "idle":
      return "agent-anim-idle";
    case "thinking":
      return "agent-anim-thinking";
    case "working":
      return "agent-anim-working";
    case "handoff":
      return "agent-anim-walking";
    case "unavailable":
      return "agent-anim-idle";
    default:
      return "agent-anim-idle";
  }
}

/** Map agent state to a small status indicator emoji */
export function getStateIndicator(state: AgentActivityState): string {
  switch (state) {
    case "idle":
      return "";
    case "thinking":
      return "💭";
    case "working":
      return "⌨️";
    case "handoff":
      return "🚶";
    case "unavailable":
      return "💤";
    default:
      return "";
  }
}

/** Linear interpolation between two positions */
export function lerp(from: OfficePosition, to: OfficePosition, t: number): OfficePosition {
  const ct = Math.max(0, Math.min(1, t));
  return {
    x: Math.round(from.x + (to.x - from.x) * ct),
    y: Math.round(from.y + (to.y - from.y) * ct),
  };
}

/** Calculate midpoint between two positions (for meeting/handoff) */
export function midpoint(a: OfficePosition, b: OfficePosition): OfficePosition {
  return {
    x: Math.round((a.x + b.x) / 2),
    y: Math.round((a.y + b.y) / 2),
  };
}

/** Resolve the render position for an agent given its state and handoff target */
export function resolveRenderPosition(
  homePos: OfficePosition,
  state: AgentActivityState,
  handoffTarget?: OfficePosition
): OfficePosition {
  if (state === "handoff" && handoffTarget) {
    return handoffTarget;
  }
  return homePos;
}
