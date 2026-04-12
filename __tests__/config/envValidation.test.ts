import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  getRequiredNosanaApiKey,
  validateNosanaOpsStartupEnv,
} from '../../src/plugins/nosana-ops/config/envValidation.ts';

jest.mock('@elizaos/core', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const ORIGINAL_ENV = { ...process.env };

function setValidEnv(): void {
  process.env.NOSANA_API_KEY = 'nos_test_key';
  process.env.NOSANA_JOB_TEMPLATE = JSON.stringify({
    name: 'template-a',
    market: 'market-1',
    strategy: 'random',
    replicas: 1,
    timeout: 60,
    job_definition: { ops: [] },
  });
}

describe('envValidation', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
  });

  it('throws when required env variables are missing', () => {
    delete process.env.NOSANA_API_KEY;
    delete process.env.NOSANA_JOB_TEMPLATE;

    expect(() => validateNosanaOpsStartupEnv()).toThrow(
      'Missing required environment variables: NOSANA_API_KEY, NOSANA_JOB_TEMPLATE'
    );
  });

  it('throws when job template is invalid JSON', () => {
    process.env.NOSANA_API_KEY = 'nos_test_key';
    process.env.NOSANA_JOB_TEMPLATE = '{bad json';

    expect(() => validateNosanaOpsStartupEnv()).toThrow('NOSANA_JOB_TEMPLATE must be valid JSON');
  });

  it('passes with valid required env values', () => {
    setValidEnv();

    expect(() => validateNosanaOpsStartupEnv()).not.toThrow();
  });

  it('returns API key and throws when absent', () => {
    process.env.NOSANA_API_KEY = 'nos_valid_key';
    expect(getRequiredNosanaApiKey()).toBe('nos_valid_key');

    delete process.env.NOSANA_API_KEY;
    expect(() => getRequiredNosanaApiKey()).toThrow('NOSANA_API_KEY is not set');
  });
});
