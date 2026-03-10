"use client";

import { AgentBubble } from "./agent-bubble";
import { getAgentTooltip } from "@/lib/office-utils";
import type { AgentConfig } from "@/lib/api";
import type { AgentActivityState } from "@/lib/office-state";
import type { SpeechBubble } from "./agent-bubble";

interface AgentAvatarProps {
  id: string;
  agent: AgentConfig;
  role: string;
  avatar: string;
  position: { x: number; y: number };
  state: AgentActivityState;
  activeBubble?: SpeechBubble | null;
  onSelect?: () => void;
}

export function AgentAvatar({
  id,
  agent,
  position,
  state,
  activeBubble,
  onSelect,
}: AgentAvatarProps) {
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
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect?.()}
      className="absolute group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
        transform: "translate(-50%, -50%)",
        zIndex: Math.floor(position.y * 100) + 10,
        transition: "left 0.8s ease-in-out, top 0.8s ease-in-out",
      }}
      title={tooltip}
    >
      {activeBubble && <AgentBubble bubble={activeBubble} />}

      <img
        src={avatar}
        alt={agent.name}
        className={`w-[32px] h-auto mx-auto ${animClass}`}
        style={{ imageRendering: "pixelated" }}
        draggable={false}
      />

      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-card/95 border border-border/60 text-[10px] rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        {tooltip}
      </div>

      <div className="text-[8px] text-center font-medium text-foreground/90 mt-0.5 bg-background/70 px-1 py-0.5 rounded whitespace-nowrap">
        @{id}
      </div>
    </div>
  );
}
