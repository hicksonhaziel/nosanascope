import { type Evaluator, type IAgentRuntime, type Memory, type State, type UUID } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';
import { getLatestAlertPreference } from './alertPreferenceStore.ts';
import { setPendingRestartConfirmation } from '../actions/restartConfirmationStore.ts';

const FIVE_MIN_MS = 5 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const TELEGRAM_MISSING_LOG_THROTTLE_MS = 10 * 60 * 1000;
const DEBUG_EVALUATORS = process.env.NOSANA_DEBUG_EVALUATORS?.toLowerCase() === 'true';

const tickerByAgent = new Map<string, ReturnType<typeof setInterval>>();
const lastCheckByAgent = new Map<string, number>();
const inFlightByAgent = new Set<string>();
const lastAlertKeyByAgent = new Map<string, string>();
const contextByAgent = new Map<string, { roomId: UUID; entityId: UUID }>();
let lastMissingTelegramLogAt = 0;

type FailureCheckResult = {
  recentFailures: number;
  lowCredits: boolean;
  availableCredits: number;
  lowCreditsThreshold: number;
  triggered: boolean;
  reason: string;
};

async function sendTelegramAlert(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    const now = Date.now();
    if (now - lastMissingTelegramLogAt > TELEGRAM_MISSING_LOG_THROTTLE_MS) {
      lastMissingTelegramLogAt = now;
      console.warn(
        '[failurePatternEvaluator] Telegram alert skipped (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)'
      );
      if (DEBUG_EVALUATORS) {
        console.debug('[failurePatternEvaluator] Alert stub message:', message);
      }
    }
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn('[failurePatternEvaluator] Telegram send failed:', response.status, body);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[failurePatternEvaluator] Telegram send error:', error);
    return false;
  }
}

function ensureTicker(runtime: IAgentRuntime): void {
  const agentKey = String(runtime.agentId);
  if (tickerByAgent.has(agentKey)) return;

  const timer = setInterval(() => {
    const context = contextByAgent.get(agentKey);
    if (!context) return;
    void runFailureCheck(runtime, context, 'tick', false, false);
  }, FIVE_MIN_MS);

  timer.unref?.();
  tickerByAgent.set(agentKey, timer);
  if (DEBUG_EVALUATORS) {
    console.debug('[failurePatternEvaluator] 5-minute ticker started for agent', agentKey);
  }
}

async function countRecentFailures(deployments: any[], cutoffIso: string, cutoffMs: number): Promise<number> {
  let failures = 0;

  for (const deployment of deployments.slice(0, 20)) {
    const status = String(deployment?.status || '').toUpperCase();
    const updatedAtMs = deployment?.updated_at ? new Date(deployment.updated_at).getTime() : 0;

    if (status === 'ERROR' && updatedAtMs >= cutoffMs) {
      failures += 1;
    }

    try {
      const eventsRes = await deployment.getEvents({
        limit: 50,
        sort_order: 'desc',
        created_after: cutoffIso,
      } as any);
      const events = eventsRes?.events || [];
      failures += events.filter((event: any) =>
        /(fail|error|oom|insufficient|crash)/i.test(`${event?.type || ''} ${event?.message || ''}`)
      ).length;
    } catch {
      // Some deployments may not have event access; ignore and continue.
    }
  }

  return failures;
}

function latestFailedDeployment(deployments: any[]): any | null {
  const failed = deployments
    .filter((deployment) => String(deployment?.status || '').toUpperCase() === 'ERROR')
    .sort((a, b) => {
      const aMs = a?.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bMs = b?.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bMs - aMs;
    });

  return failed[0] || null;
}

async function runFailureCheck(
  runtime: IAgentRuntime,
  context: { roomId: UUID; entityId: UUID },
  source: 'tick' | 'message' | 'manual',
  force: boolean,
  simulateFailure: boolean
): Promise<FailureCheckResult | null> {
  const agentKey = String(runtime.agentId);
  const now = Date.now();

  if (!force) {
    const last = lastCheckByAgent.get(agentKey) || 0;
    if (now - last < FIVE_MIN_MS) return null;
  }
  if (inFlightByAgent.has(agentKey)) return null;
  inFlightByAgent.add(agentKey);

  try {
    if (!process.env.NOSANA_API_KEY?.trim()) {
      return null;
    }

    const client = createNosanaClient(undefined as any, {
      api: { apiKey: process.env.NOSANA_API_KEY },
    });

    const [deploymentsRes, balance] = await Promise.all([
      client.api.deployments.list({ limit: 100 } as any),
      client.api.credits.balance(),
    ]);

    const deployments = deploymentsRes?.deployments || [];
    const cutoffMs = now - THIRTY_MIN_MS;
    const cutoffIso = new Date(cutoffMs).toISOString();

    let recentFailures = await countRecentFailures(deployments, cutoffIso, cutoffMs);
    if (simulateFailure) {
      recentFailures = Math.max(recentFailures, 3);
    }

    const assignedCredits = Number(balance?.assignedCredits || 0);
    const availableCredits =
      assignedCredits - Number(balance?.reservedCredits || 0) - Number(balance?.settledCredits || 0);

    const latestPref = await getLatestAlertPreference(runtime, {
      roomId: context.roomId,
      entityId: context.entityId,
    });
    const configuredThresholdPercent =
      latestPref?.event === 'credit_drop' && latestPref?.threshold?.includes('%')
        ? Number(latestPref.threshold.replace('%', '').trim()) / 100
        : null;
    const telegramAlertsEnabled =
      !latestPref ||
      (latestPref.enabled &&
        (latestPref.channel === 'telegram' || latestPref.channel === 'both'));

    const lowCreditsThreshold = assignedCredits * (configuredThresholdPercent ?? 0.1);
    const lowCredits = assignedCredits > 0 && availableCredits < lowCreditsThreshold;
    const triggered = recentFailures >= 3 || lowCredits;

    const reasonParts: string[] = [];
    if (recentFailures >= 3) reasonParts.push(`${recentFailures} failures in 30m`);
    if (lowCredits)
      reasonParts.push(
        `credits below threshold (${availableCredits.toFixed(2)} < ${lowCreditsThreshold.toFixed(2)})`
      );
    const reason = reasonParts.join(' | ') || 'none';

    const result: FailureCheckResult = {
      recentFailures,
      lowCredits,
      availableCredits,
      lowCreditsThreshold,
      triggered,
      reason,
    };

    if (triggered || source === 'manual' || DEBUG_EVALUATORS) {
      console.info('[failurePatternEvaluator] check result:', {
        source,
        recentFailures,
        lowCredits,
        availableCredits,
        lowCreditsThreshold,
        triggered,
      });
    }

    if (triggered) {
      const alertKey = `${Math.floor(now / FIVE_MIN_MS)}:${reason}`;
      if (lastAlertKeyByAgent.get(agentKey) !== alertKey) {
        lastAlertKeyByAgent.set(agentKey, alertKey);

        const failedCandidate = latestFailedDeployment(deployments);
        if (failedCandidate) {
          await setPendingRestartConfirmation(
            runtime,
            { roomId: context.roomId, entityId: context.entityId },
            {
              deploymentId: String(failedCandidate.id),
              deploymentName: String(failedCandidate.name || failedCandidate.id),
              statusAtPrompt: String(failedCandidate.status || 'ERROR').toUpperCase(),
            }
          );
        }

        const alertText =
          `⚠️ Nosana failure pattern detected\n` +
          `Time: ${new Date(now).toISOString()}\n` +
          `Reason: ${reason}\n` +
          `Available credits: ${availableCredits.toFixed(2)}\n` +
          (failedCandidate
            ? `Candidate: ${failedCandidate.name || failedCandidate.id}\nReply YES to restart it, or NO to skip.`
            : `No single failed deployment candidate found yet.`);

        await runtime.createMemory(
          {
            entityId: context.entityId,
            roomId: context.roomId,
            agentId: runtime.agentId,
            createdAt: now,
            content: {
              text: alertText,
              type: 'nosana_failure_alert',
              source: 'evaluator',
              data: {
                source,
                reason,
                recentFailures,
                lowCredits,
                availableCredits,
              },
            } as any,
            metadata: {
              type: 'nosana_failure_alert',
              scope: 'room',
              timestamp: now,
              tags: ['nosana', 'failure-alert'],
            } as any,
          },
          'messages'
        );

        await runtime.log({
          type: 'nosana_failure_alert',
          entityId: context.entityId,
          roomId: context.roomId,
          body: {
            source,
            reason,
            recentFailures,
            lowCredits,
            availableCredits,
            lowCreditsThreshold,
            runId: runtime.getCurrentRunId(),
          },
        });

        if (telegramAlertsEnabled) {
          await sendTelegramAlert(alertText);
        }
      }
    }

    return result;
  } finally {
    lastCheckByAgent.set(agentKey, Date.now());
    inFlightByAgent.delete(agentKey);
  }
}

export const failurePatternEvaluator: Evaluator = {
  name: 'FAILURE_PATTERN_EVALUATOR',
  description:
    'Runs every 5 minutes to detect failure bursts (>=3 in 30m) or low credits (<10% assigned) and raise alerts',
  similes: ['failure detector', 'anomaly detector', 'credit risk evaluator'],
  alwaysRun: true,
  examples: [
    {
      prompt: 'monitor failures and alert me',
      messages: [{ name: '{{user1}}', content: { text: 'run failure check now' } }],
      outcome: 'Runs failure pattern check and raises alert if thresholds are crossed',
    },
  ],
  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // alwaysRun=true ensures post-response execution every turn;
    // this validate keeps evaluator active and ticker initialized.
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory): Promise<void> => {
    ensureTicker(runtime);
    contextByAgent.set(String(runtime.agentId), {
      roomId: message.roomId,
      entityId: message.entityId,
    });

    const text = String(message.content?.text || '').toLowerCase();
    const manualCheck = /run failure check now|check failure patterns now|check failures now/.test(text);
    const simulateFailure = /trigger failure alert|simulate failure alert/.test(text);

    await runFailureCheck(runtime, { roomId: message.roomId, entityId: message.entityId }, manualCheck ? 'manual' : 'message', manualCheck || simulateFailure, simulateFailure);
  },
};

export default failurePatternEvaluator;
