import { Action, type IAgentRuntime, type Memory, type State, type HandlerCallback } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';

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
  ): Promise<boolean> => {
    try {
      const text = message.content?.text || '';
      const client = createNosanaClient(undefined as any, {
        api: { apiKey: process.env.NOSANA_API_KEY },
      });
      
      // Check if this is a "yes cancel <name>" confirmation
      const confirmMatch = text.match(/yes.*(?:cancel|stop).*?([a-zA-Z0-9_-]+)/i);
      
      if (confirmMatch) {
        const deploymentName = confirmMatch[1];
        
        console.log('[cancelJob] Confirmed cancellation for:', deploymentName);
        
        const list = await client.api.deployments.list();
        const found = list.deployments.find((d: any) => d.name === deploymentName);
        
        if (!found) {
          if (callback) await callback({ text: `"${deploymentName}" not found.` });
          return false;
        }
        
        const deployment = await client.api.deployments.get(found.id);
        
        console.log('[cancelJob] Stopping:', deployment.id, '- Status:', deployment.status);
        const result = await deployment.stop();
        console.log('[cancelJob] Stop result:', JSON.stringify(result, null, 2));
        
        if (callback) await callback({ 
          text: `✅ Stopped "${deployment.name}".\nCheck dashboard in 30-60 seconds.`
        });
        return true;
      }
      
      // Initial request
      const nameMatch = text.match(/(?:job|deployment)\s+([a-zA-Z0-9_-]+)/);
      
      if (!nameMatch) {
        if (callback) await callback({ text: 'Usage: "cancel job <name>"' });
        return false;
      }
      
      const list = await client.api.deployments.list();
      const found = list.deployments.find((d: any) => d.name === nameMatch[1]);
      
      if (!found) {
        if (callback) await callback({ text: `"${nameMatch[1]}" not found.` });
        return false;
      }
      
      if (callback) await callback({ 
        text: `⚠️ Stop "${found.name}"?\n` +
              `Status: ${found.status}, Jobs: ${found.active_jobs}\n\n` +
              `Reply: "yes cancel ${found.name}"`
      });
      return false;
      
    } catch (error: any) {
      console.error('[cancelJob] ERROR:', error);
      if (callback) await callback({ text: `Failed: ${error.message}` });
      return false;
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'Cancel job test2' } },
    { name: 'NosanaScope', content: { text: '⚠️ Stop "test2"? Reply: "yes cancel test2"' } },
  ]],
};
