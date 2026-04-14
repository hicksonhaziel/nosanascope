"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { SendIcon } from "../icons";
import type { ChatApiResponse, ChatMessage } from "@/types/metrics";

interface ChatInterfaceProps {
  agentId?: string;
  logoSrc?: string;
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

function formatTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "--:--";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatInterface({ agentId, logoSrc = "/logos/nosanascope-chat-logo.png" }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage(
      "system",
      "Chat ready. Ask for live Nosana deployment status, credits, failures, or node health."
    ),
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
    <section className="panel flex h-[560px] flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-1.5">
            <Image
              src={logoSrc}
              alt="NosanaScope"
              width={44}
              height={44}
              className="h-11 w-11 object-contain"
              priority
            />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-wide text-[var(--text)]">NosanaScope Chat</h2>
            <p className="text-xs text-[var(--muted)]">Deployment assistant</p>
          </div>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-strong)]">
          Live
        </span>
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
                className={`max-w-[90%] rounded-xl px-3 py-2 text-sm leading-6 ${
                  isUser
                    ? "ml-auto border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text)]"
                    : isAssistant
                      ? "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                      : "border border-[var(--border)] bg-[color-mix(in_srgb,var(--muted)_18%,transparent)] text-[var(--muted-strong)]"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide opacity-80">
                  <span>{isUser ? "You" : isAssistant ? "Agent" : "System"}</span>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                <p>{message.content}</p>
              </motion.div>
            );
          })}
          {isSending ? (
            <motion.div
              key="assistant-typing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="max-w-[90%] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
            >
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] [animation-delay:240ms]" />
                agent responding
              </span>
            </motion.div>
          ) : null}
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
          className="inline-flex h-11 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-black transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_82%,white)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon className="h-4 w-4" />
          {isSending ? "Sending" : "Send"}
        </button>
      </form>
    </section>
  );
}
