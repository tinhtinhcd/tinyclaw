"use client";

import { getLabelForState } from "@/lib/office-state";
import { inferRoleFromAgentId, getZoneForRole } from "@/lib/office-layout";
import { getAvatarForRole } from "@/lib/office-utils";
import { getStateIndicator } from "@/lib/office-animations";
import type { AgentConfig } from "@/lib/api";
import type { AgentActivityState } from "@/lib/office-state";

interface OfficeSidebarProps {
  selectedAgentId: string | null;
  agents: Record<string, AgentConfig>;
  agentStates: Record<string, AgentActivityState>;
  recentBubble?: { message: string } | null;
}

export function OfficeSidebar({
  selectedAgentId,
  agents,
  agentStates,
  recentBubble,
}: OfficeSidebarProps) {
  if (!selectedAgentId) {
    return (
      <aside className="office-sidebar">
        <div className="p-3">
          <p className="text-[10px] text-[#666] font-mono">
            ▸ Click an agent to inspect
          </p>
        </div>
      </aside>
    );
  }

  const agent = agents[selectedAgentId];
  if (!agent) return null;

  const role = ((agent as { role?: string }).role || inferRoleFromAgentId(selectedAgentId))
    .toLowerCase()
    .replace(" ", "_");
  const r = role === "pm" ? "scrum_master" : role;
  const state = agentStates[selectedAgentId] ?? "idle";
  const label = getLabelForState(r, state);
  const zone = getZoneForRole(r);
  const indicator = getStateIndicator(state);
  const avatar = getAvatarForRole(r);

  return (
    <aside className="office-sidebar">
      {/* Header */}
      <div className="p-3 border-b border-[#333]">
        <div className="flex items-center gap-2">
          <img
            src={avatar}
            alt={agent.name}
            className="w-[32px] h-[48px]"
            style={{ imageRendering: "pixelated" }}
            draggable={false}
          />
          <div>
            <p className="text-xs font-mono font-bold text-[#e0e0e0]">
              @{selectedAgentId}
            </p>
            <p className="text-[10px] font-mono text-[#888]">{r}</p>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="p-3 border-b border-[#333]">
        <h4 className="text-[9px] font-mono uppercase tracking-wider text-[#666] mb-1">
          Status
        </h4>
        <p className="text-xs font-mono text-[#e0e0e0]">
          {indicator} {label}
        </p>
      </div>

      {/* Zone */}
      <div className="p-3 border-b border-[#333]">
        <h4 className="text-[9px] font-mono uppercase tracking-wider text-[#666] mb-1">
          Location
        </h4>
        <p className="text-xs font-mono text-[#e0e0e0]">{zone}</p>
      </div>

      {/* Recent message */}
      {recentBubble && (
        <div className="flex-1 overflow-auto p-3 border-b border-[#333]">
          <h4 className="text-[9px] font-mono uppercase tracking-wider text-[#666] mb-1">
            Last Message
          </h4>
          <p className="text-[10px] font-mono text-[#aaa] line-clamp-6 break-words leading-relaxed">
            {recentBubble.message.length > 200
              ? recentBubble.message.slice(0, 200) + "..."
              : recentBubble.message}
          </p>
        </div>
      )}

      {/* Provider info */}
      <div className="p-3 mt-auto">
        <p className="text-[9px] font-mono text-[#555]">
          {agent.provider} / {agent.model}
        </p>
      </div>
    </aside>
  );
}
