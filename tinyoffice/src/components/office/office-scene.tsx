"use client";

import { AgentAvatar } from "./agent-avatar";
import { OfficeDecorations } from "./office-decorations";
import { getAvatarForRole } from "@/lib/office-utils";
import {
  getLayoutForAgent,
  inferRoleFromAgentId,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  WALL_HEIGHT,
} from "@/lib/office-layout";
import { resolveRenderPosition } from "@/lib/office-animations";
import type { AgentConfig } from "@/lib/api";
import type { AgentActivityState } from "@/lib/office-state";
import type { SpeechBubble } from "./agent-bubble";

const MEETING_OFFSET = 12;

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
    const role = ((agent as { role?: string }).role || inferRoleFromAgentId(id)).toLowerCase().replace(" ", "_");
    const r = role === "pm" ? "scrum_master" : role;
    const layout = getLayoutForAgent(id, r);
    const idx = roleCount.get(r) ?? 0;
    roleCount.set(r, idx + 1);
    const offset = idx * 40;
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

  // Compute render positions (home or handoff target)
  const agentRenderPositions = new Map<string, { x: number; y: number }>();
  for (const ap of agentPositions) {
    const state = agentStates[ap.id] ?? "idle";
    const handoffTarget = handoffTargets[ap.id];
    agentRenderPositions.set(
      ap.id,
      resolveRenderPosition(ap.homePos, state, handoffTarget)
    );
  }

  // Meeting midpoints for bubble-based interactions
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
      x: Math.round(midX - nx * MEETING_OFFSET),
      y: Math.round(midY - ny * MEETING_OFFSET),
    });
    for (const targetId of bubble.targetAgents) {
      if (!latestBubblePerAgent.has(targetId) && deskPosMap.has(targetId)) {
        const tDesk = deskPosMap.get(targetId)!;
        const tdx = tDesk.x - fromDesk.x;
        const tdy = tDesk.y - fromDesk.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
        agentRenderPositions.set(targetId, {
          x: Math.round((fromDesk.x + tDesk.x) / 2 + (tdx / tdist) * MEETING_OFFSET),
          y: Math.round((fromDesk.y + tDesk.y) / 2 + (tdy / tdist) * MEETING_OFFSET),
        });
      }
    }
  }

  return (
    <div className="office-scene-container">
      <div
        className="office-scene"
        style={{
          aspectRatio: `${OFFICE_WIDTH} / ${OFFICE_HEIGHT}`,
        }}
      >
        {/* Wall strip */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: `${(WALL_HEIGHT / OFFICE_HEIGHT) * 100}%`,
            backgroundImage: "url(/assets/office/wall_tile.svg)",
            backgroundSize: "32px 32px",
            backgroundRepeat: "repeat",
            imageRendering: "pixelated",
          }}
        />

        {/* Floor */}
        <div
          className="absolute inset-x-0 bottom-0"
          style={{
            top: `${(WALL_HEIGHT / OFFICE_HEIGHT) * 100}%`,
            backgroundImage: "url(/assets/office/floor_tile.svg)",
            backgroundSize: "32px 32px",
            backgroundRepeat: "repeat",
            imageRendering: "pixelated",
          }}
        />

        {/* Decorations */}
        <OfficeDecorations />

        {/* Desks (below agents in z-order) */}
        {agentPositions.map(({ id, deskPos }) => (
          <div
            key={`desk-${id}`}
            className="absolute"
            style={{
              left: `${(deskPos.x / OFFICE_WIDTH) * 100}%`,
              top: `${(deskPos.y / OFFICE_HEIGHT) * 100}%`,
              transform: "translate(-50%, -50%)",
              zIndex: Math.floor(deskPos.y),
            }}
          >
            <img
              src="/assets/office/desk.svg"
              alt=""
              className="w-[48px] h-[32px]"
              style={{ imageRendering: "pixelated" }}
              draggable={false}
            />
            <img
              src="/assets/office/monitor.svg"
              alt=""
              className="absolute w-[20px] h-auto"
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
              className="absolute w-[16px] h-auto"
              style={{
                bottom: "-14px",
                left: "50%",
                transform: "translateX(-50%)",
                imageRendering: "pixelated",
              }}
              draggable={false}
            />
          </div>
        ))}

        {/* Agents */}
        {agentPositions.map(({ id, agent, role, avatar }) => {
          const pos = agentRenderPositions.get(id) ?? { x: OFFICE_WIDTH / 2, y: OFFICE_HEIGHT / 2 };
          const activeBubble = bubbles
            .filter((b) => b.agentId === id)
            .slice(-1)[0];
          const state = agentStates[id] ?? "idle";

          return (
            <AgentAvatar
              key={`agent-${id}`}
              id={id}
              agent={agent}
              role={(agent as { role?: string }).role || inferRoleFromAgentId(id)}
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
            style={{
              left: `${(60 / OFFICE_WIDTH) * 100}%`,
              bottom: `${(40 / OFFICE_HEIGHT) * 100}%`,
              zIndex: 500,
            }}
          >
            {(() => {
              const userBubble = bubbles
                .filter((b) => b.agentId.startsWith("_user_"))
                .slice(-1)[0];
              return userBubble ? (
                <>
                  <div className="office-speech-bubble mb-1 max-w-[240px]">
                    <p className="line-clamp-3 break-words">{userBubble.message}</p>
                    <div
                      className="absolute -bottom-[6px] left-3 w-[8px] h-[6px]"
                      style={{
                        background: "#1a1a2e",
                        clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                      }}
                    />
                  </div>
                  <img
                    src="/assets/office/char_player.svg"
                    alt="You"
                    className="w-[32px] h-[48px] mx-auto"
                    style={{ imageRendering: "pixelated" }}
                    draggable={false}
                  />
                  <div className="office-agent-label">You</div>
                </>
              ) : null;
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
