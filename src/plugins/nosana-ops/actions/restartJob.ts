import { Action, type IAgentRuntime, type Memory, type State, type HandlerCallback } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';
import {
  clearPendingRestartConfirmation,
  getPendingRestartConfirmation,
  setPendingRestartConfirmation,
} from './restartConfirmationStore.ts';

function parseYesNoDecision(input: string): 'yes' | 'no' | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  if (/^(yes|yep|yeah|confirm|proceed|do it)\b/.test(text)) return 'yes';
  if (/^(no|nope|cancel|abort|stop)\b/.test(text)) return 'no';

  if (/\byes\b/.test(text) && !/\bno\b/.test(text)) return 'yes';
  if (/\bno\b/.test(text) && !/\byes\b/.test(text)) return 'no';

  return null;
}

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
  ): Promise<boolean> => {
    try {
      const text = message.content?.text || '';
      const decision = parseYesNoDecision(text);
      const client = createNosanaClient(undefined as any, {
        api: { apiKey: process.env.NOSANA_API_KEY },
      });

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
          console.log('[restartJob] Stop then start:', deployment.id, 'status:', status);
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

        console.log('[restartJob] Start only:', deployment.id, 'status:', status);
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
        console.log('[restartJob] Confirmed restart for:', deploymentIdOrName);
        await clearPendingRestartConfirmation(
          runtime,
          { roomId: message.roomId, entityId: message.entityId },
          'approved'
        );
        return await restartDeployment(deploymentIdOrName);
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
            return false;
          }

          await clearPendingRestartConfirmation(
            runtime,
            { roomId: message.roomId, entityId: message.entityId },
            'approved'
          );
          console.log('[restartJob] Approved via YES for pending deployment:', pending.deploymentName);
          return await restartDeployment(pending.deploymentId);
        }
      }

      // Initial request
      const nameMatch = text.match(/(?:job|deployment)\s+([a-zA-Z0-9_-]+)/i);
      if (!nameMatch) {
        if (decision && callback) {
          await callback({ text: 'No pending restart confirmation. Use "restart job <name>" first.' });
          return false;
        }
        if (callback) await callback({ text: 'Usage: "restart job <name>" or "restart deployment <id>"' });
        return false;
      }

      const identifier = nameMatch[1];
      const found = await findDeployment(identifier);

      if (!found) {
        if (callback) await callback({ text: `"${identifier}" not found.` });
        return false;
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
      return false;
      
    } catch (error: any) {
      console.error('[restartJob] ERROR:', error);
      if (callback) await callback({ text: `Failed: ${error.message}` });
      return false;
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'Restart job test2' } },
    { name: 'NosanaScope', content: { text: '⚠️ Restart "test2"? Reply: "yes restart test2"' } },
  ]],
};
