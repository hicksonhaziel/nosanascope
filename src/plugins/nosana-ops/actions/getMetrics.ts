import { Action, type IAgentRuntime, type Memory, type State, type HandlerCallback } from '@elizaos/core';
import { createNosanaClient } from '@nosana/kit';

export const getMetricsAction: Action = {
  name: 'GET_METRICS',
  description:
    'Show detailed infrastructure metrics (deployment distribution, uptime, job snapshot, utilization proxy, burn rate). Not for simple "live state right now" requests.',
  similes: ['metrics', 'stats', 'burn rate', 'uptime', 'gpu utilization', 'detailed metrics'],
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return (
      text.includes('metric') ||
      text.includes('stat') ||
      text.includes('overview') ||
      text.includes('uptime') ||
      text.includes('burn') ||
      (text.includes('gpu') && text.includes('util'))
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
      const client = createNosanaClient(undefined as any, {
        api: { apiKey: process.env.NOSANA_API_KEY },
      });
      
      const [balance, deploymentsRes, markets] = await Promise.all([
        client.api.credits.balance(),
        client.api.deployments.list(),
        client.api.markets.list(),
      ]);
      
      const deployments = deploymentsRes?.deployments || [];
      const available = balance.assignedCredits - balance.reservedCredits - balance.settledCredits;

      const statusCounts = {
        RUNNING: 0,
        STARTING: 0,
        STOPPED: 0,
        STOPPING: 0,
        ERROR: 0,
        DRAFT: 0,
        INSUFFICIENT_FUNDS: 0,
        ARCHIVED: 0,
      };
      for (const d of deployments) {
        const status = String((d as any).status || '').toUpperCase() as keyof typeof statusCounts;
        if (status in statusCounts) statusCounts[status] += 1;
      }

      const runningDeployments = deployments.filter((d: any) => ['RUNNING', 'STARTING'].includes(String(d.status).toUpperCase()));
      const activeJobs = deployments.reduce((sum: number, d: any) => sum + Number(d.active_jobs || 0), 0);

      // Uptime based on deployment creation time (proxy for service uptime)
      const nowMs = Date.now();
      const runningUptimesHours = runningDeployments
        .map((d: any) => {
          const created = d?.created_at ? new Date(d.created_at).getTime() : NaN;
          if (!Number.isFinite(created)) return null;
          return Math.max(0, (nowMs - created) / 3600000);
        })
        .filter((v: number | null): v is number => v !== null);

      const avgUptimeHours =
        runningUptimesHours.length > 0
          ? runningUptimesHours.reduce((a, b) => a + b, 0) / runningUptimesHours.length
          : 0;
      const maxUptimeHours = runningUptimesHours.length > 0 ? Math.max(...runningUptimesHours) : 0;

      // Cost estimation: market nos_job_price_per_second * active_jobs
      const marketByAddress = new Map<string, any>(markets.map((m: any) => [String(m.address), m]));
      let burnRatePerHour = 0;
      const usedGpuTypes = new Set<string>();
      for (const d of runningDeployments as any[]) {
        const market = marketByAddress.get(String(d.market));
        const pricePerSecond = Number(market?.nos_job_price_per_second || 0);
        const runningJobs = Math.max(1, Number(d.active_jobs || d.replicas || 1));
        burnRatePerHour += pricePerSecond * runningJobs * 3600;
        if (Array.isArray(market?.gpu_types)) {
          for (const gpu of market.gpu_types) usedGpuTypes.add(String(gpu));
        }
      }

      const runwayHours = burnRatePerHour > 0 ? available / burnRatePerHour : null;
      const deploymentUtilizationPct =
        deployments.length > 0 ? (runningDeployments.length / deployments.length) * 100 : 0;

      // Sample recent job states across running deployments to show workload health.
      const sampled = await Promise.all(
        runningDeployments.slice(0, 8).map(async (d: any) => {
          try {
            const jobsRes = await d.getJobs({ limit: 50, sort_order: 'desc' } as any);
            return jobsRes?.jobs || [];
          } catch {
            return [];
          }
        })
      );
      const sampledJobs = sampled.flat();
      const jobStateCounts = { RUNNING: 0, QUEUED: 0, COMPLETED: 0, STOPPED: 0 };
      for (const job of sampledJobs as any[]) {
        const state = String(job?.state || '').toUpperCase() as keyof typeof jobStateCounts;
        if (state in jobStateCounts) jobStateCounts[state] += 1;
      }

      const metrics =
        `📊 Infrastructure Metrics:\n` +
        `▸ Deployments: ${deployments.length} total | ${statusCounts.RUNNING} running | ${statusCounts.STARTING} starting | ${statusCounts.STOPPED} stopped | ${statusCounts.ERROR} error\n` +
        `▸ Active jobs: ${activeJobs}\n` +
        `▸ Utilization (deployment proxy): ${deploymentUtilizationPct.toFixed(1)}%\n` +
        `▸ Uptime: avg ${avgUptimeHours.toFixed(1)}h, longest ${maxUptimeHours.toFixed(1)}h\n` +
        `▸ Jobs snapshot: running ${jobStateCounts.RUNNING}, queued ${jobStateCounts.QUEUED}, completed ${jobStateCounts.COMPLETED}, stopped ${jobStateCounts.STOPPED}\n` +
        `▸ Credits: available ${available.toLocaleString()}, reserved ${balance.reservedCredits.toLocaleString()}, settled ${balance.settledCredits.toLocaleString()}\n` +
        `▸ Burn rate (est): ${burnRatePerHour.toFixed(2)} credits/hour\n` +
        `▸ Runway (est): ${runwayHours === null ? 'N/A' : `${runwayHours.toFixed(1)}h`}\n` +
        `▸ GPU markets in use: ${usedGpuTypes.size > 0 ? Array.from(usedGpuTypes).slice(0, 6).join(', ') : 'unknown'}`;
      
      if (callback) await callback({ text: metrics });
      return true;
      
    } catch (error: any) {
      if (callback) await callback({ text: `Failed: ${error.message}` });
      return false;
    }
  },
  
  examples: [[
    { name: '{{name1}}', content: { text: 'metrics' } },
    { name: 'NosanaScope', content: { text: 'Deployments: 2, Credits: 1,500' } },
  ]],
};
