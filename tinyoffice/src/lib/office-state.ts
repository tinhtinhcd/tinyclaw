/**
 * Agent visual state for office animations.
 * Lightweight state model driven by backend events.
 */

import type { OfficePosition } from "./office-layout";

export type AgentActivityState =
  | "idle"
  | "thinking"
  | "working"
  | "handoff"
  | "unavailable";

export type AgentVisualState = {
  role: string;
  state: AgentActivityState;
  position: OfficePosition;
  targetPosition?: OfficePosition;
  label?: string;
};

export const ROLE_LABELS: Record<string, string> = {
  ba: "Analyzing requirements",
  scrum_master: "Planning next stage",
  pm: "Planning next stage",
  architect: "Designing system",
  coder: "Implementing feature",
  reviewer: "Reviewing pull request",
  tester: "Validating changes",
};

export function getLabelForState(
  role: string,
  state: AgentActivityState
): string {
  const r = role.toLowerCase();
  const base = ROLE_LABELS[r] ?? "Working";
  switch (state) {
    case "idle":
      return "Idle";
    case "thinking":
      return "Reading context";
    case "working":
      return base;
    case "handoff":
      return "Handing off";
    case "unavailable":
      return "Unavailable";
    default:
      return base;
  }
}
