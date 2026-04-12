import { Action, type IAgentRuntime, type Memory, type State, type HandlerCallback } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';

export const getJobsAction: Action = {
  name: 'GET_JOBS',
  description: 'Fetch your Nosana deployments',
  similes: ['list jobs', 'show jobs', 'my jobs', 'deployments', 'running'],
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return text.includes('job') || text.includes('deploy') || text.includes('running');
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      const client = createNosanaClient(undefined as any, {
        api: { apiKey: process.env.NOSANA_API_KEY },
      });
      
      const response = await client.api.deployments.list();
      const deployments = response.deployments || [];
      
      if (deployments.length === 0) {
        if (callback) await callback({ text: 'No deployments found.' });
        return true;
      }
      
      const running = deployments.filter((d: any) => d.status === 'RUNNING');
      const stopped = deployments.filter((d: any) => d.status === 'STOPPED');
      const error = deployments.filter((d: any) => d.status === 'ERROR');
      
      let summary = 
        `📋 Deployments (${response.total_items} total):\n` +
        `▸ Running: ${running.length}\n` +
        `▸ Stopped: ${stopped.length}\n` +
        `▸ Error: ${error.length}\n\n`;
      
      if (running.length > 0) {
        summary += `Active:\n`;
        running.forEach((d: any) => {
          summary += `  • ${d.name} (${d.active_jobs} jobs)\n`;
        });
      }
      
      if (callback) await callback({ text: summary });
      return true;
      
    } catch (error: any) {
      console.error('[getJobs]', error);
      if (callback) await callback({ text: `Failed: ${error.message}` });
      return false;
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'Show my jobs' } },
    { name: 'NosanaScope', content: { text: 'Running: 1' } },
  ]],
};
