"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { usePolling } from "@/lib/hooks";
import { timeAgo } from "@/lib/hooks";
import {
  getAgents,
  getTeams,
  subscribeToEvents,
  type AgentConfig,
  type TeamConfig,
  type EventData,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  getLayoutForAgent,
  getHomeForRole,
  inferRoleFromAgentId,
  ROLE_DESK_POSITIONS,
} from "@/lib/office-layout";
import { getLabelForState, type AgentActivityState } from "@/lib/office-state";
import { eventToAgentState, type BackendEvent } from "@/lib/office-events";

const MEETING_OFFSET = 0.03;
const ASSET_EXT = ".svg";

function getAgentTooltip(agentId: string, agent: AgentConfig, state: AgentActivityState): string {
  const role = (agent.role || inferRoleFromAgentId(agentId)).toLowerCase().replace(" ", "_");
  const r = role === "pm" ? "scrum_master" : role;
  return `@${agentId}: ${getLabelForState(r, state)}`;
}

function getAvatarForRole(role: string): string {
  const r = role.toLowerCase().replace(" ", "_");
  const known = ["ba", "scrum_master", "pm", "architect", "coder", "reviewer", "tester"];
  const key = known.includes(r) ? (r === "pm" ? "scrum_master" : r) : "coder";
  return `/assets/office/avatar-${key}${ASSET_EXT}`;
}

interface SpeechBubble {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  targetAgents: string[];
}

interface StatusEvent {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
  detail?: string;
}

// Extract all @mention targets from message text
function extractTargets(msg: string): string[] {
  const targets: string[] = [];
  // Match all [@agent: ...] blocks
  const bracketMatches = msg.matchAll(/\[@(\w[\w-]*?):/g);
  for (const m of bracketMatches) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }
  // Fallback: bare @agent at start
  if (targets.length === 0) {
    const atMatch = msg.match(/^@(\w[\w-]*)/);
    if (atMatch) targets.push(atMatch[1]);
  }
  return targets;
}

// Parse message into segments: plain text and [@agent: message] blocks
interface MsgSegment {
  type: "mention" | "text";
  agent?: string;
  text: string;
}

function parseMessage(msg: string): MsgSegment[] {
  const segments: MsgSegment[] = [];
  // Match [@agent: content] blocks
  const regex = /\[@(\w[\w-]*?):\s*(.*?)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(msg)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      const before = msg.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", text: before });
    }
    segments.push({ type: "mention", agent: match[1], text: match[2] });
    lastIndex = regex.lastIndex;
  }

  // Remaining text after last match
  if (lastIndex < msg.length) {
    const remaining = msg.slice(lastIndex).trim();
    if (remaining) segments.push({ type: "text", text: remaining });
  }

  // If no brackets found, just return the whole message
  if (segments.length === 0) {
    segments.push({ type: "text", text: msg });
  }

  return segments;
}

export default function OfficePage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [agentStates, setAgentStates] = useState<Record<string, AgentActivityState>>({});
  const [handoffTargets, setHandoffTargets] = useState<Record<string, { x: number; y: number }>>({});
  const seenRef = useRef(new Set<string>());
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const agentEntries = agents ? Object.entries(agents) : [];
  const teamEntries = teams ? Object.entries(teams) : [];

  // Role-based layout: each agent gets a desk by role (offset if duplicate roles)
  const agentPositions = useMemo(() => {
    const roleCount = new Map<string, number>();
    return agentEntries.map(([id, agent]) => {
      const role = (agent.role || inferRoleFromAgentId(id)).toLowerCase().replace(" ", "_");
      const r = role === "pm" ? "scrum_master" : role;
      const layout = getLayoutForAgent(id, r);
      const idx = roleCount.get(r) ?? 0;
      roleCount.set(r, idx + 1);
      const offset = idx * 0.04;
      return {
        id,
        agent,
        role: layout.role,
        deskPos: { x: layout.desk.x + offset, y: layout.desk.y },
        homePos: { x: layout.home.x + offset, y: layout.home.y },
        avatar: getAvatarForRole(layout.role),
      };
    });
  }, [agentEntries]);

  const deskPosMap = useMemo(
    () => new Map(agentPositions.map((a) => [a.id, a.homePos])),
    [agentPositions]
  );

  // Compute render positions: home, handoff target, or meeting midpoint
  const agentRenderPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();

    for (const ap of agentPositions) {
      const handoffTarget = handoffTargets[ap.id];
      if (handoffTarget && agentStates[ap.id] === "handoff") {
        positions.set(ap.id, handoffTarget);
      } else {
        positions.set(ap.id, { x: ap.homePos.x, y: ap.homePos.y });
      }
    }

    const latestBubblePerAgent = new Map<string, SpeechBubble>();
    for (const b of bubbles) {
      const firstTarget = b.targetAgents[0];
      if (firstTarget && deskPosMap.has(b.agentId) && deskPosMap.has(firstTarget)) {
        const existing = latestBubblePerAgent.get(b.agentId);
        if (!existing || b.timestamp > existing.timestamp) {
          latestBubblePerAgent.set(b.agentId, b);
        }
      }
    }

    for (const [agentId, bubble] of latestBubblePerAgent) {
      const firstTarget = bubble.targetAgents[0]!;
      const fromDesk = deskPosMap.get(agentId)!;
      const toDesk = deskPosMap.get(firstTarget)!;
      const midX = (fromDesk.x + toDesk.x) / 2;
      const midY = (fromDesk.y + toDesk.y) / 2;
      const dx = toDesk.x - fromDesk.x;
      const dy = toDesk.y - fromDesk.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      positions.set(agentId, { x: midX - nx * MEETING_OFFSET, y: midY - ny * MEETING_OFFSET });
      for (const targetId of bubble.targetAgents) {
        if (!latestBubblePerAgent.has(targetId) && deskPosMap.has(targetId)) {
          const tDesk = deskPosMap.get(targetId)!;
          const tdx = tDesk.x - fromDesk.x;
          const tdy = tDesk.y - fromDesk.y;
          const tdist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
          positions.set(targetId, {
            x: (fromDesk.x + tDesk.x) / 2 + (tdx / tdist) * MEETING_OFFSET,
            y: (fromDesk.y + tDesk.y) / 2 + (tdy / tdist) * MEETING_OFFSET,
          });
        }
      }
    }

    return positions;
  }, [agentPositions, bubbles, deskPosMap, handoffTargets, agentStates]);

  // Subscribe to SSE events
  useEffect(() => {
    const unsub = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);
        const fp = `${event.type}:${event.timestamp}:${(event as Record<string, unknown>).messageId ?? ""}:${(event as Record<string, unknown>).agentId ?? ""}`;
        if (seenRef.current.has(fp)) return;
        seenRef.current.add(fp);
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const e = event as Record<string, unknown>;
        const agentId = e.agentId ? String(e.agentId) : undefined;

        // Events that produce speech bubbles (agent actually says something)
        if (
          event.type === "chain_step_done" ||
          event.type === "response_ready"
        ) {
          const msg =
            (e.responseText as string) ||
            (e.message as string) ||
            "";
          if (msg && agentId) {
            const targets = extractTargets(msg);
            const bubble: SpeechBubble = {
              id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
              agentId,
              message: msg,
              timestamp: event.timestamp,
              targetAgents: targets,
            };
            setBubbles((prev) => [...prev, bubble].slice(-50));
          }
        }

        // Events that produce a sent message bubble
        if (event.type === "message_received") {
          const msg = (e.message as string) || "";
          const sender = (e.sender as string) || "User";
          if (msg) {
            const targets = extractTargets(msg);
            const bubble: SpeechBubble = {
              id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
              agentId: `_user_${sender}`,
              message: msg,
              timestamp: event.timestamp,
              targetAgents: targets,
            };
            setBubbles((prev) => [...prev, bubble].slice(-50));
          }
        }

        // Agent activity state via event translation layer
        const evt = event as unknown as BackendEvent;
        const stateResults = eventToAgentState(evt);
        for (const r of stateResults) {
          if (r) {
            setAgentStates((prev) => ({ ...prev, [r.agentId]: r.state }));
            if (r.state === "handoff" && r.targetAgentId) {
              const targetRole = (agents?.[r.targetAgentId] as AgentConfig)?.role || inferRoleFromAgentId(r.targetAgentId);
              setHandoffTargets((prev) => ({ ...prev, [r.agentId]: getHomeForRole(targetRole) }));
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
            const targetRole = (agentsRef.current?.[toAgent] as AgentConfig)?.role || inferRoleFromAgentId(toAgent);
            setHandoffTargets((prev) => ({
              ...prev,
              [fromAgent]: getHomeForRole(targetRole),
            }));
          }
        }

        // Status bar events (chain mechanics)
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

  // Return handoff agents home after walk duration
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

  // Initialize agent states to idle when agents load
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

  // Auto-expire old bubbles after 15s
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 15000;
      setBubbles((prev) => prev.filter((b) => b.timestamp > cutoff));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Office</span>
          <Badge variant="outline" className="text-xs">
            {agentEntries.length} agent{agentEntries.length !== 1 ? "s" : ""}
          </Badge>
          {teamEntries.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {teamEntries.length} team{teamEntries.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 ${connected ? "bg-primary animate-pulse-dot" : "bg-destructive"}`}
          />
          <span className="text-[10px] text-muted-foreground">
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Office Scene */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0">
          {/* Floor tiles */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "url(/assets/office/floor_tile.svg)",
              backgroundSize: "40px 40px",
              backgroundRepeat: "repeat",
              imageRendering: "pixelated",
            }}
          />

          {/* Desk clusters (always at desk positions) */}
          {agentPositions.map(({ id, deskPos }) => (
            <div
              key={`desk-${id}`}
              className="absolute"
              style={{
                left: `${deskPos.x * 100}%`,
                top: `${deskPos.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <img
                src="/assets/office/desk.svg"
                alt=""
                className="w-[72px] h-[40px]"
                style={{ imageRendering: "pixelated" }}
                draggable={false}
              />
              <img
                src="/assets/office/monitor.svg"
                alt=""
                className="absolute w-[28px] h-auto"
                style={{
                  top: "-14px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  imageRendering: "pixelated",
                }}
                draggable={false}
              />
              <img
                src="/assets/office/chair.svg"
                alt=""
                className="absolute w-[24px] h-auto"
                style={{
                  bottom: "-22px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  imageRendering: "pixelated",
                }}
                draggable={false}
              />
            </div>
          ))}

          {/* Decorative plants */}
          {[
            { x: 0.05, y: 0.06 },
            { x: 0.95, y: 0.06 },
            { x: 0.05, y: 0.9 },
            { x: 0.95, y: 0.9 },
            { x: 0.55, y: 0.5 },
          ].map((pos, i) => (
            <img
              key={`plant-${i}`}
              src="/assets/office/plant.svg"
              alt=""
              className="absolute w-[36px] h-auto"
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                transform: "translate(-50%, -50%)",
                imageRendering: "pixelated",
              }}
              draggable={false}
            />
          ))}

          {/* Agent characters - positions animate via CSS transition */}
          {agentPositions.map(({ id, agent, sprite }) => {
            const pos = agentRenderPositions.get(id) ?? {
              x: 0.5,
              y: 0.5,
            };
            const activeBubble = bubbles
              .filter((b) => b.agentId === id)
              .slice(-1)[0];
            const state = agentStates[id] ?? "idle";
            const animClass =
              state === "idle"
                ? "agent-anim-idle"
                : state === "thinking"
                  ? "agent-anim-thinking"
                  : state === "working"
                    ? "agent-anim-working"
                    : "agent-anim-handoff";
            const tooltip = getAgentTooltip(id, agent, state);

            return (
              <div
                key={`agent-${id}`}
                className="absolute group"
                style={{
                  left: `${pos.x * 100}%`,
                  top: `${pos.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: Math.floor(pos.y * 100) + 10,
                  transition: "left 0.8s ease-in-out, top 0.8s ease-in-out",
                }}
                title={tooltip}
              >
                {/* Speech bubble */}
                {activeBubble && (
                  <SpeechBubbleEl bubble={activeBubble} />
                )}

                {/* Character sprite with state animation */}
                <img
                  src={avatar}
                  alt={agent.name}
                  className={`w-[36px] h-auto mx-auto ${animClass}`}
                  style={{ imageRendering: "pixelated" }}
                  draggable={false}
                />

                {/* Hover tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-card border border-border text-[10px] rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                  {tooltip}
                </div>

                {/* Agent name label */}
                <div className="text-[9px] text-center font-bold text-foreground mt-0.5 bg-background/80 px-1.5 py-0.5 whitespace-nowrap">
                  @{id}
                </div>
              </div>
            );
          })}

          {/* User avatar in bottom-left */}
          {bubbles.some((b) => b.agentId.startsWith("_user_")) && (
            <div
              className="absolute"
              style={{ left: "8%", bottom: "8%", zIndex: 50 }}
            >
              {(() => {
                const userBubble = bubbles
                  .filter((b) => b.agentId.startsWith("_user_"))
                  .slice(-1)[0];
                return userBubble ? (
                  <>
                    <div className="relative mb-1 max-w-[360px] bg-primary text-primary-foreground text-[11px] px-3 py-2 rounded-sm animate-slide-up shadow-md">
                      <p className="line-clamp-4 break-words">{userBubble.message}</p>
                      <div className="absolute -bottom-1 left-4 w-2 h-2 bg-primary rotate-45" />
                    </div>
                    <img
                      src="/assets/office/char_player.svg"
                      alt="User"
                      className="w-[36px] h-auto mx-auto"
                      style={{ imageRendering: "pixelated" }}
                      draggable={false}
                    />
                    <div className="text-[9px] text-center font-bold text-foreground mt-0.5 bg-background/80 px-1.5 py-0.5">
                      You
                    </div>
                  </>
                ) : null;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Status bar for chain events */}
      <div className="border-t bg-card px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            Activity
          </span>
          {statusEvents.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/50">No recent activity</span>
          ) : (
            statusEvents.slice(0, 8).map((evt) => (
              <div key={evt.id} className="flex items-center gap-1.5 shrink-0">
                <div className={`h-1.5 w-1.5 shrink-0 ${statusColor(evt.type)}`} />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {evt.type.replace(/_/g, " ")}
                  {evt.agentId ? ` @${evt.agentId}` : ""}
                </span>
                <span className="text-[9px] text-muted-foreground/50">
                  {timeAgo(evt.timestamp)}
                </span>
                <span className="text-muted-foreground/20 mx-0.5">|</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SpeechBubbleEl({ bubble }: { bubble: SpeechBubble }) {
  const segments = parseMessage(bubble.message);

  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-slide-up"
      style={{ zIndex: 100 }}
    >
      <div className="relative max-w-[400px] min-w-[120px] bg-card border border-border text-[11px] leading-relaxed px-3 py-2 rounded-sm shadow-md">
        <div className="break-words text-foreground space-y-1">
          {segments.map((seg, i) =>
            seg.type === "mention" ? (
              <div key={i}>
                <span className="font-bold text-primary">@{seg.agent}</span>
                <span className="text-muted-foreground">: </span>
                <span>{seg.text.length > 150 ? seg.text.slice(0, 150) + "..." : seg.text}</span>
              </div>
            ) : (
              <span key={i}>
                {seg.text.length > 200 ? seg.text.slice(0, 200) + "..." : seg.text}
              </span>
            )
          )}
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-card border-b border-r border-border rotate-45" />
      </div>
    </div>
  );
}

function statusColor(type: string): string {
  switch (type) {
    case "agent_routed":
      return "bg-blue-500";
    case "chain_step_start":
      return "bg-yellow-500";
    case "chain_handoff":
      return "bg-orange-500";
    case "team_chain_start":
      return "bg-purple-500";
    case "team_chain_end":
      return "bg-purple-400";
    case "message_enqueued":
      return "bg-cyan-500";
    case "processor_start":
      return "bg-primary";
    default:
      return "bg-muted-foreground/40";
  }
}
