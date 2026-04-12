import {
  type Action,
  type ActionResult,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';
import {
  clearPendingRestartConfirmation,
  getPendingRestartConfirmation,
  setPendingRestartConfirmation,
} from './restartConfirmationStore.ts';
import { getRequiredNosanaApiKey } from '../config/envValidation.ts';

const RESTART_RATE_LIMIT_WINDOW_MS = 60_000;
const RESTART_RATE_LIMIT_MAX_REQUESTS = 3;
const restartAttemptsByScope = new Map<string, number[]>();

function parseYesNoDecision(input: string): 'yes' | 'no' | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  if (/^(yes|yep|yeah|confirm|proceed|do it)\b/.test(text)) return 'yes';
  if (/^(no|nope|cancel|abort|stop)\b/.test(text)) return 'no';

  if (/\byes\b/.test(text) && !/\bno\b/.test(text)) return 'yes';
  if (/\bno\b/.test(text) && !/\byes\b/.test(text)) return 'no';

  return null;
}

function buildRestartScopeKey(runtime: IAgentRuntime, message: Memory): string {
  return `${String(runtime.agentId)}:${String(message.roomId)}:${String(message.entityId)}`;
}

function consumeRestartToken(scopeKey: string): {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
} {
  const now = Date.now();
  const windowStart = now - RESTART_RATE_LIMIT_WINDOW_MS;
  const attempts = (restartAttemptsByScope.get(scopeKey) || []).filter((t) => t > windowStart);

  if (attempts.length >= RESTART_RATE_LIMIT_MAX_REQUESTS) {
    const oldest = attempts[0] || now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((RESTART_RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000)
    );
    restartAttemptsByScope.set(scopeKey, attempts);
    return { allowed: false, retryAfterSeconds, remaining: 0 };
  }

  attempts.push(now);
  restartAttemptsByScope.set(scopeKey, attempts);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, RESTART_RATE_LIMIT_MAX_REQUESTS - attempts.length),
  };
}

/**
 * Action definition for safe restart/start operations with YES/NO confirmation and rate limiting.
 *
 * @param runtime - Active Eliza runtime handling the request.
 * @param message - User message used to validate restart intent or confirmation response.
 * @returns Action object whose handler emits restart workflow `ActionResult` values.
 * @example
 * User: "restart job my-deployment" then "YES"
 */
export const restartJobAction: Action = {
  name: 'RESTART_JOB',
  description: 'Restart or start a Nosana deployment safely based on status',
  similes: ['restart job', 'restart deployment', 'reboot job', 'yes restart', 'yes', 'no'],
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    const decision = parseYesNoDecision(text);
    if (decision) {
      const pending = await getPendingRestartConfirmation(runtime, {
        roomId: message.roomId,
        entityId: message.entityId,
      });
      if (pending) return true;
    }

    return (
      (text.includes('restart') && (text.includes('job') || text.includes('deployment'))) ||
      (text.includes('yes') && text.includes('restart'))
    );
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const text = message.content?.text || '';
      const decision = parseYesNoDecision(text);
      const apiKey = getRequiredNosanaApiKey();
      const client = createNosanaClient(undefined as any, {
        api: { apiKey },
      });
      const scopeKey = buildRestartScopeKey(runtime, message);

      const findDeployment = async (identifier: string) => {
        const list = await client.api.deployments.list();
        return list.deployments.find((d: any) => d.name === identifier || d.id === identifier);
      };

      const restartDeployment = async (identifier: string): Promise<boolean> => {
        const found = await findDeployment(identifier);
        if (!found) {
          if (callback) await callback({ text: `"${identifier}" not found.` });
          return false;
        }

        const deployment = await client.api.deployments.get(found.id);
        const status = String(deployment.status || '').toUpperCase();

        if (status === 'ARCHIVED') {
          if (callback) await callback({
            text: `Cannot restart "${deployment.name}" because it is ARCHIVED.`,
          });
          return false;
        }

        if (status === 'STOPPING') {
          if (callback) await callback({
            text: `"${deployment.name}" is currently STOPPING. Wait for STOPPED, then run restart again.`,
          });
          return false;
        }

        if (status === 'RUNNING' || status === 'STARTING') {
          await deployment.stop();
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await deployment.start();
          if (callback) {
            await callback({
              text: `✅ Restarted "${deployment.name}" (stop + start).\nCheck dashboard in 30-60 seconds.`,
            });
          }
          return true;
        }

        await deployment.start();
        if (callback) {
          await callback({
            text: `✅ Started "${deployment.name}" from ${status || 'current'} state.\nCheck dashboard in 30-60 seconds.`,
          });
        }
        return true;
      };

      // Explicit confirmation path: "yes restart <deployment-name-or-id>"
      const confirmMatch = text.match(/\byes\s+restart\s+([a-zA-Z0-9_-]+)\b/i);
      if (confirmMatch) {
        const deploymentIdOrName = confirmMatch[1];
        const rate = consumeRestartToken(scopeKey);
        if (!rate.allowed) {
          if (callback) {
            await callback({
              text:
                `Rate limit reached: restart can run up to ${RESTART_RATE_LIMIT_MAX_REQUESTS} times per minute.\n` +
                `Try again in ${rate.retryAfterSeconds}s.`,
            });
          }
          return {
            success: false,
            text: 'Restart rate limit reached',
            error: 'restart_rate_limited',
            data: { retryAfterSeconds: rate.retryAfterSeconds },
          };
        }

        await clearPendingRestartConfirmation(
          runtime,
          { roomId: message.roomId, entityId: message.entityId },
          'approved'
        );
        const ok = await restartDeployment(deploymentIdOrName);
        return {
          success: ok,
          text: ok ? `Restart executed for "${deploymentIdOrName}"` : `Restart failed for "${deploymentIdOrName}"`,
          data: { deploymentIdOrName },
          ...(ok ? {} : { error: 'restart_failed' }),
        };
      }

      // Generic YES/NO path for pending confirmations (works well on Telegram).
      if (decision) {
        const pending = await getPendingRestartConfirmation(runtime, {
          roomId: message.roomId,
          entityId: message.entityId,
        });
        if (pending) {
          if (decision === 'no') {
            await clearPendingRestartConfirmation(
              runtime,
              { roomId: message.roomId, entityId: message.entityId },
              'cancelled'
            );
            if (callback) await callback({ text: `❌ Restart cancelled for "${pending.deploymentName}".` });
            return {
              success: false,
              text: `Restart cancelled for "${pending.deploymentName}".`,
              error: 'restart_cancelled',
            };
          }

          const rate = consumeRestartToken(scopeKey);
          if (!rate.allowed) {
            if (callback) {
              await callback({
                text:
                  `Rate limit reached: restart can run up to ${RESTART_RATE_LIMIT_MAX_REQUESTS} times per minute.\n` +
                  `Try again in ${rate.retryAfterSeconds}s.`,
              });
            }
            return {
              success: false,
              text: 'Restart rate limit reached',
              error: 'restart_rate_limited',
              data: { retryAfterSeconds: rate.retryAfterSeconds },
            };
          }

          await clearPendingRestartConfirmation(
            runtime,
            { roomId: message.roomId, entityId: message.entityId },
            'approved'
          );
          const ok = await restartDeployment(pending.deploymentId);
          return {
            success: ok,
            text: ok
              ? `Restart executed for "${pending.deploymentName}"`
              : `Restart failed for "${pending.deploymentName}"`,
            data: { deploymentId: pending.deploymentId, deploymentName: pending.deploymentName },
            ...(ok ? {} : { error: 'restart_failed' }),
          };
        }
      }

      // Initial request
      const nameMatch = text.match(/(?:job|deployment)\s+([a-zA-Z0-9_-]+)/i);
      if (!nameMatch) {
        if (decision && callback) {
          await callback({ text: 'No pending restart confirmation. Use "restart job <name>" first.' });
          return {
            success: false,
            text: 'No pending restart confirmation. Use "restart job <name>" first.',
            error: 'no_pending_confirmation',
          };
        }
        if (callback) await callback({ text: 'Usage: "restart job <name>" or "restart deployment <id>"' });
        return {
          success: false,
          text: 'Usage: "restart job <name>" or "restart deployment <id>"',
          error: 'invalid_restart_command',
        };
      }

      const identifier = nameMatch[1];
      const found = await findDeployment(identifier);

      if (!found) {
        if (callback) await callback({ text: `"${identifier}" not found.` });
        return {
          success: false,
          text: `"${identifier}" not found.`,
          error: 'deployment_not_found',
        };
      }

      const foundStatus = String(found.status || '').toUpperCase();
      const actionSummary =
        foundStatus === 'RUNNING' || foundStatus === 'STARTING'
          ? 'This will stop and then start the deployment.'
          : `This will start the deployment from ${foundStatus || 'its current'} state.`;

      await setPendingRestartConfirmation(
        runtime,
        { roomId: message.roomId, entityId: message.entityId },
        {
          deploymentId: found.id,
          deploymentName: found.name,
          statusAtPrompt: foundStatus || 'UNKNOWN',
        }
      );

      if (callback)
        await callback({
          text:
            `⚠️ Restart "${found.name}"?\n` +
            `${actionSummary}\n\n` +
            `Reply YES to confirm or NO to cancel.\n` +
            `Shortcut: "yes restart ${found.name}"`,
        });
      return {
        success: false,
        text: `Confirmation required to restart "${found.name}"`,
        data: { needsConfirmation: true, deploymentId: String(found.id) },
      };
      
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (callback) await callback({ text: `Failed: ${messageText}` });
      return {
        success: false,
        text: `Failed: ${messageText}`,
        error: messageText,
      };
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'Restart job test2' } },
    { name: 'NosanaScope', content: { text: '⚠️ Restart "test2"? Reply: "yes restart test2"' } },
  ]],
};
