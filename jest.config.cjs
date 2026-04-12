/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.ts$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.jest.json',
        diagnostics: false,
      },
    ],
  },
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage/jest',
  collectCoverageFrom: [
    'src/plugins/nosana-ops/actions/getJobs.ts',
    'src/plugins/nosana-ops/actions/getCredits.ts',
    'src/plugins/nosana-ops/actions/getMetrics.ts',
    'src/plugins/nosana-ops/actions/cancelJob.ts',
    'src/plugins/nosana-ops/actions/restartJob.ts',
    'src/plugins/nosana-ops/actions/spawnJob.ts',
    'src/plugins/nosana-ops/actions/getNodeHealth.ts',
    'src/plugins/nosana-ops/providers/nosanaContext.ts',
    'src/plugins/nosana-ops/evaluators/alertPreference.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 40,
      functions: 80,
      lines: 80,
    },
  },
};
