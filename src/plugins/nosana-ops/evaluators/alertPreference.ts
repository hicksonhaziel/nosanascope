import { type Evaluator, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { extractAlertPreference, storeAlertPreference } from './alertPreferenceStore.ts';

const DEBUG_EVALUATORS = process.env.NOSANA_DEBUG_EVALUATORS?.toLowerCase() === 'true';

function isAlertPreferenceIntent(text: string): boolean {
  return (
    /alert me/i.test(text) ||
    /notify me/i.test(text) ||
    /warn me/i.test(text) ||
    /ping me/i.test(text) ||
    (/when/i.test(text) && /(fail|credit|latency|threshold)/i.test(text)) ||
    /threshold/i.test(text)
  );
}

/**
 * Evaluator definition that extracts alert preferences from conversational instructions.
 *
 * @param runtime - Active Eliza runtime used for model extraction and persistence.
 * @param message - Current conversation message inspected for alert intent.
 * @returns Evaluator object that stores normalized alert preferences in memory/logs.
 * @example
 * User: "alert me when any job fails and send to telegram"
 */
export const alertPreferenceEvaluator: Evaluator = {
  name: 'ALERT_PREFERENCE_EVALUATOR',
  description: 'Extracts and persists user alert preferences from conversation',
  similes: ['alert preference', 'notification rule', 'alert threshold'],
  examples: [
    {
      prompt: 'alert me when any job fails',
      messages: [{ name: '{{user1}}', content: { text: 'alert me when any job fails' } }],
      outcome: 'Stores preference with event=job_failure',
    },
  ],
  validate: async (_runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const text = message.content?.text || '';
    if (!text) return false;
    if (/what are my alert settings/i.test(text)) return false;
    return isAlertPreferenceIntent(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory
  ): Promise<void> => {
    const text = String(message.content?.text || '').trim();
    if (!text) return;

    const preference = await extractAlertPreference(runtime, text);
    await storeAlertPreference(runtime, message, preference);

    if (DEBUG_EVALUATORS) {
      console.debug('[alertPreferenceEvaluator] stored:', preference);
    }
  },
};

export default alertPreferenceEvaluator;
