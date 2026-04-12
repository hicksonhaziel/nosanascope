import { Action, type HandlerCallback, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { getLatestAlertPreference } from '../evaluators/alertPreferenceStore.ts';

/**
 * Action definition for showing persisted alert preferences to the user.
 *
 * @param runtime - Active Eliza runtime handling the request.
 * @param message - User message used to validate alert settings intent.
 * @returns Action object whose handler returns saved alert preference text.
 * @example
 * User: "what are my alert settings?"
 */
export const getAlertSettingsAction: Action = {
  name: 'GET_ALERT_SETTINGS',
  description: 'Show saved alert preferences learned from conversation memory',
  similes: ['alert settings', 'my alerts', 'notification settings', 'alert preferences'],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return (
      text.includes('alert settings') ||
      text.includes('my alert settings') ||
      text.includes('alert preference') ||
      text.includes('notification settings') ||
      text.includes('what are my alerts')
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
      const preference = await getLatestAlertPreference(runtime, {
        roomId: message.roomId,
        entityId: message.entityId,
      });

      if (!preference) {
        if (callback) await callback({ text: 'No alert preferences saved yet.' });
        return;
      }

      const response =
        `🔔 Alert Settings:\n` +
        `▸ Event: ${preference.event}\n` +
        `▸ Threshold: ${preference.threshold || 'default'}\n` +
        `▸ Channel: ${preference.channel}\n` +
        `▸ Enabled: ${preference.enabled ? 'yes' : 'no'}\n` +
        `▸ Updated: ${preference.updatedAt}`;

      if (callback) await callback({ text: response });
      return;
    } catch (error: any) {
      if (callback) await callback({ text: `Failed to load alert settings: ${error.message}` });
      return;
    }
  },

  examples: [[
    { name: '{{name1}}', content: { text: 'what are my alert settings?' } },
    { name: 'NosanaScope', content: { text: '🔔 Alert Settings: Event job_failure, Channel telegram' } },
  ]],
};

export default getAlertSettingsAction;
