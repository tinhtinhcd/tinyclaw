/**
 * Lightweight tests for office layout and handoff target resolution.
 */

import { describe, it, expect } from "vitest";
import {
  getHomeForRole,
  getDeskForRole,
  getLayoutForAgent,
  inferRoleFromAgentId,
  getZoneForRole,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
} from "./office-layout";

describe("office-layout", () => {
  describe("getDeskForRole", () => {
    it("returns desk position for known roles within scene bounds", () => {
      const desk = getDeskForRole("coder");
      expect(desk).toHaveProperty("x");
      expect(desk).toHaveProperty("y");
      expect(desk.x).toBeGreaterThanOrEqual(0);
      expect(desk.x).toBeLessThanOrEqual(OFFICE_WIDTH);
      expect(desk.y).toBeGreaterThanOrEqual(0);
      expect(desk.y).toBeLessThanOrEqual(OFFICE_HEIGHT);
    });

    it("falls back to coder for unknown role", () => {
      const desk = getDeskForRole("unknown_role");
      expect(desk).toEqual(getDeskForRole("coder"));
    });

    it("returns unique positions for each known role", () => {
      const roles = ["ba", "scrum_master", "architect", "coder", "reviewer", "tester"];
      const positions = roles.map((r) => getDeskForRole(r));
      const unique = new Set(positions.map((p) => `${p.x},${p.y}`));
      expect(unique.size).toBe(roles.length);
    });
  });

  describe("getHomeForRole", () => {
    it("returns home position slightly offset from desk", () => {
      const desk = getDeskForRole("reviewer");
      const home = getHomeForRole("reviewer");
      expect(home.x).toBe(desk.x);
      expect(home.y).toBeGreaterThan(desk.y);
    });
  });

  describe("getZoneForRole", () => {
    it("returns zone name for known roles", () => {
      expect(getZoneForRole("ba")).toBe("Analysis Corner");
      expect(getZoneForRole("coder")).toBe("Implementation Desk");
      expect(getZoneForRole("tester")).toBe("Testing Desk");
    });

    it("falls back to Office for unknown role", () => {
      expect(getZoneForRole("mystery")).toBe("Office");
    });
  });

  describe("getLayoutForAgent", () => {
    it("returns layout with role, desk, home, zone", () => {
      const layout = getLayoutForAgent("coder-1", "coder");
      expect(layout).toHaveProperty("role", "coder");
      expect(layout).toHaveProperty("desk");
      expect(layout).toHaveProperty("home");
      expect(layout).toHaveProperty("zone");
    });
  });

  describe("inferRoleFromAgentId", () => {
    it("infers ba from agent id", () => {
      expect(inferRoleFromAgentId("ba")).toBe("ba");
      expect(inferRoleFromAgentId("my-ba-agent")).toBe("ba");
    });

    it("infers scrum_master from pm/scrum", () => {
      expect(inferRoleFromAgentId("scrum_master")).toBe("scrum_master");
      expect(inferRoleFromAgentId("pm")).toBe("scrum_master");
    });

    it("infers coder from coder/dev", () => {
      expect(inferRoleFromAgentId("coder")).toBe("coder");
      expect(inferRoleFromAgentId("dev-1")).toBe("coder");
    });

    it("infers reviewer from reviewer", () => {
      expect(inferRoleFromAgentId("reviewer")).toBe("reviewer");
    });

    it("infers tester from tester/qa", () => {
      expect(inferRoleFromAgentId("tester")).toBe("tester");
      expect(inferRoleFromAgentId("qa")).toBe("tester");
    });

    it("falls back to coder for unknown role", () => {
      expect(inferRoleFromAgentId("random-agent")).toBe("coder");
    });
  });

  describe("handoff target resolution", () => {
    it("getHomeForRole returns valid position for handoff target", () => {
      const targetRole = "reviewer";
      const home = getHomeForRole(targetRole);
      expect(home.x).toBeGreaterThanOrEqual(0);
      expect(home.y).toBeGreaterThanOrEqual(0);
      expect(home.x).toBeLessThanOrEqual(OFFICE_WIDTH);
      expect(home.y).toBeLessThanOrEqual(OFFICE_HEIGHT);
    });
  });
});
