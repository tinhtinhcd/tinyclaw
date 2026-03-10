"use client";

import { useState, useEffect } from "react";
import { usePolling } from "@/lib/hooks";
import { getAgents, getTeams, type AgentConfig, type TeamConfig } from "@/lib/api";
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
      <div className="flex items-center gap-3 font-mono text-[10px]">
        <span className="text-[#888]">
          {agentEntries.length} agent{agentEntries.length !== 1 ? "s" : ""}
        </span>
        {teamEntries.length > 0 && (
          <span className="text-[#888]">
            {teamEntries.length} team{teamEntries.length !== 1 ? "s" : ""}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-[#66ff66] animate-pulse" : "bg-[#666]"
            }`}
          />
          <span className={connected ? "text-[#66ff66]" : "text-[#666]"}>
            {connected ? "LIVE" : "OFF"}
          </span>
        </div>
      </div>
    );
    return () => header?.setRightSlot(null);
  }, [header?.setRightSlot, agentEntries.length, teamEntries.length, connected]);

  const selectedAgentBubble = selectedAgentId
    ? bubbles.filter((b) => b.agentId === selectedAgentId).slice(-1)[0]
    : null;

  return (
    <div className="flex h-full flex-col bg-[#0a0a0c]">
      {/* Main content: scene + sidebar */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 flex-col min-w-0">
          {/* Office scene */}
          <OfficeScene
            agents={agents ?? {}}
            agentStates={agentStates}
            handoffTargets={handoffTargets}
            bubbles={bubbles}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />

          {/* Activity rail (game console at bottom) */}
          <div className="px-2 pb-2">
            <ActivityRail events={statusEvents} />
          </div>
        </div>

        {/* Sidebar */}
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
