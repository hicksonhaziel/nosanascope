import { Service, logger, type IAgentRuntime } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';
import { getMetricsHistory, saveFailureLog, saveMetricsSnapshot, type MetricsSnapshot } from './database.ts';

const POLL_DEFAULT_MS = 30_000;
const MIN_POLL_MS = 10_000;
const ACTIVE_STATUSES = new Set(['RUNNING', 'STARTING']);
const FAILED_STATUSES = new Set(['ERROR', 'INSUFFICIENT_FUNDS']);
const QUEUED_STATUSES = new Set(['DRAFT', 'STARTING']);

type JobSnapshot = {
  id: string;
  state: string;
  durationSeconds: number;
  deploymentId: string;
};

function readPollInterval(): number {
  const raw = Number(process.env.NOSANA_METRICS_POLL_MS || POLL_DEFAULT_MS);
  if (!Number.isFinite(raw)) return POLL_DEFAULT_MS;
  return Math.max(MIN_POLL_MS, raw);
}

function parseDateMs(value: unknown): number | null {
  if (!value) return null;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

async function collectJobsSnapshot(deployments: any[]): Promise<JobSnapshot[]> {
  const nowMs = Date.now();
  const results = await Promise.all(
    deployments.slice(0, 12).map(async (deployment: any) => {
      try {
        const jobsRes = await deployment.getJobs({ limit: 20, sort_order: 'desc' } as any);
        return { deployment, jobs: jobsRes?.jobs || [] };
      } catch {
        return { deployment, jobs: [] };
      }
    })
  );

  const jobs: JobSnapshot[] = [];
  for (const { deployment, jobs: deploymentJobs } of results) {
    const deploymentId = String(deployment?.id || deployment?.name || 'unknown');
    for (const job of deploymentJobs as any[]) {
      const id = String(job?.id || job?.job_id || job?.name || '').trim();
      if (!id) continue;

      const state = String(job?.state || job?.status || 'UNKNOWN').toUpperCase();
      const createdMs =
        parseDateMs(job?.started_at) ||
        parseDateMs(job?.created_at) ||
        parseDateMs(job?.createdAt) ||
        parseDateMs(job?.updated_at) ||
        parseDateMs(job?.updatedAt);
      const endedMs =
        parseDateMs(job?.finished_at) ||
        parseDateMs(job?.ended_at) ||
        parseDateMs(job?.stopped_at) ||
        parseDateMs(job?.updated_at) ||
        parseDateMs(job?.updatedAt);

      const durationMs =
        createdMs === null ? 0 : Math.max(0, (endedMs || nowMs) - createdMs);
      jobs.push({
        id,
        state,
        durationSeconds: Math.floor(durationMs / 1000),
        deploymentId,
      });
    }
  }

  const deduped = new Map<string, JobSnapshot>();
  for (const job of jobs) {
    deduped.set(job.id, job);
  }
  return Array.from(deduped.values()).slice(0, 120);
}

async function collectSnapshot(): Promise<MetricsSnapshot> {
  const apiKey = process.env.NOSANA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('NOSANA_API_KEY is not set');
  }

  const client = createNosanaClient(undefined as any, {
    api: { apiKey },
  });

  const [deploymentsRes, balance, markets] = await Promise.all([
    client.api.deployments.list({ limit: 100 } as any),
    client.api.credits.balance(),
    client.api.markets.list(),
  ]);

  const deployments = deploymentsRes?.deployments || [];
  const marketByAddress = new Map<string, any>(markets.map((m: any) => [String(m.address), m]));
  const jobs = await collectJobsSnapshot(deployments);

  let activeJobs = 0;
  let failedJobs = 0;
  let desiredQueueCapacity = 0;
  let burnRatePerHour = 0;

  let deploymentRunning = 0;
  let deploymentStarting = 0;
  let deploymentStopped = 0;
  let deploymentError = 0;

  for (const deployment of deployments as any[]) {
    const status = String(deployment?.status || '').toUpperCase();
    const active = Number(deployment?.active_jobs || 0);
    const replicas = Number(deployment?.replicas || 0);

    if (status === 'RUNNING') deploymentRunning += 1;
    else if (status === 'STARTING') deploymentStarting += 1;
    else if (status === 'STOPPED' || status === 'STOPPING') deploymentStopped += 1;
    else if (status === 'ERROR' || status === 'INSUFFICIENT_FUNDS') deploymentError += 1;

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
  const assignedCredits = Number(balance?.assignedCredits || 0);
  const reservedCredits = Number(balance?.reservedCredits || 0);
  const settledCredits = Number(balance?.settledCredits || 0);
  const creditBalance = assignedCredits - reservedCredits - settledCredits;
  const estimatedCapacity = Math.max(
    1,
    deployments.reduce((sum: number, d: any) => sum + Math.max(1, Number(d?.replicas || 1)), 0)
  );
  const gpuUtilizationPct = Math.max(0, Math.min(100, (activeJobs / estimatedCapacity) * 100));
  const vramUsagePct = Math.max(
    0,
    Math.min(100, gpuUtilizationPct * 0.84 + deploymentError * 4 + deploymentStarting * 2)
  );
  const estimatedTemperatureC = Math.max(
    32,
    Math.min(92, 38 + gpuUtilizationPct * 0.42 + deploymentError * 1.6)
  );

  return {
    activeJobs,
    failedJobs,
    queuedJobs,
    creditBalance,
    burnRatePerHour,
    deploymentTotal: deployments.length,
    deploymentRunning,
    deploymentStarting,
    deploymentStopped,
    deploymentError,
    payload: {
      capturedAt: new Date().toISOString(),
      assignedCredits,
      reservedCredits,
      settledCredits,
      marketCount: markets.length,
      gpuUtilizationPct: Number(gpuUtilizationPct.toFixed(1)),
      vramUsagePct: Number(vramUsagePct.toFixed(1)),
      estimatedTemperatureC: Number(estimatedTemperatureC.toFixed(1)),
      jobs,
    },
  };
}

export class MetricsPollerService extends Service {
  static serviceType = 'nosana_metrics_poller';
  capabilityDescription = 'Polls Nosana every 30s and persists metrics snapshots to PostgreSQL.';

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private lastFailureFingerprint = '';
  private lastFailureLoggedAt = 0;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  private ensureApiRoute(): void {
    const runtimeAny = this.runtime as any;
    if (!Array.isArray(runtimeAny.routes)) return;

    const alreadyRegistered = runtimeAny.routes.some(
      (route: any) => route?.type === 'GET' && route?.path === '/metrics'
    );
    if (alreadyRegistered) return;

    runtimeAny.routes.push({
      name: 'nosana-metrics-history-runtime',
      type: 'GET',
      path: '/metrics',
      handler: async (req: any, res: any) => {
        try {
          const rawHours = Number(req?.query?.hours ?? 24);
          const hours = Number.isFinite(rawHours) ? Math.max(1, Math.min(24 * 14, rawHours)) : 24;
          const snapshots = await getMetricsHistory(hours);
          res.json({
            ok: true,
            hours,
            count: snapshots.length,
            snapshots,
          });
        } catch (error: any) {
          res.status(500).json({
            ok: false,
            error: error?.message || 'Failed to load metrics history',
          });
        }
      },
    });

    logger.info('[nosana:metrics-poller] registered runtime route GET /api/metrics');
  }

  private async pollOnce(source: 'boot' | 'timer'): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      const snapshot = await collectSnapshot();
      await saveMetricsSnapshot(snapshot);

      const assignedCredits = Number((snapshot.payload?.assignedCredits as number) || 0);
      const lowCreditsThreshold = assignedCredits * 0.1;
      const lowCredits = assignedCredits > 0 && snapshot.creditBalance < lowCreditsThreshold;
      const shouldLogFailure = snapshot.failedJobs > 0 || lowCredits;

      if (shouldLogFailure) {
        const now = Date.now();
        const fingerprint = `${snapshot.failedJobs}:${lowCredits}`;
        if (
          fingerprint !== this.lastFailureFingerprint ||
          now - this.lastFailureLoggedAt > 5 * 60 * 1000
        ) {
          this.lastFailureFingerprint = fingerprint;
          this.lastFailureLoggedAt = now;
          await saveFailureLog({
            reason: lowCredits
              ? `low_credits (${snapshot.creditBalance.toFixed(2)} < ${lowCreditsThreshold.toFixed(2)})`
              : `failed_jobs (${snapshot.failedJobs})`,
            recentFailures: snapshot.failedJobs,
            lowCredits,
            availableCredits: snapshot.creditBalance,
            thresholdCredits: lowCreditsThreshold,
            payload: {
              source,
              deploymentTotal: snapshot.deploymentTotal,
            },
          });
        }
      }
    } catch (error) {
      logger.error({ error }, '[nosana:metrics-poller] polling failed');
    } finally {
      this.isPolling = false;
    }
  }

  static async start(runtime: IAgentRuntime): Promise<MetricsPollerService> {
    const service = new MetricsPollerService(runtime);
    service.ensureApiRoute();
    const apiKey = process.env.NOSANA_API_KEY?.trim();
    if (!apiKey) {
      logger.warn('[nosana:metrics-poller] NOSANA_API_KEY missing, poller is disabled');
      return service;
    }

    const pollMs = readPollInterval();

    logger.info(
      { pollMs },
      '[nosana:metrics-poller] starting (polling Nosana and writing metrics snapshots)'
    );

    await service.pollOnce('boot');
    service.intervalId = setInterval(() => {
      void service.pollOnce('timer');
    }, pollMs);
    service.intervalId.unref?.();

    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = runtime.getService(MetricsPollerService.serviceType) as
      | MetricsPollerService
      | undefined;
    if (!service) return;
    await service.stop();
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('[nosana:metrics-poller] stopped');
  }
}

export default MetricsPollerService;
