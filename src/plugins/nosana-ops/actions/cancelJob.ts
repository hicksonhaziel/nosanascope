import {
  type Action,
  type ActionResult,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';
import { getRequiredNosanaApiKey } from '../config/envValidation.ts';

/**
 * Action definition for safe deployment cancellation with explicit user confirmation.
 *
 * @param runtime - Active Eliza runtime handling the request.
 * @param message - User message used to validate cancel intent and extract deployment name.
 * @returns Action object whose handler emits a cancellation `ActionResult`.
 * @example
 * User: "cancel job my-deployment"
 */
export const cancelJobAction: Action = {
  name: 'CANCEL_JOB',
  description: 'Stop a running Nosana deployment',
  similes: ['cancel job', 'stop job', 'kill job', 'yes cancel'],
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return (
      ((text.includes('cancel') || text.includes('stop') || text.includes('kill')) && text.includes('job')) ||
      (text.includes('yes') && text.includes('cancel'))
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
      const apiKey = getRequiredNosanaApiKey();
      const client = createNosanaClient(undefined as any, {
        api: { apiKey },
      });
      
      // Check if this is a "yes cancel <name>" confirmation
      const confirmMatch = text.match(/yes.*(?:cancel|stop).*?([a-zA-Z0-9_-]+)/i);
      
      if (confirmMatch) {
        const deploymentName = confirmMatch[1];
        
        const list = await client.api.deployments.list();
        const found = list.deployments.find((d: any) => d.name === deploymentName);
        
        if (!found) {
          if (callback) await callback({ text: `"${deploymentName}" not found.` });
          return {
            success: false,
            text: `"${deploymentName}" not found.`,
            error: 'deployment_not_found',
          };
        }
        
        const deployment = await client.api.deployments.get(found.id);
        await deployment.stop();
        
        if (callback) await callback({ 
          text: `✅ Stopped "${deployment.name}".\nCheck dashboard in 30-60 seconds.`
        });
        return {
          success: true,
          text: `Stopped "${deployment.name}"`,
          data: { deploymentId: String(deployment.id) },
        };
      }
      
      // Initial request
      const nameMatch = text.match(/(?:job|deployment)\s+([a-zA-Z0-9_-]+)/);
      
      if (!nameMatch) {
        if (callback) await callback({ text: 'Usage: "cancel job <name>"' });
        return {
          success: false,
          text: 'Usage: "cancel job <name>"',
          error: 'invalid_cancel_command',
        };
      }
      
      const list = await client.api.deployments.list();
      const found = list.deployments.find((d: any) => d.name === nameMatch[1]);
      
      if (!found) {
        if (callback) await callback({ text: `"${nameMatch[1]}" not found.` });
        return {
          success: false,
          text: `"${nameMatch[1]}" not found.`,
          error: 'deployment_not_found',
        };
      }
      
      if (callback) await callback({ 
        text: `⚠️ Stop "${found.name}"?\n` +
              `Status: ${found.status}, Jobs: ${found.active_jobs}\n\n` +
              `Reply: "yes cancel ${found.name}"`
      });
      return {
        success: false,
        text: `Confirmation required to cancel "${found.name}"`,
        data: { needsConfirmation: true, deploymentName: String(found.name || '') },
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
    { name: '{{name1}}', content: { text: 'Cancel job test2' } },
    { name: 'NosanaScope', content: { text: '⚠️ Stop "test2"? Reply: "yes cancel test2"' } },
  ]],
};
