"use client";

import { use } from "react";
import { usePolling } from "@/lib/hooks";
import { getAgents, getTeams, type AgentConfig, type TeamConfig } from "@/lib/api";
import { ChatView } from "@/components/chat-view";
import { Users, Crown, Bot } from "lucide-react";

export default function TeamChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 5000);
  const team = teams?.[id];

  return (
    <div className="flex h-full flex-col">
      {/* Team info bar */}
      {team && (
        <div className="border-b px-6 py-2.5 bg-card">
          <div className="flex items-center gap-2 mb-1.5">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{team.name}</span>
            <span className="text-xs font-mono text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
              @{id}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {team.agents.map((agentId) => {
              const agent = agents?.[agentId];
              const isLeader = agentId === team.leader_agent;
              return (
                <span
                  key={agentId}
                  className={`
                    inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded
                    ${isLeader ? "bg-primary/10 text-primary font-semibold" : "bg-muted text-muted-foreground"}
                  `}
                >
                  {isLeader ? <Crown className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
                  {agent?.name || agentId}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="flex-1 min-h-0">
        <ChatView
          target={`@${id}`}
          targetLabel={team?.name || `@${id}`}
        />
      </div>
    </div>
  );
}
