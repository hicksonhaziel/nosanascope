"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChatIcon, SendIcon } from "../icons";
import type { ChatApiResponse, ChatMessage } from "@/types/metrics";

interface ChatInterfaceProps {
  agentId?: string;
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function getStoredUserId(): string {
  const key = "nosana-dashboard-user-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

export function ChatInterface({ agentId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage("system", "Chat ready. Ask for live Nosana status, jobs, credits, or failures."),
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setUserId(getStoredUserId());
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const messageText = input.trim();
    if (!messageText || isSending || !userId) return;

    const userMessage = createMessage("user", messageText);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          userId,
          sessionId,
          agentId,
        }),
      });

      const payload = (await response.json()) as ChatApiResponse;
      if (!response.ok || !payload.ok || !payload.message) {
        throw new Error(payload.error || "Chat request failed");
      }

      if (payload.sessionId) setSessionId(payload.sessionId);
      setMessages((prev) => [...prev, payload.message as ChatMessage]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        createMessage(
          "system",
          error instanceof Error ? error.message : "Could not reach agent chat endpoint."
        ),
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="panel flex h-[460px] flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
        <ChatIcon className="h-5 w-5 text-[var(--accent)]" />
        <h2 className="text-base font-semibold tracking-wide text-[var(--text)]">Agent Chat</h2>
      </header>

      <div
        ref={scrollRef}
        className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3"
      >
        <AnimatePresence initial={false}>
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isAssistant = message.role === "assistant";
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className={`max-w-[88%] rounded-md px-3 py-2 text-sm leading-6 ${
                  isUser
                    ? "ml-auto bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text)]"
                    : isAssistant
                      ? "bg-[var(--surface)] text-[var(--text)]"
                      : "bg-[color-mix(in_srgb,var(--muted)_18%,transparent)] text-[var(--muted-strong)]"
                }`}
              >
                {message.content}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none ring-0 placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          placeholder="Ask NosanaScope anything..."
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="inline-flex h-11 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon className="h-4 w-4" />
          {isSending ? "..." : "Send"}
        </button>
      </form>
    </section>
  );
}

