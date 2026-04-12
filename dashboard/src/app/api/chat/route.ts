import { NextRequest, NextResponse } from "next/server";

// Eliza IDs may not always be strict RFC4122 v4. Accept generic 8-4-4-4-12 UUID shape.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AgentListResponse = {
  success?: boolean;
  data?: {
    agents?: Array<{ id: string; status?: string }>;
  };
};

type SessionCreateResponse = {
  sessionId?: string;
};

type SessionMessageResponse = {
  success?: boolean;
  agentResponse?: unknown;
};

type SessionHistoryResponse = {
  messages?: Array<{
    id?: string;
    content?: string;
    isAgent?: boolean;
    createdAt?: string | number | Date;
  }>;
};

function getAgentBaseUrl() {
  const raw = process.env.AGENT_API_BASE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

function getProxyHeaders(contentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (contentType) headers["Content-Type"] = "application/json";
  const apiKey = process.env.ELIZA_SERVER_AUTH_TOKEN?.trim();
  if (apiKey) headers["X-API-KEY"] = apiKey;
  return headers;
}

function ensureUuid(value?: string | null): string {
  const candidate = String(value || "").trim();
  if (UUID_RE.test(candidate)) return candidate;
  return crypto.randomUUID();
}

function extractAssistantText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";

  const obj = value as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text.trim();
  if (typeof obj.content === "string") return obj.content.trim();
  if (obj.response && typeof obj.response === "object") {
    const response = obj.response as Record<string, unknown>;
    if (typeof response.text === "string") return response.text.trim();
  }
  return "";
}

async function fetchActiveAgentId(baseUrl: string): Promise<string> {
  const configured = process.env.ELIZA_AGENT_ID?.trim();
  if (configured && UUID_RE.test(configured)) return configured;

  const response = await fetch(`${baseUrl}/api/agents`, {
    method: "GET",
    cache: "no-store",
    headers: getProxyHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to load agents from ${baseUrl}/api/agents: ${text}`);
  }

  const payload = (await response.json()) as AgentListResponse;
  const agents = payload?.data?.agents || [];
  const active = agents.find((agent) => agent.status === "active");
  const first = agents[0];
  const selected = active?.id || first?.id;
  if (!selected || !UUID_RE.test(selected)) {
    throw new Error(
      "No active agent available. Set AGENT_API_BASE_URL to your Eliza backend and ensure at least one agent is running."
    );
  }
  return selected;
}

async function createSession(baseUrl: string, agentId: string, userId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/messaging/sessions`, {
    method: "POST",
    cache: "no-store",
    headers: getProxyHeaders(true),
    body: JSON.stringify({
      agentId,
      userId,
      metadata: {
        source: "nosanascope_dashboard",
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Session creation failed: ${text}`);
  }

  const payload = (await response.json()) as SessionCreateResponse;
  const sessionId = payload?.sessionId;
  if (!sessionId || !UUID_RE.test(sessionId)) {
    throw new Error("Invalid sessionId returned by server");
  }
  return sessionId;
}

async function sendMessage(
  baseUrl: string,
  sessionId: string,
  content: string
): Promise<SessionMessageResponse> {
  const response = await fetch(`${baseUrl}/api/messaging/sessions/${sessionId}/messages`, {
    method: "POST",
    cache: "no-store",
    headers: getProxyHeaders(true),
    body: JSON.stringify({
      content,
      transport: "http",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Message send failed: ${text}`);
  }
  return (await response.json()) as SessionMessageResponse;
}

function parseCreatedAtMs(value: string | number | Date | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function looksLikeInterimReply(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.startsWith("checking ") ||
    normalized.includes("one moment") ||
    normalized.includes("please hold") ||
    normalized.includes("fetching") ||
    normalized.includes("let me check") ||
    normalized.startsWith("executing action:")
  );
}

async function fetchLatestAgentMessage(
  baseUrl: string,
  sessionId: string,
  sentAtMs: number
): Promise<string | null> {
  const response = await fetch(
    `${baseUrl}/api/messaging/sessions/${sessionId}/messages?limit=25`,
    {
      method: "GET",
      cache: "no-store",
      headers: getProxyHeaders(),
    }
  );

  if (!response.ok) return null;
  const payload = (await response.json()) as SessionHistoryResponse;
  const messages = payload.messages || [];

  const candidate = messages.find((m) => {
    if (!m?.isAgent || !m?.content) return false;
    const createdAtMs = parseCreatedAtMs(m.createdAt);
    return createdAtMs >= sentAtMs - 1000;
  });

  return candidate?.content ? String(candidate.content).trim() : null;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveFinalAssistantText(
  baseUrl: string,
  sessionId: string,
  sentAtMs: number,
  initialText: string
): Promise<string> {
  let bestText = initialText;
  const shouldWait = !bestText || looksLikeInterimReply(bestText);
  if (!shouldWait) return bestText;

  for (let i = 0; i < 8; i++) {
    await wait(500);
    const latest = await fetchLatestAgentMessage(baseUrl, sessionId, sentAtMs);
    if (!latest) continue;
    bestText = latest;
    if (!looksLikeInterimReply(latest)) break;
  }

  return bestText || "Request received.";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: string;
      sessionId?: string;
      userId?: string;
      agentId?: string;
    };
    const message = String(body?.message || "").trim();
    if (!message) {
      return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
    }

    const baseUrl = getAgentBaseUrl();
    const requestedAgentId =
      typeof body.agentId === "string" && UUID_RE.test(body.agentId) ? body.agentId : null;
    const agentId = requestedAgentId || (await fetchActiveAgentId(baseUrl));
    const userId = ensureUuid(body.userId);

    let sessionId =
      typeof body.sessionId === "string" && UUID_RE.test(body.sessionId) ? body.sessionId : null;
    if (!sessionId) {
      sessionId = await createSession(baseUrl, agentId, userId);
    }

    const sentAtMs = Date.now();
    let result: SessionMessageResponse;
    try {
      result = await sendMessage(baseUrl, sessionId, message);
    } catch {
      // Session may be expired/invalid; recover with fresh session once.
      sessionId = await createSession(baseUrl, agentId, userId);
      result = await sendMessage(baseUrl, sessionId, message);
    }

    const initialText =
      extractAssistantText(result.agentResponse) || "Request received. Awaiting agent response.";
    const assistantText = await resolveFinalAssistantText(
      baseUrl,
      sessionId,
      sentAtMs,
      initialText
    );

    return NextResponse.json({
      ok: true,
      sessionId,
      agentId,
      userId,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantText,
        createdAt: new Date().toISOString(),
      },
      raw: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to process chat message",
      },
      { status: 500 }
    );
  }
}
