"use client";

import { useState, useEffect, useRef } from "react";
import {
  subscribeToEvents,
  type AgentConfig,
  type EventData,
} from "@/lib/api";
import { getHomeForRole, inferRoleFromAgentId } from "@/lib/office-layout";
import { eventToAgentState, type BackendEvent } from "@/lib/office-events";
import { extractTargets } from "@/lib/office-utils";
import type { AgentActivityState } from "@/lib/office-state";

export interface SpeechBubble {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  targetAgents: string[];
}

export interface StatusEvent {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
  detail?: string;
}

export function useOfficeEvents(agents: Record<string, AgentConfig> | undefined) {
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [agentStates, setAgentStates] = useState<Record<string, AgentActivityState>>({});
  const [handoffTargets, setHandoffTargets] = useState<Record<string, { x: number; y: number }>>({});
  const seenRef = useRef(new Set<string>());
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  useEffect(() => {
    const unsub = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);
        const e = event as Record<string, unknown>;
        const fp = `${event.type}:${event.timestamp}:${e.messageId ?? ""}:${e.agentId ?? ""}`;
        if (seenRef.current.has(fp)) return;
        seenRef.current.add(fp);
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const agentId = e.agentId ? String(e.agentId) : undefined;

        if (event.type === "chain_step_done" || event.type === "response_ready") {
          const msg = (e.responseText as string) || (e.message as string) || "";
          if (msg && agentId) {
            const targets = extractTargets(msg);
            setBubbles((prev) =>
              [
                ...prev,
                {
                  id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                  agentId,
                  message: msg,
                  timestamp: event.timestamp,
                  targetAgents: targets,
                },
              ].slice(-50)
            );
          }
        }

        if (event.type === "message_received") {
          const msg = (e.message as string) || "";
          if (msg) {
            const targets = extractTargets(msg);
            setBubbles((prev) =>
              [
                ...prev,
                {
                  id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                  agentId: `_user_${(e.sender as string) || "User"}`,
                  message: msg,
                  timestamp: event.timestamp,
                  targetAgents: targets,
                },
              ].slice(-50)
            );
          }
        }

        const evt = event as unknown as BackendEvent;
        const stateResults = eventToAgentState(evt);
        for (const r of stateResults) {
          if (r) {
            setAgentStates((prev) => ({ ...prev, [r.agentId]: r.state }));
            if (r.state === "handoff" && r.targetAgentId) {
              const targetRole =
                (agentsRef.current?.[r.targetAgentId] as AgentConfig)?.role ||
                inferRoleFromAgentId(r.targetAgentId);
              setHandoffTargets((prev) => ({
                ...prev,
                [r.agentId]: getHomeForRole(targetRole),
              }));
            }
          }
        }

        if (event.type === "chain_step_start" && agentId) {
          setAgentStates((prev) => ({ ...prev, [agentId]: "working" }));
        }
        if (event.type === "chain_step_done" && agentId) {
          setAgentStates((prev) => ({ ...prev, [agentId]: "idle" }));
          setHandoffTargets((prev) => {
            const next = { ...prev };
            delete next[agentId];
            return next;
          });
        }
        if (event.type === "chain_handoff") {
          const fromAgent = e.fromAgent as string | undefined;
          const toAgent = e.toAgent as string | undefined;
          if (fromAgent) setAgentStates((prev) => ({ ...prev, [fromAgent]: "handoff" }));
          if (toAgent) setAgentStates((prev) => ({ ...prev, [toAgent]: "thinking" }));
          if (fromAgent && toAgent) {
            const targetRole =
              (agentsRef.current?.[toAgent] as AgentConfig)?.role ||
              inferRoleFromAgentId(toAgent);
            setHandoffTargets((prev) => ({
              ...prev,
              [fromAgent]: getHomeForRole(targetRole),
            }));
          }
        }

        const statusTypes = [
          "agent_routed",
          "chain_step_start",
          "chain_handoff",
          "team_chain_start",
          "team_chain_end",
          "message_enqueued",
          "processor_start",
        ];
        if (statusTypes.includes(event.type)) {
          setStatusEvents((prev) =>
            [
              {
                id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                type: event.type,
                agentId,
                timestamp: event.timestamp,
                detail: (e.message as string) || (e.teamId ? `team:${e.teamId}` : undefined),
              },
              ...prev,
            ].slice(0, 20)
          );
        }
      },
      () => setConnected(false)
    );
    return unsub;
  }, []);

  useEffect(() => {
    const handoffIds = Object.keys(handoffTargets);
    if (handoffIds.length === 0) return;
    const t = setTimeout(() => {
      setHandoffTargets((prev) => {
        const next = { ...prev };
        for (const id of handoffIds) delete next[id];
        return next;
      });
      setAgentStates((prev) => {
        const next = { ...prev };
        for (const id of handoffIds) next[id] = "idle";
        return next;
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [handoffTargets]);

  const agentEntries = agents ? Object.entries(agents) : [];
  useEffect(() => {
    if (agentEntries.length > 0) {
      setAgentStates((prev) => {
        const next = { ...prev };
        for (const [id] of agentEntries) {
          if (!(id in next)) next[id] = "idle";
        }
        return next;
      });
    }
  }, [agentEntries.map(([id]) => id).join(",")]);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 15000;
      setBubbles((prev) => prev.filter((b) => b.timestamp > cutoff));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return {
    bubbles,
    statusEvents,
    connected,
    agentStates,
    handoffTargets,
  };
}
