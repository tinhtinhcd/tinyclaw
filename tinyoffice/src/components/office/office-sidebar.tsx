"use client";

import { getLabelForState } from "@/lib/office-state";
import { inferRoleFromAgentId } from "@/lib/office-layout";
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
      <aside className="w-64 shrink-0 border-l border-border/60 bg-muted/20 flex flex-col">
        <div className="p-4">
          <p className="text-xs text-muted-foreground">
            Click an agent to view details
          </p>
        </div>
      </aside>
    );
  }

  const agent = agents[selectedAgentId];
  if (!agent) return null;

  const role = (agent.role || inferRoleFromAgentId(selectedAgentId))
    .toLowerCase()
    .replace(" ", "_");
  const r = role === "pm" ? "scrum_master" : role;
  const state = agentStates[selectedAgentId] ?? "idle";
  const label = getLabelForState(r, state);

  return (
    <aside className="w-64 shrink-0 border-l border-border/60 bg-muted/20 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border/60">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Details
        </h3>
        <p className="text-sm font-medium mt-1">@{selectedAgentId}</p>
        <p className="text-xs text-muted-foreground">Role: {r}</p>
      </div>

      <div className="p-4 border-b border-border/60">
        <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
          Status
        </h4>
        <p className="text-sm">{label}</p>
      </div>

      {recentBubble && (
        <div className="flex-1 overflow-auto p-4">
          <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Recent Message
          </h4>
          <p className="text-xs text-foreground/90 line-clamp-6 break-words">
            {recentBubble.message.length > 200
              ? recentBubble.message.slice(0, 200) + "..."
              : recentBubble.message}
          </p>
        </div>
      )}

      <div className="p-4 border-t border-border/60">
        <p className="text-[10px] text-muted-foreground">
          {agent.provider} / {agent.model}
        </p>
      </div>
    </aside>
  );
}
