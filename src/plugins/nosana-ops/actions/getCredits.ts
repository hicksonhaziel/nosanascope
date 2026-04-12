import { Action, type IAgentRuntime, type Memory, type State, type HandlerCallback } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';

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
  ): Promise<boolean> => {
    try {
      // Correct way: no network param when using API
      const client = createNosanaClient(undefined as any, {
        api: { apiKey: process.env.NOSANA_API_KEY },
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
      return true;
      
    } catch (error: any) {
      const errorMsg = `Failed to fetch credits: ${error.message}`;
      console.error('[getCredits]', errorMsg, error);
      if (callback) await callback({ text: errorMsg });
      return false;
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'What\'s my balance?' } },
    { name: 'NosanaScope', content: { text: 'Available: 5,420 credits' } },
  ]],
};