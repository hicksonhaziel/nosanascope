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
 * Action definition for inspecting active serving nodes behind running deployments.
 *
 * @param runtime - Active Eliza runtime handling the request.
 * @param message - User message used to validate node health intent.
 * @returns Action object whose handler emits node health `ActionResult` values.
 * @example
 * User: "check node health"
 */
export const getNodeHealthAction: Action = {
  name: 'GET_NODE_HEALTH',
  description: 'Check which nodes are actively serving running deployment jobs',
  similes: ['node health', 'node status', 'check nodes', 'gpu availability', 'serving nodes'],
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return (
      (text.includes('node') && (text.includes('health') || text.includes('status') || text.includes('available'))) ||
      text.includes('serving nodes')
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
      const apiKey = getRequiredNosanaApiKey();
      const client = createNosanaClient(undefined as any, {
        api: { apiKey },
      });

      const runningDeploymentsRes = await client.api.deployments.list({
        status: 'RUNNING',
        limit: 50,
      } as any);
      const runningDeployments = runningDeploymentsRes?.deployments || [];

      if (runningDeployments.length === 0) {
        const markets = await client.api.markets.list();
        const fallback = markets.slice(0, 3).map((m: any) => {
          const gpuTypes = Array.isArray(m.gpu_types) && m.gpu_types.length > 0 ? m.gpu_types.join(', ') : 'Unknown';
          return `• ${m.name || m.slug || m.address}: GPU ${gpuTypes}`;
        });

        if (callback) {
          await callback({
            text:
              `🖥️ Node Health:\n` +
              `No RUNNING deployments found, so there are no active serving nodes to inspect.\n` +
              `Available markets: ${markets.length}\n\n` +
              (fallback.length > 0 ? `Top markets:\n${fallback.join('\n')}` : ''),
          });
        }
        return {
          success: true,
          text: 'No running deployments found for node health',
          data: { runningDeployments: 0, markets: markets.length },
        };
      }

      const runningJobsByDeployment = await Promise.all(
        runningDeployments.slice(0, 10).map(async (deployment: any) => {
          try {
            const jobsRes = await deployment.getJobs({
              state: 'RUNNING',
              limit: 20,
              sort_order: 'desc',
            } as any);
            return {
              deployment,
              jobs: jobsRes?.jobs || [],
            };
          } catch {
            return { deployment, jobs: [] };
          }
        })
      );

      const detailTasks: Array<Promise<any>> = [];
      for (const item of runningJobsByDeployment) {
        for (const job of item.jobs.slice(0, 5)) {
          detailTasks.push(
            item.deployment
              .getJob(job.job)
              .then((detail: any) => ({ deployment: item.deployment, job, detail }))
              .catch(() => null)
          );
        }
      }

      const details = (await Promise.all(detailTasks)).filter(Boolean) as any[];
      const nodeStats = new Map<
        string,
        { jobs: number; deployments: Set<string>; onlineEndpoints: number; offlineEndpoints: number }
      >();

      for (const item of details) {
        const node = item?.detail?.node || 'unknown-node';
        const deploymentName = item?.deployment?.name || item?.deployment?.id || 'unknown-deployment';

        let onlineEndpoints = 0;
        let offlineEndpoints = 0;
        const secrets = item?.detail?.jobResult?.secrets;
        if (secrets && typeof secrets === 'object') {
          for (const value of Object.values(secrets as Record<string, unknown>)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            for (const endpoint of Object.values(value as Record<string, unknown>)) {
              if (!endpoint || typeof endpoint !== 'object') continue;
              const status = String((endpoint as any).status || '').toUpperCase();
              if (status === 'ONLINE') onlineEndpoints += 1;
              if (status === 'OFFLINE') offlineEndpoints += 1;
            }
          }
        }

        if (!nodeStats.has(node)) {
          nodeStats.set(node, {
            jobs: 0,
            deployments: new Set<string>(),
            onlineEndpoints: 0,
            offlineEndpoints: 0,
          });
        }
        const current = nodeStats.get(node)!;
        current.jobs += 1;
        current.deployments.add(String(deploymentName));
        current.onlineEndpoints += onlineEndpoints;
        current.offlineEndpoints += offlineEndpoints;
      }

      if (nodeStats.size === 0) {
        if (callback) {
          await callback({
            text:
              `🖥️ Node Health:\n` +
              `Running deployments: ${runningDeployments.length}\n` +
              `No running job details were returned, so per-node serving status is unavailable right now.`,
          });
        }
        return {
          success: true,
          text: 'Running deployments found but no node details available',
          data: { runningDeployments: runningDeployments.length, activeNodes: 0 },
        };
      }

      const topNodes = Array.from(nodeStats.entries())
        .sort((a, b) => b[1].jobs - a[1].jobs)
        .slice(0, 8)
        .map(([node, stats]) => {
          const shortNode = node.length > 14 ? `${node.slice(0, 6)}...${node.slice(-4)}` : node;
          return `• ${shortNode}: ${stats.jobs} running jobs, ${stats.deployments.size} deployments, endpoints online/offline ${stats.onlineEndpoints}/${stats.offlineEndpoints}`;
        });

      const totalOnlineEndpoints = Array.from(nodeStats.values()).reduce((sum, s) => sum + s.onlineEndpoints, 0);
      const totalOfflineEndpoints = Array.from(nodeStats.values()).reduce((sum, s) => sum + s.offlineEndpoints, 0);
      const totalRunningJobs = runningJobsByDeployment.reduce((sum, item) => sum + item.jobs.length, 0);

      const summary =
        `🖥️ Node Health (Serving Traffic):\n` +
        `▸ Running deployments: ${runningDeployments.length}\n` +
        `▸ Running jobs inspected: ${totalRunningJobs}\n` +
        `▸ Active serving nodes: ${nodeStats.size}\n` +
        `▸ Endpoint status (online/offline): ${totalOnlineEndpoints}/${totalOfflineEndpoints}\n\n` +
        `Top nodes:\n${topNodes.join('\n')}`;

      if (callback) await callback({ text: summary });
      return {
        success: true,
        text: 'Fetched node health summary',
        data: { runningDeployments: runningDeployments.length, activeNodes: nodeStats.size },
      };
      
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      const errorMsg = `Failed to fetch node health: ${messageText}`;
      if (callback) await callback({ text: errorMsg });
      return {
        success: false,
        text: errorMsg,
        error: messageText,
      };
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'Check node health' } },
    { name: 'NosanaScope', content: { text: '🖥️ Active markets: 3, GPU-4090: 12 nodes' } },
  ]],
};
