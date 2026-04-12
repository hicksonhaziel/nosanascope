import { Plugin } from '@elizaos/core';
import { getJobsAction } from './actions/getJobs.ts';
import { getCreditsAction } from './actions/getCredits.ts';
import { getAlertSettingsAction } from './actions/getAlertSettings.ts';
import { getLiveStateAction } from './actions/getLiveState.ts';
import { getMetricsAction } from './actions/getMetrics.ts';
import { cancelJobAction } from './actions/cancelJob.ts';
import { restartJobAction } from './actions/restartJob.ts';
import { spawnJobAction } from './actions/spawnJob.ts';
import { getNodeHealthAction } from './actions/getNodeHealth.ts';
import { nosanaContextProvider } from './providers/nosanaContext.ts';
import { alertPreferenceEvaluator } from './evaluators/alertPreference.ts';
import { failurePatternEvaluator } from './evaluators/failurePattern.ts';
import { MetricsPollerService } from './services/metricsPoller.ts';

export const nosanaOpsPlugin: Plugin = {
  name: '@nosanascope/plugin-nosana-ops',
  description: 'Nosana GPU infrastructure management',
  actions: [
    getJobsAction,
    getCreditsAction,
    getAlertSettingsAction,
    getLiveStateAction,
    getMetricsAction,
    cancelJobAction,
    restartJobAction,
    spawnJobAction,
    getNodeHealthAction,
  ],
  providers: [nosanaContextProvider],
  evaluators: [alertPreferenceEvaluator, failurePatternEvaluator],
  services: [MetricsPollerService],
};

export default nosanaOpsPlugin;
