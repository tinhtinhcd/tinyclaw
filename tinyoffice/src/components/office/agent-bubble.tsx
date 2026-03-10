"use client";

import { parseMessage } from "@/lib/office-utils";

export interface SpeechBubble {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  targetAgents: string[];
}

export function AgentBubble({ bubble }: { bubble: SpeechBubble }) {
  const segments = parseMessage(bubble.message);

  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-slide-up"
      style={{ zIndex: 100 }}
    >
      <div className="relative max-w-[320px] min-w-[100px] bg-card border border-border/80 text-[11px] leading-relaxed px-2.5 py-1.5 rounded shadow-md">
        <div className="break-words text-foreground space-y-0.5">
          {segments.map((seg, i) =>
            seg.type === "mention" ? (
              <div key={i}>
                <span className="font-semibold text-primary">@{seg.agent}</span>
                <span className="text-muted-foreground">: </span>
                <span>
                  {seg.text.length > 120 ? seg.text.slice(0, 120) + "..." : seg.text}
                </span>
              </div>
            ) : (
              <span key={i}>
                {seg.text.length > 160 ? seg.text.slice(0, 160) + "..." : seg.text}
              </span>
            )
          )}
        </div>
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-card border-b border-r border-border/80 rotate-45" />
      </div>
    </div>
  );
}
