import { logger, type IAgentRuntime, type Memory, type Provider, type ProviderResult, type State } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';

const CACHE_TTL_MS = 30_000;

let cachedResult: { expiresAt: number; result: ProviderResult } | null = null;
let inflight: Promise<ProviderResult> | null = null;

const ACTIVE_STATUSES = new Set(['RUNNING', 'STARTING']);
const FAILED_STATUSES = new Set(['ERROR', 'INSUFFICIENT_FUNDS']);
const QUEUED_STATUSES = new Set(['DRAFT', 'STARTING']);

const formatNumber = (value: number): string =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0';

async function buildLiveState(): Promise<ProviderResult> {
  if (!process.env.NOSANA_API_KEY?.trim()) {
    return {
      text: '[LIVE NOSANA STATE]\nAPI key missing. Set NOSANA_API_KEY.',
      values: { nosanaLiveState: 'unavailable' },
      data: { source: 'nosanaContextProvider', unavailable: true, reason: 'missing_api_key' },
    };
  }

  const client = createNosanaClient(undefined as any, {
    api: { apiKey: process.env.NOSANA_API_KEY },
  });

  const [deploymentsRes, balance, markets] = await Promise.all([
    client.api.deployments.list({ limit: 100 } as any),
    client.api.credits.balance(),
    client.api.markets.list(),
  ]);

  const deployments = deploymentsRes?.deployments || [];
  const marketByAddress = new Map<string, any>(markets.map((m: any) => [String(m.address), m]));

  let activeJobs = 0;
  let failedJobs = 0;
  let desiredQueueCapacity = 0;
  let burnRatePerHour = 0;

  for (const deployment of deployments as any[]) {
    const status = String(deployment?.status || '').toUpperCase();
    const active = Number(deployment?.active_jobs || 0);
    const replicas = Number(deployment?.replicas || 0);

    if (ACTIVE_STATUSES.has(status)) {
      activeJobs += active;
      desiredQueueCapacity += Math.max(replicas, 0);
    }

    if (QUEUED_STATUSES.has(status)) {
      desiredQueueCapacity += Math.max(replicas, 1);
    }

    if (FAILED_STATUSES.has(status)) {
      failedJobs += Math.max(1, active);
    }

    if (ACTIVE_STATUSES.has(status)) {
      const market = marketByAddress.get(String(deployment?.market));
      const pricePerSecond = Number(market?.nos_job_price_per_second || 0);
      const jobs = Math.max(1, active || replicas || 1);
      burnRatePerHour += pricePerSecond * jobs * 3600;
    }
  }

  const queuedJobs = Math.max(desiredQueueCapacity - activeJobs, 0);
  const availableCredits =
    Number(balance?.assignedCredits || 0) -
    Number(balance?.reservedCredits || 0) -
    Number(balance?.settledCredits || 0);

  const timestamp = new Date().toISOString();
  const text =
    `[LIVE NOSANA STATE — ${timestamp}]\n` +
    `Active Jobs: ${activeJobs}\n` +
    `Failed Jobs: ${failedJobs}\n` +
    `Queued Jobs: ${queuedJobs}\n` +
    `Credit Balance: ${formatNumber(availableCredits)}\n` +
    `Burn Rate: ~${formatNumber(burnRatePerHour)}/hour`;

  return {
    text,
    values: {
      nosanaLiveState: text,
      nosanaActiveJobs: activeJobs,
      nosanaFailedJobs: failedJobs,
      nosanaQueuedJobs: queuedJobs,
      nosanaCreditBalance: availableCredits,
      nosanaBurnRatePerHour: burnRatePerHour,
      nosanaLiveStateTimestamp: timestamp,
    },
    data: {
      source: 'nosanaContextProvider',
      timestamp,
      activeJobs,
      failedJobs,
      queuedJobs,
      creditBalance: availableCredits,
      burnRatePerHour,
      deploymentCount: deployments.length,
      marketCount: markets.length,
    },
  };
}

/**
 * Builds or retrieves a cached live Nosana provider snapshot.
 *
 * @param runtime - Runtime context is passed by provider caller when available.
 * @param message - Triggering message context used by provider pipeline.
 * @returns Provider result containing formatted live-state text and machine-readable values.
 * @example
 * Called by provider pipeline before an LLM response to inject fresh Nosana state.
 */
export async function getNosanaLiveStateSnapshot(): Promise<ProviderResult> {
  const now = Date.now();
  if (cachedResult && cachedResult.expiresAt > now) {
    logger.debug({ src: 'provider:nosana', cache: 'hit' }, '[NOSANA_LIVE_STATE] cache hit');
    return cachedResult.result;
  }

  if (!inflight) {
    logger.debug({ src: 'provider:nosana', cache: 'miss' }, '[NOSANA_LIVE_STATE] cache miss -> refreshing');
    inflight = buildLiveState()
      .then((result) => {
        cachedResult = {
          result,
          expiresAt: Date.now() + CACHE_TTL_MS,
        };
        return result;
      })
      .catch((error) => {
        logger.error({ error }, '[NOSANA_LIVE_STATE] provider fetch failed');
        const fallback: ProviderResult = {
          text: `[LIVE NOSANA STATE — ${new Date().toISOString()}]\nState temporarily unavailable.`,
          values: { nosanaLiveState: 'unavailable' },
          data: { source: 'nosanaContextProvider', unavailable: true },
        };
        cachedResult = {
          result: fallback,
          expiresAt: Date.now() + 5_000,
        };
        return fallback;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return await inflight;
}

/**
 * Provider definition that injects live Nosana context into each model turn.
 *
 * @param runtime - Active Eliza runtime for provider execution.
 * @param message - Current user message being processed.
 * @returns Provider object that emits live state text/value payloads.
 * @example
 * Provider name in pipeline: "NOSANA_LIVE_STATE"
 */
export const nosanaContextProvider: Provider = {
  name: 'NOSANA_LIVE_STATE',
  description: 'Injects current Nosana job, credit, and burn-rate state into each message context',
  position: -100,
  get: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
    return await getNosanaLiveStateSnapshot();
  },
};

export default nosanaContextProvider;
