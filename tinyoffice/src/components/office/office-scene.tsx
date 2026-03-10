"use client";

import { AgentAvatar } from "./agent-avatar";
import { getAvatarForRole } from "@/lib/office-utils";
import { getLayoutForAgent, inferRoleFromAgentId } from "@/lib/office-layout";
import type { AgentConfig } from "@/lib/api";
import type { AgentActivityState } from "@/lib/office-state";
import type { SpeechBubble } from "./agent-bubble";

const MEETING_OFFSET = 0.03;

interface AgentPosition {
  id: string;
  agent: AgentConfig;
  role: string;
  deskPos: { x: number; y: number };
  homePos: { x: number; y: number };
  avatar: string;
}

interface OfficeSceneProps {
  agents: Record<string, AgentConfig>;
  agentStates: Record<string, AgentActivityState>;
  handoffTargets: Record<string, { x: number; y: number }>;
  bubbles: SpeechBubble[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

export function OfficeScene({
  agents,
  agentStates,
  handoffTargets,
  bubbles,
  selectedAgentId,
  onSelectAgent,
}: OfficeSceneProps) {
  const agentEntries = Object.entries(agents);
  const roleCount = new Map<string, number>();

  const agentPositions: AgentPosition[] = agentEntries.map(([id, agent]) => {
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
      avatar: getAvatarForRole(r),
    };
  });

  const deskPosMap = new Map(agentPositions.map((a) => [a.id, a.homePos]));

  const agentRenderPositions = new Map<string, { x: number; y: number }>();
  for (const ap of agentPositions) {
    const handoffTarget = handoffTargets[ap.id];
    if (handoffTarget && agentStates[ap.id] === "handoff") {
      agentRenderPositions.set(ap.id, handoffTarget);
    } else {
      agentRenderPositions.set(ap.id, ap.homePos);
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
    agentRenderPositions.set(agentId, {
      x: midX - nx * MEETING_OFFSET,
      y: midY - ny * MEETING_OFFSET,
    });
    for (const targetId of bubble.targetAgents) {
      if (!latestBubblePerAgent.has(targetId) && deskPosMap.has(targetId)) {
        const tDesk = deskPosMap.get(targetId)!;
        const tdx = tDesk.x - fromDesk.x;
        const tdy = tDesk.y - fromDesk.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
        agentRenderPositions.set(targetId, {
          x: (fromDesk.x + tDesk.x) / 2 + (tdx / tdist) * MEETING_OFFSET,
          y: (fromDesk.y + tDesk.y) / 2 + (tdy / tdist) * MEETING_OFFSET,
        });
      }
    }
  }

  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-border/60 bg-muted/20">
      {/* Floor */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: "url(/assets/office/floor_tile.svg)",
          backgroundSize: "32px 32px",
          backgroundRepeat: "repeat",
          imageRendering: "pixelated",
        }}
      />

      {/* Desks */}
      {agentPositions.map(({ id, deskPos }) => (
        <div
          key={`desk-${id}`}
          className="absolute opacity-90"
          style={{
            left: `${deskPos.x * 100}%`,
            top: `${deskPos.y * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <img
            src="/assets/office/desk.svg"
            alt=""
            className="w-[56px] h-[32px]"
            style={{ imageRendering: "pixelated" }}
            draggable={false}
          />
          <img
            src="/assets/office/monitor.svg"
            alt=""
            className="absolute w-[22px] h-auto"
            style={{
              top: "-10px",
              left: "50%",
              transform: "translateX(-50%)",
              imageRendering: "pixelated",
            }}
            draggable={false}
          />
          <img
            src="/assets/office/chair.svg"
            alt=""
            className="absolute w-[18px] h-auto"
            style={{
              bottom: "-16px",
              left: "50%",
              transform: "translateX(-50%)",
              imageRendering: "pixelated",
            }}
            draggable={false}
          />
        </div>
      ))}

      {/* Agents */}
      {agentPositions.map(({ id, agent, avatar }) => {
        const pos = agentRenderPositions.get(id) ?? { x: 0.5, y: 0.5 };
        const activeBubble = bubbles
          .filter((b) => b.agentId === id)
          .slice(-1)[0];
        const state = agentStates[id] ?? "idle";

        return (
          <AgentAvatar
            key={`agent-${id}`}
            id={id}
            agent={agent}
            role={agent.role || inferRoleFromAgentId(id)}
            avatar={avatar}
            position={pos}
            state={state}
            activeBubble={activeBubble}
            onSelect={() => onSelectAgent(selectedAgentId === id ? null : id)}
          />
        );
      })}

      {/* User avatar */}
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
                <div className="relative mb-1 max-w-[280px] bg-primary/90 text-primary-foreground text-[10px] px-2.5 py-1.5 rounded shadow-sm">
                  <p className="line-clamp-3 break-words">{userBubble.message}</p>
                  <div className="absolute -bottom-1 left-3 w-1.5 h-1.5 bg-primary/90 rotate-45" />
                </div>
                <img
                  src="/assets/office/char_player.svg"
                  alt="User"
                  className="w-[28px] h-auto mx-auto"
                  style={{ imageRendering: "pixelated" }}
                  draggable={false}
                />
                <div className="text-[8px] text-center font-medium text-foreground/90 mt-0.5 bg-background/70 px-1 py-0.5 rounded">
                  You
                </div>
              </>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}
