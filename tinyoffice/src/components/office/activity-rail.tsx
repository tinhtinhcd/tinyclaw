"use client";

import { timeAgo } from "@/lib/hooks";

export interface StatusEvent {
  id: string;
  type: string;
  agentId?: string;
  timestamp: number;
  detail?: string;
}

function eventIcon(type: string): string {
  switch (type) {
    case "agent_routed":
      return "📨";
    case "chain_step_start":
      return "⚡";
    case "chain_handoff":
      return "🤝";
    case "team_chain_start":
      return "🏁";
    case "team_chain_end":
      return "🏆";
    case "message_enqueued":
      return "📥";
    case "processor_start":
      return "⚙️";
    default:
      return "•";
  }
}

function eventColor(type: string): string {
  switch (type) {
    case "agent_routed":
      return "#66aaff";
    case "chain_step_start":
      return "#ffaa33";
    case "chain_handoff":
      return "#ff8844";
    case "team_chain_start":
      return "#aa88ff";
    case "team_chain_end":
      return "#9977ee";
    case "message_enqueued":
      return "#44cccc";
    case "processor_start":
      return "#66ff66";
    default:
      return "#888";
  }
}

export function ActivityRail({ events }: { events: StatusEvent[] }) {
  return (
    <div className="office-activity-rail">
      <span className="office-activity-title">
        ▸ Activity Log
      </span>
      {events.length === 0 ? (
        <span className="text-[10px] text-[#555] font-mono">Waiting for events...</span>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto">
          {events.slice(0, 8).map((evt) => (
            <div key={evt.id} className="flex items-center gap-1 shrink-0">
              <span className="text-[10px]">{eventIcon(evt.type)}</span>
              <span
                className="text-[10px] font-mono whitespace-nowrap"
                style={{ color: eventColor(evt.type) }}
              >
                {evt.type.replace(/_/g, " ")}
                {evt.agentId ? ` @${evt.agentId}` : ""}
              </span>
              <span className="text-[9px] text-[#555] font-mono">
                {timeAgo(evt.timestamp)}
              </span>
              <span className="text-[#333] mx-0.5 text-[10px]">│</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
