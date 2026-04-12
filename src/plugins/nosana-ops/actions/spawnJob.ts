import { Action, type IAgentRuntime, type Memory, type State, type HandlerCallback } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';

export const spawnJobAction: Action = {
  name: 'SPAWN_JOB',
  description: 'Create and start a deployment from a stored template',
  similes: ['spawn job', 'launch job', 'create job', 'deploy template', 'spawn deployment'],
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return (
      ((text.includes('spawn') || text.includes('launch') || text.includes('create') || text.includes('deploy')) &&
        (text.includes('job') || text.includes('deployment') || text.includes('template'))) ||
      /\byes\s+(spawn|launch|create|deploy)\b/.test(text)
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
      const text = message.content?.text?.toLowerCase() || '';
      const isConfirmed = /\byes\s+(spawn|launch|create|deploy)\b/.test(text);

      // Get template from env
      const templateJson = process.env.NOSANA_JOB_TEMPLATE;
      
      if (!templateJson) {
        if (callback) await callback({ 
          text: 'No job template configured. Set NOSANA_JOB_TEMPLATE in your .env file.' 
        });
        return false;
      }
      
      let template: any;
      try {
        template = JSON.parse(templateJson);
      } catch {
        if (callback) {
          await callback({
            text: 'NOSANA_JOB_TEMPLATE is invalid JSON. Fix the env value before spawning.',
          });
        }
        return false;
      }

      const missing: string[] = [];
      if (!template?.name) missing.push('name');
      if (!template?.market) missing.push('market');
      if (!template?.strategy) missing.push('strategy');
      if (!template?.replicas) missing.push('replicas');
      if (!template?.timeout) missing.push('timeout');
      if (!template?.job_definition) missing.push('job_definition');
      if (missing.length > 0) {
        if (callback) {
          await callback({
            text: `Template is missing required fields: ${missing.join(', ')}`,
          });
        }
        return false;
      }

      const client = createNosanaClient(undefined as any, {
        api: { apiKey: process.env.NOSANA_API_KEY },
      });
      
      // Safety confirmation (explicit text confirmation)
      if (!isConfirmed) {
        if (callback) await callback({ 
          text: `⚠️ Confirm: Create + start deployment from template?\n` +
                `Name: ${template.name}\n` +
                `Market: ${template.market}\n\n` +
                `Strategy: ${template.strategy}, Replicas: ${template.replicas}, Timeout: ${template.timeout}m\n\n` +
                `Reply: "yes spawn"`
        });
        return false;
      }
      
      // Create deployment
      const deployment = await client.api.deployments.create(template);

      let status = String(deployment.status || '').toUpperCase();
      let startNote = '';

      // New deployments are commonly DRAFT; start them so "spawn" truly launches.
      if (status === 'DRAFT' || status === 'STOPPED') {
        await deployment.start();
        status = 'STARTING';
        startNote = '\nAuto-start triggered.';
      }

      if (callback)
        await callback({
          text:
            `✅ Deployment "${deployment.name}" created.\n` +
            `ID: ${deployment.id}\n` +
            `Status: ${status}${startNote}`,
        });
      return true;
      
    } catch (error: any) {
      const errorMsg = `Failed to spawn: ${error.message}`;
      console.error('[spawnJob]', errorMsg, error);
      if (callback) await callback({ text: errorMsg });
      return false;
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'Spawn a new job from template' } },
    { name: 'NosanaScope', content: { text: '⚠️ Confirm: Launch template? Reply "yes"' } },
  ]],
};
