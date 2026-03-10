"use client";

import { getAnimationClass, getStateIndicator } from "@/lib/office-animations";
import { getAgentTooltip } from "@/lib/office-utils";
import { OFFICE_WIDTH, OFFICE_HEIGHT } from "@/lib/office-layout";
import type { AgentConfig } from "@/lib/api";
import type { AgentActivityState } from "@/lib/office-state";
import { AgentBubble } from "./agent-bubble";
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
  role,
  avatar,
  position,
  state,
  activeBubble,
  onSelect,
}: AgentAvatarProps) {
  const animClass = getAnimationClass(state);
  const indicator = getStateIndicator(state);
  const tooltip = getAgentTooltip(id, agent, state);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect?.()}
      className="absolute group cursor-pointer focus:outline-none"
      style={{
        left: `${(position.x / OFFICE_WIDTH) * 100}%`,
        top: `${(position.y / OFFICE_HEIGHT) * 100}%`,
        transform: "translate(-50%, -100%)",
        zIndex: Math.floor(position.y) + 10,
        transition: "left 0.8s ease-in-out, top 0.8s ease-in-out",
      }}
      title={tooltip}
    >
      {/* Speech bubble */}
      {activeBubble && <AgentBubble bubble={activeBubble} />}

      {/* State indicator */}
      {indicator && (
        <div className="absolute -top-1 -right-1 text-[10px] leading-none z-20 drop-shadow-sm">
          {indicator}
        </div>
      )}

      {/* Sprite */}
      <img
        src={avatar}
        alt={agent.name}
        className={`w-[32px] h-[48px] mx-auto ${animClass}`}
        style={{ imageRendering: "pixelated" }}
        draggable={false}
      />

      {/* Hover tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-[#1a1a2e]/95 text-[#e0e0e0] text-[9px] font-mono rounded-sm shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-[#333]/80">
        {tooltip}
      </div>

      {/* Name label */}
      <div className="office-agent-label">
        @{id}
      </div>
    </div>
  );
}
