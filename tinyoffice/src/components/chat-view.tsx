"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { timeAgo } from "@/lib/hooks";
import {
  sendMessage,
  subscribeToEvents,
  type EventData,
} from "@/lib/api";
import {
  type ChatMessage,
  type DebugEvent,
  CHAT_MESSAGE_EVENTS,
  getAgentDisplayName,
} from "@/lib/chat-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Loader2,
  Bug,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface ChatViewProps {
  /** The @prefix target, e.g. "@coder" or "@backend-team" */
  target: string;
  /** Display label, e.g. "Coder" or "Backend Team" */
  targetLabel: string;
  /** Optional agent role for context display */
  agentRole?: string;
}

export function ChatView({ target, targetLabel, agentRole }: ChatViewProps) {
  const searchParams = useSearchParams();
  const showDebug = searchParams.get("debug") === "true";

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef(new Set<string>());
  // Track response_ready message IDs to deduplicate with chain_step_done
  const seenResponsesRef = useRef(new Set<string>());

  // Auto-scroll on new messages
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // SSE event subscription
  useEffect(() => {
    const unsub = subscribeToEvents(
      (event: EventData) => {
        setConnected(true);
        const e = event as Record<string, unknown>;

        // Deduplicate
        const fp = `${event.type}:${event.timestamp}:${e.messageId ?? ""}:${e.agentId ?? ""}`;
        if (seenRef.current.has(fp)) return;
        seenRef.current.add(fp);
        if (seenRef.current.size > 500) {
          const entries = [...seenRef.current];
          seenRef.current = new Set(entries.slice(entries.length - 300));
        }

        const eventType = String(e.type || "");
        const agentId = e.agentId ? String(e.agentId) : undefined;
        const responseText = e.responseText ? String(e.responseText) : undefined;
        const msgText = e.message ? String(e.message) : undefined;
        const msgId = `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`;

        // --- Chat message events ---
        if (CHAT_MESSAGE_EVENTS.has(eventType)) {
          const content = responseText || msgText;
          if (content && agentId) {
            // Deduplicate: if we already saw a response_ready for this agent around this time, skip
            const dedupeKey = `${agentId}:${content.slice(0, 50)}`;
            if (seenResponsesRef.current.has(dedupeKey)) return;
            seenResponsesRef.current.add(dedupeKey);
            // Trim dedup set
            if (seenResponsesRef.current.size > 100) {
              const entries = [...seenResponsesRef.current];
              seenResponsesRef.current = new Set(entries.slice(entries.length - 50));
            }

            setMessages((prev) => [
              ...prev,
              {
                id: msgId,
                role: "agent",
                agentId,
                agentName: getAgentDisplayName(agentId),
                content,
                timestamp: event.timestamp,
              },
            ].slice(-200));
          }
        }

        // --- Incoming user message (from another channel) ---
        if (eventType === "message_received") {
          const content = msgText;
          const sender = e.sender ? String(e.sender) : undefined;
          if (content && sender) {
            setMessages((prev) => [
              ...prev,
              {
                id: msgId,
                role: "user",
                content,
                timestamp: event.timestamp,
              },
            ].slice(-200));
          }
        }

        // --- All events go to debug stream ---
        setDebugEvents((prev) => [
          {
            id: msgId,
            type: eventType,
            agentId,
            timestamp: event.timestamp,
            detail: responseText || msgText,
            data: e,
          },
          ...prev,
        ].slice(0, 100));
      },
      () => setConnected(false)
    );
    return unsub;
  }, []);

  // Send message handler
  const handleSend = useCallback(async () => {
    if (!message.trim() || sending) return;

    const finalMessage = target ? `${target} ${message}` : message;
    setSending(true);

    try {
      const result = await sendMessage({
        message: finalMessage,
        sender: "Web",
        channel: "web",
      });

      setMessages((prev) => [
        ...prev,
        {
          id: result.messageId,
          role: "user",
          content: message,
          timestamp: Date.now(),
        },
      ]);

      setMessage("");
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "agent",
          agentId: "system",
          agentName: "System",
          content: `Error: ${(err as Error).message}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [message, target, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Chat header */}
      <div className="flex items-center justify-between border-b px-6 py-3 bg-card">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{targetLabel}</span>
            {target && (
              <span className="text-xs font-mono text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                {target}
              </span>
            )}
          </div>
          {agentRole && (
            <span className="text-xs text-muted-foreground">
              • {agentRole}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {showDebug && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] gap-1"
              onClick={() => setDebugOpen(!debugOpen)}
            >
              <Bug className="h-3 w-3" />
              Debug ({debugEvents.length})
              {debugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
          <div className="flex items-center gap-1.5">
            <div className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`} />
            <span className="text-[10px] text-muted-foreground">
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Send className="h-5 w-5 text-primary/60" />
            </div>
            <p className="text-sm text-muted-foreground">
              {target ? `Start a conversation with ${targetLabel}` : "Send a message to get started"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Ctrl+Enter to send
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg, i) => {
              const prevMsg = i > 0 ? messages[i - 1] : null;
              const showHeader = !prevMsg
                || prevMsg.role !== msg.role
                || (msg.role === "agent" && prevMsg.agentId !== msg.agentId)
                || (msg.timestamp - prevMsg.timestamp > 60000);

              return (
                <ChatBubble
                  key={msg.id}
                  message={msg}
                  showHeader={showHeader}
                />
              );
            })}
            <div ref={feedEndRef} />
          </div>
        )}
      </div>

      {/* Debug panel (hidden by default, ?debug=true to show) */}
      {showDebug && debugOpen && (
        <div className="border-t bg-muted/30 max-h-48 overflow-y-auto">
          <div className="px-4 py-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Runtime Events
            </p>
            {debugEvents.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/60">No events yet</p>
            ) : (
              <div className="space-y-0.5">
                {debugEvents.slice(0, 30).map((evt) => (
                  <div key={evt.id} className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                    <span className="text-muted-foreground/50 w-12 shrink-0">{timeAgo(evt.timestamp)}</span>
                    <span className={`font-semibold ${debugEventColor(evt.type)}`}>
                      {evt.type}
                    </span>
                    {evt.agentId && <span className="text-muted-foreground/70">@{evt.agentId}</span>}
                    {evt.detail && (
                      <span className="text-muted-foreground/50 truncate max-w-[200px]">
                        {evt.detail.slice(0, 80)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t px-6 py-4 bg-card">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            {target && (
              <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                <span>Talking to</span>
                <span className="font-semibold text-foreground">{targetLabel}</span>
              </p>
            )}
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={target ? `Message ${targetLabel}...` : "Type a message..."}
              rows={2}
              className="flex-1 text-sm resize-none min-h-[44px]"
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Ctrl+Enter to send
        </p>
      </div>
    </div>
  );
}

/* ─── Chat Bubble Component ─── */

function ChatBubble({ message, showHeader }: { message: ChatMessage; showHeader: boolean }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} ${showHeader ? "mt-4" : "mt-1"} animate-slide-up`}>
      <div className={`max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        {/* Header: agent name or "You" */}
        {showHeader && (
          <div className={`flex items-center gap-2 mb-1 ${isUser ? "justify-end" : "justify-start"}`}>
            <span className={`text-[11px] font-semibold ${isUser ? "text-primary" : "text-muted-foreground"}`}>
              {isUser ? "You" : message.agentName || message.agentId || "Agent"}
            </span>
            <span className="text-[9px] text-muted-foreground/60">
              {timeAgo(message.timestamp)}
            </span>
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`
            px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap rounded-lg
            ${isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm border border-border/60"
            }
          `}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}

/* ─── Debug helpers ─── */

function debugEventColor(type: string): string {
  if (type.includes("error") || type.includes("failed")) return "text-destructive";
  if (type.includes("start")) return "text-amber-500";
  if (type.includes("done") || type.includes("ready") || type.includes("succeeded")) return "text-emerald-500";
  if (type.includes("handoff")) return "text-orange-500";
  if (type.includes("routed") || type.includes("enqueued")) return "text-blue-400";
  return "text-muted-foreground";
}
