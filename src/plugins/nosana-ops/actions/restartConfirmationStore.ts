import { type IAgentRuntime, type UUID } from '@elizaos/core';

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export interface PendingRestartConfirmation {
  type: 'restart_job';
  deploymentId: string;
  deploymentName: string;
  statusAtPrompt: string;
  requestedAt: string;
  expiresAt: string;
}

function cacheKeys(runtime: IAgentRuntime, roomId?: UUID, entityId?: UUID): string[] {
  const keys = [`nosana:restartConfirm:agent:${String(runtime.agentId)}`];
  if (roomId) keys.unshift(`nosana:restartConfirm:room:${String(roomId)}`);
  if (entityId) keys.unshift(`nosana:restartConfirm:entity:${String(entityId)}`);
  return keys;
}

function isValidPendingRestart(value: unknown): value is PendingRestartConfirmation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'restart_job' &&
    typeof candidate.deploymentId === 'string' &&
    typeof candidate.deploymentName === 'string' &&
    typeof candidate.requestedAt === 'string' &&
    typeof candidate.expiresAt === 'string'
  );
}

/**
 * Stores a pending restart confirmation request with a scoped TTL cache entry.
 *
 * @param runtime - Active Eliza runtime used for scoped cache and log writes.
 * @param context - Optional room/entity scope that controls where confirmation is cached.
 * @param pending - Deployment metadata to persist for later YES/NO confirmation resolution.
 * @returns Stored confirmation payload including request and expiry timestamps.
 * @example
 * await setPendingRestartConfirmation(runtime, { roomId, entityId }, pending);
 */
export async function setPendingRestartConfirmation(
  runtime: IAgentRuntime,
  context: { roomId?: UUID; entityId?: UUID },
  pending: Pick<PendingRestartConfirmation, 'deploymentId' | 'deploymentName' | 'statusAtPrompt'>
): Promise<PendingRestartConfirmation> {
  const now = Date.now();
  const stored: PendingRestartConfirmation = {
    type: 'restart_job',
    deploymentId: pending.deploymentId,
    deploymentName: pending.deploymentName,
    statusAtPrompt: pending.statusAtPrompt,
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONFIRMATION_TTL_MS).toISOString(),
  };

  for (const key of cacheKeys(runtime, context.roomId, context.entityId)) {
    await runtime.setCache(key, stored);
  }

  const setLog: any = {
    type: 'nosana_pending_restart',
    body: {
      action: 'set',
      pending: stored,
      runId: runtime.getCurrentRunId(),
    },
  };
  if (context.entityId) setLog.entityId = context.entityId;
  if (context.roomId) setLog.roomId = context.roomId;
  await runtime.log(setLog);

  return stored;
}

/**
 * Retrieves the latest restart confirmation request in scope if it is still valid.
 *
 * @param runtime - Active Eliza runtime used for scoped cache access.
 * @param context - Optional room/entity scope used to prioritize cached confirmations.
 * @returns Pending restart confirmation payload or `null` when none exists or it has expired.
 * @example
 * const pending = await getPendingRestartConfirmation(runtime, { roomId, entityId });
 */
export async function getPendingRestartConfirmation(
  runtime: IAgentRuntime,
  context: { roomId?: UUID; entityId?: UUID }
): Promise<PendingRestartConfirmation | null> {
  for (const key of cacheKeys(runtime, context.roomId, context.entityId)) {
    const cached = await runtime.getCache<unknown>(key);
    if (!isValidPendingRestart(cached)) continue;

    const expired = Date.now() >= new Date(cached.expiresAt).getTime();
    if (!expired) return cached;
    await runtime.setCache(key, null as any);
  }

  return null;
}

/**
 * Clears any stored restart confirmation requests across scoped cache keys.
 *
 * @param runtime - Active Eliza runtime used for scoped cache/log writes.
 * @param context - Optional room/entity scope used to clear context-specific confirmations.
 * @param reason - Reason code for audit logging of the clear operation.
 * @returns Promise that resolves when all matching cache keys are cleared.
 * @example
 * await clearPendingRestartConfirmation(runtime, { roomId, entityId }, 'approved');
 */
export async function clearPendingRestartConfirmation(
  runtime: IAgentRuntime,
  context: { roomId?: UUID; entityId?: UUID },
  reason: 'approved' | 'cancelled' | 'expired' | 'replaced'
): Promise<void> {
  for (const key of cacheKeys(runtime, context.roomId, context.entityId)) {
    await runtime.setCache(key, null as any);
  }

  const clearLog: any = {
    type: 'nosana_pending_restart',
    body: {
      action: 'clear',
      reason,
      runId: runtime.getCurrentRunId(),
    },
  };
  if (context.entityId) clearLog.entityId = context.entityId;
  if (context.roomId) clearLog.roomId = context.roomId;
  await runtime.log(clearLog);
}
