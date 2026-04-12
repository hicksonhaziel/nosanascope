import { Pool } from 'pg';

export interface MetricsSnapshot {
  activeJobs: number;
  failedJobs: number;
  queuedJobs: number;
  creditBalance: number;
  burnRatePerHour: number;
  deploymentTotal: number;
  deploymentRunning: number;
  deploymentStarting: number;
  deploymentStopped: number;
  deploymentError: number;
  payload: Record<string, unknown>;
}

export interface MetricsHistoryRow {
  id: number;
  createdAt: string;
  activeJobs: number;
  failedJobs: number;
  queuedJobs: number;
  creditBalance: number;
  burnRatePerHour: number;
  deploymentTotal: number;
  deploymentRunning: number;
  deploymentStarting: number;
  deploymentStopped: number;
  deploymentError: number;
  payload: Record<string, unknown>;
}

export interface FailureLogRow {
  id: number;
  createdAt: string;
  reason: string;
  recentFailures: number;
  lowCredits: boolean;
  availableCredits: number;
  thresholdCredits: number;
  payload: Record<string, unknown>;
}

export interface FailureLogEntry {
  reason: string;
  recentFailures: number;
  lowCredits: boolean;
  availableCredits: number;
  thresholdCredits: number;
  payload?: Record<string, unknown>;
}

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.NOSANA_METRICS_POSTGRES_URL?.trim();

  pool = connectionString
    ? new Pool({
        connectionString,
        max: Number(process.env.NOSANA_DB_POOL_MAX || 10),
      })
    : new Pool({
        host: process.env.NOSANA_DB_HOST || '127.0.0.1',
        port: Number(process.env.NOSANA_DB_PORT || 5432),
        database: process.env.NOSANA_DB_NAME || 'nosanascope',
        user: process.env.NOSANA_DB_USER || 'agent',
        password: process.env.NOSANA_DB_PASSWORD || 'agent_password',
        max: Number(process.env.NOSANA_DB_POOL_MAX || 10),
      });

  return pool;
}

async function initSchema(): Promise<void> {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS metrics (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active_jobs INTEGER NOT NULL,
      failed_jobs INTEGER NOT NULL,
      queued_jobs INTEGER NOT NULL,
      credit_balance NUMERIC NOT NULL,
      burn_rate_per_hour NUMERIC NOT NULL,
      deployment_total INTEGER NOT NULL,
      deployment_running INTEGER NOT NULL,
      deployment_starting INTEGER NOT NULL,
      deployment_stopped INTEGER NOT NULL,
      deployment_error INTEGER NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_metrics_created_at
    ON metrics (created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS failure_logs (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason TEXT NOT NULL,
      recent_failures INTEGER NOT NULL DEFAULT 0,
      low_credits BOOLEAN NOT NULL DEFAULT FALSE,
      available_credits NUMERIC NOT NULL DEFAULT 0,
      threshold_credits NUMERIC NOT NULL DEFAULT 0,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_failure_logs_created_at
    ON failure_logs (created_at DESC);
  `);
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initSchema().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function saveMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void> {
  await ensureInitialized();

  const db = getPool();
  await db.query(
    `
      INSERT INTO metrics (
        active_jobs,
        failed_jobs,
        queued_jobs,
        credit_balance,
        burn_rate_per_hour,
        deployment_total,
        deployment_running,
        deployment_starting,
        deployment_stopped,
        deployment_error,
        payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    `,
    [
      snapshot.activeJobs,
      snapshot.failedJobs,
      snapshot.queuedJobs,
      snapshot.creditBalance,
      snapshot.burnRatePerHour,
      snapshot.deploymentTotal,
      snapshot.deploymentRunning,
      snapshot.deploymentStarting,
      snapshot.deploymentStopped,
      snapshot.deploymentError,
      JSON.stringify(snapshot.payload || {}),
    ]
  );
}

export async function saveFailureLog(entry: FailureLogEntry): Promise<void> {
  await ensureInitialized();

  const db = getPool();
  await db.query(
    `
      INSERT INTO failure_logs (
        reason,
        recent_failures,
        low_credits,
        available_credits,
        threshold_credits,
        payload
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    `,
    [
      entry.reason,
      entry.recentFailures,
      entry.lowCredits,
      entry.availableCredits,
      entry.thresholdCredits,
      JSON.stringify(entry.payload || {}),
    ]
  );
}

export async function getMetricsHistory(hours: number): Promise<MetricsHistoryRow[]> {
  await ensureInitialized();

  const sanitizedHours = Number.isFinite(hours) ? Math.max(1, Math.min(24 * 14, Math.floor(hours))) : 24;
  const db = getPool();
  const result = await db.query(
    `
      SELECT
        id,
        created_at,
        active_jobs,
        failed_jobs,
        queued_jobs,
        credit_balance,
        burn_rate_per_hour,
        deployment_total,
        deployment_running,
        deployment_starting,
        deployment_stopped,
        deployment_error,
        payload
      FROM metrics
      WHERE created_at >= NOW() - ($1::integer * INTERVAL '1 hour')
      ORDER BY created_at DESC
    `,
    [sanitizedHours]
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    createdAt: new Date(row.created_at).toISOString(),
    activeJobs: Number(row.active_jobs),
    failedJobs: Number(row.failed_jobs),
    queuedJobs: Number(row.queued_jobs),
    creditBalance: toNumber(row.credit_balance),
    burnRatePerHour: toNumber(row.burn_rate_per_hour),
    deploymentTotal: Number(row.deployment_total),
    deploymentRunning: Number(row.deployment_running),
    deploymentStarting: Number(row.deployment_starting),
    deploymentStopped: Number(row.deployment_stopped),
    deploymentError: Number(row.deployment_error),
    payload: (row.payload || {}) as Record<string, unknown>,
  }));
}

export async function getFailureLog(limit = 50): Promise<FailureLogRow[]> {
  await ensureInitialized();

  const sanitizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50;
  const db = getPool();
  const result = await db.query(
    `
      SELECT
        id,
        created_at,
        reason,
        recent_failures,
        low_credits,
        available_credits,
        threshold_credits,
        payload
      FROM failure_logs
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [sanitizedLimit]
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    createdAt: new Date(row.created_at).toISOString(),
    reason: String(row.reason || ''),
    recentFailures: Number(row.recent_failures || 0),
    lowCredits: Boolean(row.low_credits),
    availableCredits: toNumber(row.available_credits),
    thresholdCredits: toNumber(row.threshold_credits),
    payload: (row.payload || {}) as Record<string, unknown>,
  }));
}
