/**
 * Tests for office animation helpers.
 */

import { describe, it, expect } from "vitest";
import {
  getAnimationClass,
  getStateIndicator,
  lerp,
  midpoint,
  resolveRenderPosition,
} from "./office-animations";

describe("office-animations", () => {
  describe("getAnimationClass", () => {
    it("maps idle to idle class", () => {
      expect(getAnimationClass("idle")).toBe("agent-anim-idle");
    });

    it("maps thinking to thinking class", () => {
      expect(getAnimationClass("thinking")).toBe("agent-anim-thinking");
    });

    it("maps working to working class", () => {
      expect(getAnimationClass("working")).toBe("agent-anim-working");
    });

    it("maps handoff to walking class", () => {
      expect(getAnimationClass("handoff")).toBe("agent-anim-walking");
    });

    it("maps unavailable to idle class", () => {
      expect(getAnimationClass("unavailable")).toBe("agent-anim-idle");
    });
  });

  describe("getStateIndicator", () => {
    it("returns empty string for idle", () => {
      expect(getStateIndicator("idle")).toBe("");
    });

    it("returns thought bubble for thinking", () => {
      expect(getStateIndicator("thinking")).toBe("💭");
    });

    it("returns keyboard for working", () => {
      expect(getStateIndicator("working")).toBe("⌨️");
    });

    it("returns walking emoji for handoff", () => {
      expect(getStateIndicator("handoff")).toBe("🚶");
    });
  });

  describe("lerp", () => {
    it("returns from position at t=0", () => {
      const result = lerp({ x: 0, y: 0 }, { x: 100, y: 100 }, 0);
      expect(result).toEqual({ x: 0, y: 0 });
    });

    it("returns to position at t=1", () => {
      const result = lerp({ x: 0, y: 0 }, { x: 100, y: 100 }, 1);
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it("returns midpoint at t=0.5", () => {
      const result = lerp({ x: 0, y: 0 }, { x: 100, y: 200 }, 0.5);
      expect(result).toEqual({ x: 50, y: 100 });
    });

    it("clamps t to [0, 1]", () => {
      const result = lerp({ x: 0, y: 0 }, { x: 100, y: 100 }, 2);
      expect(result).toEqual({ x: 100, y: 100 });
    });
  });

  describe("midpoint", () => {
    it("returns center between two points", () => {
      const result = midpoint({ x: 0, y: 0 }, { x: 100, y: 200 });
      expect(result).toEqual({ x: 50, y: 100 });
    });
  });

  describe("resolveRenderPosition", () => {
    const home = { x: 200, y: 300 };
    const target = { x: 500, y: 400 };

    it("returns home for idle state", () => {
      expect(resolveRenderPosition(home, "idle")).toEqual(home);
    });

    it("returns home for working state", () => {
      expect(resolveRenderPosition(home, "working")).toEqual(home);
    });

    it("returns handoff target when state is handoff", () => {
      expect(resolveRenderPosition(home, "handoff", target)).toEqual(target);
    });

    it("returns home for handoff without target", () => {
      expect(resolveRenderPosition(home, "handoff")).toEqual(home);
    });
  });
});
