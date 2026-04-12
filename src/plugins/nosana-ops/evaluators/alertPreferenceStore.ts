import { ModelType, type IAgentRuntime, type Memory, type UUID } from '@elizaos/core';

export type AlertPreferenceEvent = 'job_failure' | 'credit_drop' | 'latency_spike' | 'generic_alert';

export interface AlertPreference {
  event: AlertPreferenceEvent;
  threshold: string | null;
  channel: 'telegram' | 'in-app' | 'both';
  enabled: boolean;
  sourceText: string;
  updatedAt: string;
}

function cacheKeys(runtime: IAgentRuntime, roomId?: UUID, entityId?: UUID): string[] {
  const keys = [`nosana:alertPreference:agent:${String(runtime.agentId)}`];
  if (roomId) keys.unshift(`nosana:alertPreference:room:${String(roomId)}`);
  if (entityId) keys.unshift(`nosana:alertPreference:entity:${String(entityId)}`);
  return keys;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // fall through
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function inferPreferenceFromText(input: string): AlertPreference {
  const text = input.toLowerCase();
  let event: AlertPreferenceEvent = 'generic_alert';

  if (text.includes('fail')) event = 'job_failure';
  if (text.includes('credit') || text.includes('balance')) event = 'credit_drop';
  if (text.includes('latency') || text.includes('slow')) event = 'latency_spike';

  const thresholdMatch = input.match(/(\d+(?:\.\d+)?\s*(?:%|nos|credits?|ms|minutes?|hours?))/i);
  const channel: AlertPreference['channel'] =
    text.includes('telegram') && text.includes('app')
      ? 'both'
      : text.includes('telegram')
        ? 'telegram'
        : 'in-app';

  return {
    event,
    threshold: thresholdMatch?.[1] || null,
    channel,
    enabled: !text.includes('don\'t alert') && !text.includes('disable alert'),
    sourceText: input,
    updatedAt: new Date().toISOString(),
  };
}

export async function extractAlertPreference(
  runtime: IAgentRuntime,
  input: string
): Promise<AlertPreference> {
  const prompt = `
Extract alert preferences from this user message.
Message: "${input}"

Return strict JSON only:
{
  "event": "job_failure | credit_drop | latency_spike | generic_alert",
  "threshold": "string or null",
  "channel": "telegram | in-app | both",
  "enabled": true
}
`.trim();

  try {
    const raw = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      temperature: 0,
      maxTokens: 180,
    });
    const parsed = parseJsonObject(String(raw));

    if (!parsed) return inferPreferenceFromText(input);

    const eventValue = String(parsed.event || 'generic_alert').toLowerCase();
    const event: AlertPreferenceEvent =
      eventValue === 'job_failure' || eventValue === 'credit_drop' || eventValue === 'latency_spike'
        ? (eventValue as AlertPreferenceEvent)
        : 'generic_alert';

    const channelValue = String(parsed.channel || 'in-app').toLowerCase();
    const channel: AlertPreference['channel'] =
      channelValue === 'telegram' || channelValue === 'both' ? channelValue : 'in-app';

    return {
      event,
      threshold: parsed.threshold == null ? null : String(parsed.threshold),
      channel,
      enabled: Boolean(parsed.enabled ?? true),
      sourceText: input,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return inferPreferenceFromText(input);
  }
}

export async function storeAlertPreference(
  runtime: IAgentRuntime,
  message: Memory,
  preference: AlertPreference
): Promise<void> {
  await runtime.createMemory(
    {
      entityId: message.entityId,
      roomId: message.roomId,
      agentId: runtime.agentId,
      createdAt: Date.now(),
      content: {
        text: `ALERT_PREFERENCE ${JSON.stringify(preference)}`,
        type: 'alert_preference',
        source: message.content?.source,
        data: preference,
      } as any,
      metadata: {
        type: 'alert_preference',
        scope: 'room',
        timestamp: Date.now(),
        tags: ['nosana', 'alert-preference'],
      } as any,
    },
    'messages'
  );

  await runtime.log({
    type: 'nosana_alert_preference',
    entityId: message.entityId,
    roomId: message.roomId,
    body: {
      event: preference.event,
      threshold: preference.threshold,
      channel: preference.channel,
      enabled: preference.enabled,
      sourceText: preference.sourceText,
      updatedAt: preference.updatedAt,
      messageId: message.id,
      runId: runtime.getCurrentRunId(),
    },
  });

  // Durable cache path to survive room/session variations across restarts.
  for (const key of cacheKeys(runtime, message.roomId, message.entityId)) {
    try {
      await runtime.setCache(key, preference);
    } catch {
      // Non-fatal, continue to other persistence layers.
    }
  }
}

export async function getLatestAlertPreference(
  runtime: IAgentRuntime,
  opts: { roomId?: UUID; entityId?: UUID }
): Promise<AlertPreference | null> {
  for (const key of cacheKeys(runtime, opts.roomId, opts.entityId)) {
    try {
      const cached = await runtime.getCache<AlertPreference>(key);
      if (cached && typeof cached === 'object' && cached.event) return cached;
    } catch {
      // Continue to DB fallbacks.
    }
  }

  const logsByRoom = opts.roomId
    ? await runtime.getLogs({
        roomId: opts.roomId,
        type: 'nosana_alert_preference',
        count: 50,
      })
    : [];
  const logsByEntity = opts.entityId
    ? await runtime.getLogs({
        entityId: opts.entityId,
        type: 'nosana_alert_preference',
        count: 50,
      })
    : [];
  const logsGlobal = await runtime.getLogs({
    type: 'nosana_alert_preference',
    count: 100,
  });
  const logs = [...logsByRoom, ...logsByEntity, ...logsGlobal];

  if (logs.length > 0) {
    const sorted = [...logs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const latest = sorted[0]?.body as Record<string, unknown> | undefined;
    if (latest) {
      return {
        event: String(latest.event || 'generic_alert') as AlertPreferenceEvent,
        threshold: latest.threshold == null ? null : String(latest.threshold),
        channel: (String(latest.channel || 'in-app') as AlertPreference['channel']) || 'in-app',
        enabled: Boolean(latest.enabled ?? true),
        sourceText: String(latest.sourceText || ''),
        updatedAt: String(latest.updatedAt || new Date().toISOString()),
      };
    }
  }

  const memoriesByRoom = opts.roomId
    ? await runtime.getMemories({
        roomId: opts.roomId,
        tableName: 'messages',
        count: 200,
      })
    : [];
  const memoriesByEntity = opts.entityId
    ? await runtime.getMemories({
        entityId: opts.entityId,
        tableName: 'messages',
        count: 200,
      })
    : [];
  const memoriesGlobal = await runtime.getMemories({
    tableName: 'messages',
    count: 300,
  });
  const memories = [...memoriesByRoom, ...memoriesByEntity, ...memoriesGlobal];
  const prefMemories = memories.filter(
    (m) =>
      (m.metadata as any)?.type === 'alert_preference' ||
      String((m.content as any)?.type || '') === 'alert_preference'
  );
  if (prefMemories.length === 0) return null;

  const latestMemory = [...prefMemories].sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  )[0];
  const data = (latestMemory.content as any)?.data as AlertPreference | undefined;
  if (data) return data;

  const text = String(latestMemory.content?.text || '');
  const parsed = parseJsonObject(text);
  if (!parsed) return null;

  return {
    event: String(parsed.event || 'generic_alert') as AlertPreferenceEvent,
    threshold: parsed.threshold == null ? null : String(parsed.threshold),
    channel: (String(parsed.channel || 'in-app') as AlertPreference['channel']) || 'in-app',
    enabled: Boolean(parsed.enabled ?? true),
    sourceText: String(parsed.sourceText || ''),
    updatedAt: String(parsed.updatedAt || new Date().toISOString()),
  };
}
