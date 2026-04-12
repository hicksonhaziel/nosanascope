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
 * Action definition for reading assigned, reserved, settled, and available Nosana credits.
 *
 * @param runtime - Active Eliza runtime handling the request.
 * @param message - User message used to validate "credits/balance" intent.
 * @returns Action object whose handler emits a credit balance `ActionResult`.
 * @example
 * User: "what is my balance?"
 */
export const getCreditsAction: Action = {
  name: 'GET_CREDITS',
  description: 'Check Nosana credit balance',
  similes: ['balance', 'credits', 'how much', 'wallet', 'funds'],
  
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const text = message.content?.text?.toLowerCase() || '';
    return text.includes('credit') || text.includes('balance') || text.includes('fund');
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const apiKey = getRequiredNosanaApiKey();
      const client = createNosanaClient(undefined as any, {
        api: { apiKey },
      });
      
      const balance = await client.api.credits.balance();
      
      const available = balance.assignedCredits - balance.reservedCredits - balance.settledCredits;
      
      const response = 
        `💰 Credit Balance:\n` +
        `▸ Assigned: ${balance.assignedCredits.toLocaleString()}\n` +
        `▸ Reserved: ${balance.reservedCredits.toLocaleString()}\n` +
        `▸ Settled: ${balance.settledCredits.toLocaleString()}\n` +
        `▸ Available: ${available.toLocaleString()}` +
        (available < 1000 ? '\n⚠️ Low balance! Top up at deploy.nosana.com' : '');
      
      if (callback) await callback({ text: response });
      return {
        success: true,
        text: 'Fetched credit balance',
        data: { available },
      };
      
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      const errorMsg = `Failed to fetch credits: ${messageText}`;
      if (callback) await callback({ text: errorMsg });
      return {
        success: false,
        text: errorMsg,
        error: messageText,
      };
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'What\'s my balance?' } },
    { name: 'NosanaScope', content: { text: 'Available: 5,420 credits' } },
  ]],
};
