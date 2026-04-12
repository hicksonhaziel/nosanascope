import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createNosanaClient } from '@nosana/kit';

import { cancelJobAction } from '../../src/plugins/nosana-ops/actions/cancelJob.ts';
import { getCreditsAction } from '../../src/plugins/nosana-ops/actions/getCredits.ts';
import { getJobsAction } from '../../src/plugins/nosana-ops/actions/getJobs.ts';
import { getMetricsAction } from '../../src/plugins/nosana-ops/actions/getMetrics.ts';
import { getNodeHealthAction } from '../../src/plugins/nosana-ops/actions/getNodeHealth.ts';
import { restartJobAction } from '../../src/plugins/nosana-ops/actions/restartJob.ts';
import {
  clearPendingRestartConfirmation,
  getPendingRestartConfirmation,
  setPendingRestartConfirmation,
} from '../../src/plugins/nosana-ops/actions/restartConfirmationStore.ts';
import { spawnJobAction } from '../../src/plugins/nosana-ops/actions/spawnJob.ts';

jest.mock('@nosana/kit', () => ({
  createNosanaClient: jest.fn(),
}));

jest.mock('../../src/plugins/nosana-ops/actions/restartConfirmationStore.ts', () => ({
  clearPendingRestartConfirmation: jest.fn(),
  getPendingRestartConfirmation: jest.fn(),
  setPendingRestartConfirmation: jest.fn(),
}));

const createNosanaClientMock = createNosanaClient as unknown as jest.Mock;
const getPendingMock = getPendingRestartConfirmation as unknown as jest.Mock;
const setPendingMock = setPendingRestartConfirmation as unknown as jest.Mock;
const clearPendingMock = clearPendingRestartConfirmation as unknown as jest.Mock;

const runtime = { agentId: 'agent-1' } as any;

function makeMessage(text: string): any {
  return {
    content: { text },
    roomId: 'room-1',
    entityId: 'entity-1',
  };
}

function mockCallback() {
  return jest.fn(async () => undefined);
}

describe('Nosana actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NOSANA_API_KEY = 'test-key';
    process.env.NOSANA_JOB_TEMPLATE = '';
    getPendingMock.mockResolvedValue(null);
  });

  describe('getJobsAction', () => {
    it('returns no deployments message when list is empty', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({ deployments: [], total_items: 0 }),
          },
        },
      });

      const callback = mockCallback();
      const result = await getJobsAction.handler(runtime, makeMessage('show jobs'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ text: 'No deployments found.' }));
    });

    it('returns summarized deployment counts', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({
              total_items: 3,
              deployments: [
                { name: 'alpha', status: 'RUNNING', active_jobs: 2 },
                { name: 'beta', status: 'STOPPED', active_jobs: 0 },
                { name: 'gamma', status: 'ERROR', active_jobs: 1 },
              ],
            }),
          },
        },
      });

      const callback = mockCallback();
      const result = await getJobsAction.handler(runtime, makeMessage('list jobs'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      const text = String(callback.mock.calls[0][0].text);
      expect(text).toContain('Deployments (3 total)');
      expect(text).toContain('Running: 1');
      expect(text).toContain('Stopped: 1');
      expect(text).toContain('Error: 1');
      expect(text).toContain('alpha (2 jobs)');
    });

    it('returns failure when SDK call throws', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockRejectedValue(new Error('list failed')),
          },
        },
      });

      const callback = mockCallback();
      const result = await getJobsAction.handler(runtime, makeMessage('jobs'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(String(callback.mock.calls[0][0].text)).toContain('Failed: list failed');
    });
  });

  describe('getCreditsAction', () => {
    it('returns formatted credit balance with low-balance warning', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          credits: {
            balance: jest.fn().mockResolvedValue({
              assignedCredits: 1500,
              reservedCredits: 300,
              settledCredits: 250,
            }),
          },
        },
      });

      const callback = mockCallback();
      const result = await getCreditsAction.handler(runtime, makeMessage('balance'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      const text = String(callback.mock.calls[0][0].text);
      expect(text).toContain('Available: 950');
      expect(text).toContain('Low balance!');
    });

    it('returns failure when credits endpoint throws', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          credits: {
            balance: jest.fn().mockRejectedValue(new Error('credits failed')),
          },
        },
      });

      const callback = mockCallback();
      const result = await getCreditsAction.handler(runtime, makeMessage('credits'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(String(callback.mock.calls[0][0].text)).toContain('Failed to fetch credits: credits failed');
    });
  });

  describe('getMetricsAction', () => {
    it('returns infrastructure metrics summary', async () => {
      const runningDeployment = {
        status: 'RUNNING',
        active_jobs: 2,
        replicas: 2,
        market: 'market-1',
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        getJobs: jest.fn().mockResolvedValue({
          jobs: [{ state: 'RUNNING' }, { state: 'QUEUED' }, { state: 'COMPLETED' }],
        }),
      };

      const stoppedDeployment = {
        status: 'STOPPED',
        active_jobs: 0,
        replicas: 0,
        created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      };

      createNosanaClientMock.mockReturnValue({
        api: {
          credits: {
            balance: jest.fn().mockResolvedValue({
              assignedCredits: 2000,
              reservedCredits: 200,
              settledCredits: 100,
            }),
          },
          deployments: {
            list: jest.fn().mockResolvedValue({
              deployments: [runningDeployment, stoppedDeployment],
            }),
          },
          markets: {
            list: jest.fn().mockResolvedValue([
              { address: 'market-1', nos_job_price_per_second: 0.01, gpu_types: ['RTX4090'] },
            ]),
          },
        },
      });

      const callback = mockCallback();
      const result = await getMetricsAction.handler(runtime, makeMessage('show metrics'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      const text = String(callback.mock.calls[0][0].text);
      expect(text).toContain('Infrastructure Metrics');
      expect(text).toContain('Deployments: 2 total');
      expect(text).toContain('Active jobs: 2');
      expect(text).toContain('Burn rate (est):');
      expect(text).toContain('GPU markets in use: RTX4090');
    });

    it('returns failure when metrics fetch fails', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          credits: { balance: jest.fn().mockRejectedValue(new Error('metrics failed')) },
          deployments: { list: jest.fn() },
          markets: { list: jest.fn() },
        },
      });

      const callback = mockCallback();
      const result = await getMetricsAction.handler(runtime, makeMessage('metrics'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(String(callback.mock.calls[0][0].text)).toContain('Failed: metrics failed');
    });
  });

  describe('cancelJobAction', () => {
    it('asks for confirmation on initial cancel request', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({
              deployments: [{ id: 'dep-1', name: 'test2', status: 'RUNNING', active_jobs: 1 }],
            }),
          },
        },
      });

      const callback = mockCallback();
      const result = await cancelJobAction.handler(runtime, makeMessage('cancel job test2'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      const text = String(callback.mock.calls[0][0].text);
      expect(text).toContain('Stop "test2"?');
      expect(text).toContain('yes cancel test2');
    });

    it('stops deployment on yes cancel confirmation', async () => {
      const stop = jest.fn().mockResolvedValue({ ok: true });
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({
              deployments: [{ id: 'dep-1', name: 'test2', status: 'RUNNING', active_jobs: 1 }],
            }),
            get: jest.fn().mockResolvedValue({ id: 'dep-1', name: 'test2', status: 'RUNNING', stop }),
          },
        },
      });

      const callback = mockCallback();
      const result = await cancelJobAction.handler(runtime, makeMessage('yes cancel test2'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(String(callback.mock.calls[0][0].text)).toContain('Stopped "test2"');
    });

    it('returns not-found when deployment does not exist', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({ deployments: [] }),
          },
        },
      });

      const callback = mockCallback();
      const result = await cancelJobAction.handler(runtime, makeMessage('cancel job missing-one'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(String(callback.mock.calls[0][0].text)).toContain('"missing-one" not found.');
    });
  });

  describe('restartJobAction', () => {
    it('stores pending confirmation on initial restart request', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({
              deployments: [{ id: 'dep-1', name: 'test2', status: 'RUNNING', active_jobs: 1 }],
            }),
          },
        },
      });

      const callback = mockCallback();
      const result = await restartJobAction.handler(runtime, makeMessage('restart job test2'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(setPendingMock).toHaveBeenCalledTimes(1);
      expect(String(callback.mock.calls[0][0].text)).toContain('Reply YES to confirm or NO to cancel');
    });

    it('restarts deployment on yes restart shortcut', async () => {
      const stop = jest.fn().mockResolvedValue(undefined);
      const start = jest.fn().mockResolvedValue(undefined);

      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({
              deployments: [{ id: 'dep-1', name: 'test2', status: 'RUNNING', active_jobs: 1 }],
            }),
            get: jest.fn().mockResolvedValue({
              id: 'dep-1',
              name: 'test2',
              status: 'RUNNING',
              stop,
              start,
            }),
          },
        },
      });

      const callback = mockCallback();
      const result = await restartJobAction.handler(runtime, makeMessage('yes restart test2'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      expect(clearPendingMock).toHaveBeenCalledWith(
        runtime,
        { roomId: 'room-1', entityId: 'entity-1' },
        'approved'
      );
      expect(stop).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
      expect(String(callback.mock.calls[0][0].text)).toContain('Restarted "test2"');
    });

    it('cancels pending restart when user replies no', async () => {
      getPendingMock.mockResolvedValue({
        type: 'restart_job',
        deploymentId: 'dep-1',
        deploymentName: 'test2',
        statusAtPrompt: 'RUNNING',
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });

      createNosanaClientMock.mockReturnValue({
        api: { deployments: { list: jest.fn(), get: jest.fn() } },
      });

      const callback = mockCallback();
      const result = await restartJobAction.handler(runtime, makeMessage('no'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(clearPendingMock).toHaveBeenCalledWith(
        runtime,
        { roomId: 'room-1', entityId: 'entity-1' },
        'cancelled'
      );
      expect(String(callback.mock.calls[0][0].text)).toContain('Restart cancelled');
    });

    it('enforces restart rate limit (max 3 per minute)', async () => {
      const rateLimitRuntime = { agentId: 'agent-rate-limit' } as any;
      const rateLimitMessage = (text: string) => ({
        content: { text },
        roomId: 'room-rate-limit',
        entityId: 'entity-rate-limit',
      });

      const start = jest.fn().mockResolvedValue(undefined);
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({
              deployments: [{ id: 'dep-1', name: 'test2', status: 'STOPPED', active_jobs: 0 }],
            }),
            get: jest.fn().mockResolvedValue({
              id: 'dep-1',
              name: 'test2',
              status: 'STOPPED',
              start,
              stop: jest.fn(),
            }),
          },
        },
      });

      const callback = mockCallback();
      const attempts = [
        await restartJobAction.handler(
          rateLimitRuntime,
          rateLimitMessage('yes restart test2'),
          undefined,
          undefined,
          callback
        ),
        await restartJobAction.handler(
          rateLimitRuntime,
          rateLimitMessage('yes restart test2'),
          undefined,
          undefined,
          callback
        ),
        await restartJobAction.handler(
          rateLimitRuntime,
          rateLimitMessage('yes restart test2'),
          undefined,
          undefined,
          callback
        ),
        await restartJobAction.handler(
          rateLimitRuntime,
          rateLimitMessage('yes restart test2'),
          undefined,
          undefined,
          callback
        ),
      ];

      expect(attempts[0].success).toBe(true);
      expect(attempts[1].success).toBe(true);
      expect(attempts[2].success).toBe(true);
      expect(attempts[3].success).toBe(false);
      const lastText = String(callback.mock.calls[callback.mock.calls.length - 1][0].text);
      expect(lastText).toContain('Rate limit reached');
    });
  });

  describe('spawnJobAction', () => {
    it('returns message when template env var is missing', async () => {
      process.env.NOSANA_JOB_TEMPLATE = '';
      const callback = mockCallback();

      const result = await spawnJobAction.handler(runtime, makeMessage('spawn job'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(String(callback.mock.calls[0][0].text)).toContain('No job template configured');
    });

    it('asks for confirmation when request is not confirmed', async () => {
      process.env.NOSANA_JOB_TEMPLATE = JSON.stringify({
        name: 'demo-template',
        market: 'market-1',
        strategy: 'immediate',
        replicas: 1,
        timeout: 10,
        job_definition: { ops: [] },
      });

      createNosanaClientMock.mockReturnValue({
        api: { deployments: { create: jest.fn() } },
      });

      const callback = mockCallback();
      const result = await spawnJobAction.handler(runtime, makeMessage('spawn deployment from template'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(String(callback.mock.calls[0][0].text)).toContain('Reply: "yes spawn"');
    });

    it('creates and auto-starts deployment on yes spawn', async () => {
      process.env.NOSANA_JOB_TEMPLATE = JSON.stringify({
        name: 'demo-template',
        market: 'market-1',
        strategy: 'immediate',
        replicas: 1,
        timeout: 10,
        job_definition: { ops: [] },
      });

      const start = jest.fn().mockResolvedValue(undefined);
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            create: jest.fn().mockResolvedValue({
              id: 'dep-3',
              name: 'demo-template',
              status: 'DRAFT',
              start,
            }),
          },
        },
      });

      const callback = mockCallback();
      const result = await spawnJobAction.handler(runtime, makeMessage('yes spawn'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      expect(start).toHaveBeenCalledTimes(1);
      const text = String(callback.mock.calls[0][0].text);
      expect(text).toContain('Deployment "demo-template" created');
      expect(text).toContain('Auto-start triggered');
    });
  });

  describe('getNodeHealthAction', () => {
    it('shows markets fallback when there are no running deployments', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({ deployments: [] }),
          },
          markets: {
            list: jest.fn().mockResolvedValue([
              { name: 'Market A', gpu_types: ['RTX4090'], address: 'm1' },
            ]),
          },
        },
      });

      const callback = mockCallback();
      const result = await getNodeHealthAction.handler(runtime, makeMessage('check node health'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      const text = String(callback.mock.calls[0][0].text);
      expect(text).toContain('No RUNNING deployments found');
      expect(text).toContain('Available markets: 1');
    });

    it('summarizes serving node stats from running jobs', async () => {
      const deployment = {
        id: 'dep-9',
        name: 'dep-main',
        status: 'RUNNING',
        getJobs: jest.fn().mockResolvedValue({
          jobs: [{ job: 'job-1' }, { job: 'job-2' }],
        }),
        getJob: jest.fn().mockResolvedValue({
          node: 'node-abcdef123456',
          jobResult: {
            secrets: {
              service: {
                first: { status: 'ONLINE' },
                second: { status: 'OFFLINE' },
              },
            },
          },
        }),
      };

      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockResolvedValue({ deployments: [deployment] }),
          },
          markets: {
            list: jest.fn().mockResolvedValue([]),
          },
        },
      });

      const callback = mockCallback();
      const result = await getNodeHealthAction.handler(runtime, makeMessage('node status'), undefined, undefined, callback);

      expect(result.success).toBe(true);
      const text = String(callback.mock.calls[0][0].text);
      expect(text).toContain('Active serving nodes: 1');
      expect(text).toContain('Top nodes:');
      expect(text).toContain('online/offline');
    });

    it('returns failure message when health call crashes', async () => {
      createNosanaClientMock.mockReturnValue({
        api: {
          deployments: {
            list: jest.fn().mockRejectedValue(new Error('health failed')),
          },
          markets: {
            list: jest.fn(),
          },
        },
      });

      const callback = mockCallback();
      const result = await getNodeHealthAction.handler(runtime, makeMessage('serving nodes'), undefined, undefined, callback);

      expect(result.success).toBe(false);
      expect(String(callback.mock.calls[0][0].text)).toContain('Failed to fetch node health: health failed');
    });
  });
});
