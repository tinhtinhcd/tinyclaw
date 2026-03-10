/**
 * Lightweight tests for backend event -> agent visual state mapping.
 */

import { describe, it, expect } from "vitest";
import { eventToAgentState } from "./office-events";

describe("eventToAgentState", () => {
  it("maps worker.started to working", () => {
    const results = eventToAgentState({
      type: "worker.started",
      agentId: "coder",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ agentId: "coder", state: "working" });
  });

  it("maps chain_step_start to working", () => {
    const results = eventToAgentState({
      type: "chain_step_start",
      agentId: "reviewer",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ agentId: "reviewer", state: "working" });
  });

  it("maps chain_step_done to idle", () => {
    const results = eventToAgentState({
      type: "chain_step_done",
      agentId: "architect",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ agentId: "architect", state: "idle" });
  });

  it("maps chain_handoff: fromAgent to handoff with targetAgentId", () => {
    const results = eventToAgentState({
      type: "chain_handoff",
      fromAgent: "coder",
      toAgent: "reviewer",
    });
    expect(results).toHaveLength(2);
    const handoff = results.find((r) => r?.agentId === "coder");
    const thinking = results.find((r) => r?.agentId === "reviewer");
    expect(handoff).toEqual({
      agentId: "coder",
      state: "handoff",
      targetAgentId: "reviewer",
    });
    expect(thinking).toEqual({ agentId: "reviewer", state: "thinking" });
  });

  it("maps worker.failed to thinking", () => {
    const results = eventToAgentState({
      type: "worker.failed",
      agentId: "tester",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ agentId: "tester", state: "thinking" });
  });

  it("maps review_fetch.started to thinking", () => {
    const results = eventToAgentState({
      type: "review_fetch.started",
      agentId: "reviewer",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ agentId: "reviewer", state: "thinking" });
  });

  it("maps linkage.pr_attached to working", () => {
    const results = eventToAgentState({
      type: "linkage.pr_attached",
      agentId: "coder",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ agentId: "coder", state: "working" });
  });

  it("returns empty for unknown event type (fallback)", () => {
    const results = eventToAgentState({
      type: "unknown.event",
      agentId: "coder",
    });
    expect(results).toHaveLength(0);
  });

  it("uses agent field when agentId is missing", () => {
    const results = eventToAgentState({
      type: "worker.started",
      agent: "ba",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ agentId: "ba", state: "working" });
  });

  it("returns empty when no agent identifier", () => {
    const results = eventToAgentState({
      type: "worker.started",
    });
    expect(results).toHaveLength(0);
  });
});
