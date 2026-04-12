import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createNosanaClient } from '@nosana/kit';

import { getNosanaLiveStateSnapshot } from '../../src/plugins/nosana-ops/providers/nosanaContext.ts';

jest.mock('@nosana/kit', () => ({
  createNosanaClient: jest.fn(),
}));

jest.mock('@elizaos/core', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const createNosanaClientMock = createNosanaClient as unknown as jest.Mock;
let mockedNow = new Date('2026-04-11T00:00:00.000Z').getTime();

describe('nosanaContextProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedNow += 60_000;
    jest.useFakeTimers();
    jest.setSystemTime(mockedNow);
    process.env.NOSANA_API_KEY = 'nosana-key';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns unavailable state when API key is missing', async () => {
    delete process.env.NOSANA_API_KEY;

    const result = await getNosanaLiveStateSnapshot();

    expect(result.text).toContain('API key missing');
    expect(result.data).toEqual(expect.objectContaining({ unavailable: true, reason: 'missing_api_key' }));
  });

  it('builds live state and serves cached value for 30 seconds', async () => {
    createNosanaClientMock.mockReturnValue({
      api: {
        deployments: {
          list: jest.fn().mockResolvedValue({
            deployments: [
              { status: 'RUNNING', active_jobs: 2, replicas: 2, market: 'market-1' },
              { status: 'ERROR', active_jobs: 1, replicas: 1, market: 'market-1' },
              { status: 'DRAFT', active_jobs: 0, replicas: 2, market: 'market-2' },
            ],
          }),
        },
        credits: {
          balance: jest.fn().mockResolvedValue({
            assignedCredits: 1000,
            reservedCredits: 100,
            settledCredits: 50,
          }),
        },
        markets: {
          list: jest.fn().mockResolvedValue([
            { address: 'market-1', nos_job_price_per_second: 0.01 },
            { address: 'market-2', nos_job_price_per_second: 0.005 },
          ]),
        },
      },
    });

    const first = await getNosanaLiveStateSnapshot();
    const second = await getNosanaLiveStateSnapshot();

    expect(createNosanaClientMock).toHaveBeenCalledTimes(1);
    expect(first.text).toContain('Active Jobs: 2');
    expect(first.text).toContain('Failed Jobs: 1');
    expect(first.text).toContain('Queued Jobs: 2');
    expect(first.text).toContain('Credit Balance: 850');
    expect(first.text).toContain('Burn Rate: ~72/hour');
    expect(second.text).toBe(first.text);
  });

  it('returns temporary fallback when SDK calls fail', async () => {
    createNosanaClientMock.mockReturnValue({
      api: {
        deployments: {
          list: jest.fn().mockRejectedValue(new Error('provider failed')),
        },
        credits: {
          balance: jest.fn(),
        },
        markets: {
          list: jest.fn(),
        },
      },
    });

    const result = await getNosanaLiveStateSnapshot();

    expect(result.text).toContain('State temporarily unavailable');
    expect(result.values).toEqual(expect.objectContaining({ nosanaLiveState: 'unavailable' }));
    expect(result.data).toEqual(expect.objectContaining({ unavailable: true }));
  });
});
