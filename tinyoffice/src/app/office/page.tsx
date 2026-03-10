"use client";

import { useState, useEffect } from "react";
import { usePolling } from "@/lib/hooks";
import { getAgents, getTeams, type AgentConfig, type TeamConfig } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { useOfficeEvents } from "@/lib/use-office-events";
import { useHeader } from "@/lib/header-context";
import { OfficeScene } from "@/components/office/office-scene";
import { ActivityRail } from "@/components/office/activity-rail";
import { OfficeSidebar } from "@/components/office/office-sidebar";

export default function OfficePage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const header = useHeader();

  const {
    bubbles,
    statusEvents,
    connected,
    agentStates,
    handoffTargets,
  } = useOfficeEvents(agents ?? undefined);

  const agentEntries = agents ? Object.entries(agents) : [];
  const teamEntries = teams ? Object.entries(teams) : [];

  useEffect(() => {
    header?.setRightSlot(
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="text-[10px] font-normal">
          {agentEntries.length} agent{agentEntries.length !== 1 ? "s" : ""}
        </Badge>
        {teamEntries.length > 0 && (
          <Badge variant="outline" className="text-[10px] font-normal">
            {teamEntries.length} team{teamEntries.length !== 1 ? "s" : ""}
          </Badge>
        )}
        <div className="flex items-center gap-1.5">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/60"
            }`}
          />
          <span className="text-[10px] text-muted-foreground">
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>
      </div>
    );
    return () => header?.setRightSlot(null);
  }, [header, agentEntries.length, teamEntries.length, connected]);

  const selectedAgentBubble = selectedAgentId
    ? bubbles.filter((b) => b.agentId === selectedAgentId).slice(-1)[0]
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Main content: scene + optional right panel */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 flex-col min-w-0 p-4 gap-4">
          {/* Office scene card */}
          <div className="flex-1 min-h-0 flex flex-col">
            <OfficeScene
              agents={agents ?? {}}
              agentStates={agentStates}
              handoffTargets={handoffTargets}
              bubbles={bubbles}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
            />
          </div>

          {/* Activity rail */}
          <ActivityRail events={statusEvents} />
        </div>

        {/* Right panel: agent details */}
        <OfficeSidebar
          selectedAgentId={selectedAgentId}
          agents={agents ?? {}}
          agentStates={agentStates}
          recentBubble={selectedAgentBubble}
        />
      </div>
    </div>
  );
}
