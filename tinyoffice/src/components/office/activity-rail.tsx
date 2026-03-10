"use client";

import { timeAgo } from "@/lib/hooks";

export interface StatusEvent {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
  detail?: string;
}

function statusColor(type: string): string {
  switch (type) {
    case "agent_routed":
      return "bg-blue-500/80";
    case "chain_step_start":
      return "bg-amber-500/80";
    case "chain_handoff":
      return "bg-orange-500/80";
    case "team_chain_start":
      return "bg-violet-500/80";
    case "team_chain_end":
      return "bg-violet-400/80";
    case "message_enqueued":
      return "bg-cyan-500/80";
    case "processor_start":
      return "bg-primary/80";
    default:
      return "bg-muted-foreground/50";
  }
}

export function ActivityRail({ events }: { events: StatusEvent[] }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1.5 px-3 border-t border-border/60 bg-muted/30">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider shrink-0">
        Activity
      </span>
      {events.length === 0 ? (
        <span className="text-[10px] text-muted-foreground/70">No recent activity</span>
      ) : (
        events.slice(0, 8).map((evt) => (
          <div key={evt.id} className="flex items-center gap-1.5 shrink-0">
            <div
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(evt.type)}`}
            />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {evt.type.replace(/_/g, " ")}
              {evt.agentId ? ` @${evt.agentId}` : ""}
            </span>
            <span className="text-[9px] text-muted-foreground/60">
              {timeAgo(evt.timestamp)}
            </span>
            <span className="text-muted-foreground/20 mx-0.5">|</span>
          </div>
        ))
      )}
    </div>
  );
}
