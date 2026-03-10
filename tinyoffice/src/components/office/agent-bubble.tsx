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
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 animate-slide-up"
      style={{ zIndex: 100 }}
    >
      <div className="office-speech-bubble">
        <div className="break-words space-y-0.5">
          {segments.map((seg, i) =>
            seg.type === "mention" ? (
              <div key={i}>
                <span className="font-bold text-[#66ff66]">@{seg.agent}</span>
                <span className="text-[#999]">: </span>
                <span>
                  {seg.text.length > 100 ? seg.text.slice(0, 100) + "..." : seg.text}
                </span>
              </div>
            ) : (
              <span key={i}>
                {seg.text.length > 140 ? seg.text.slice(0, 140) + "..." : seg.text}
              </span>
            )
          )}
        </div>
        {/* Pixel speech bubble tail */}
        <div className="absolute -bottom-[6px] left-1/2 -translate-x-1/2 w-[8px] h-[6px]"
          style={{
            background: "#1a1a2e",
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}
        />
      </div>
    </div>
  );
}
