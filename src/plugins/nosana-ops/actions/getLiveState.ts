import { Action, type HandlerCallback, type IAgentRuntime, type Memory, type State } from '@elizaos/core';
import { getNosanaLiveStateSnapshot } from '../providers/nosanaContext.ts';

export const getLiveStateAction: Action = {
  name: 'GET_LIVE_STATE',
  description:
    'Return concise live Nosana state (timestamp, active/failed/queued jobs, credit balance, burn rate). Use this for "live state right now" requests.',
  similes: ['live state', 'current state', 'state right now', 'status right now', 'nosana state'],

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';
    return (
      (text.includes('live') && text.includes('state')) ||
      (text.includes('current') && text.includes('state')) ||
      text.includes('state right now') ||
      text.includes('status right now')
    );
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
    responses?: Memory[]
  ): Promise<void> => {
    try {
      const allActions = new Set(
        (responses || [])
          .flatMap((r: any) => (Array.isArray(r?.content?.actions) ? r.content.actions : []))
          .map((a: unknown) => String(a).toUpperCase())
      );
      const replyText = (responses || [])
        .map((r: any) => (typeof r?.content?.text === 'string' ? r.content.text : ''))
        .find((t) => t.length > 0) || '';
      const replyAlreadyHasLiveBlock =
        allActions.has('REPLY') &&
        (replyText.includes('[LIVE NOSANA STATE') || replyText.toLowerCase().includes('active jobs:'));

      // Avoid duplicate user output when REPLY already contains the live-state block.
      if (replyAlreadyHasLiveBlock) {
        return;
      }

      const snapshot = await getNosanaLiveStateSnapshot();
      if (callback) {
        await callback({
          text: snapshot.text || 'Live Nosana state is temporarily unavailable.',
        });
      }
      return;
    } catch (error: any) {
      if (callback) {
        await callback({
          text: `Failed to fetch live state: ${error?.message || String(error)}`,
        });
      }
      return;
    }
  },

  examples: [[
    { name: '{{name1}}', content: { text: 'what is my live nosana state right now?' } },
    {
      name: 'NosanaScope',
      content: {
        text:
          '[LIVE NOSANA STATE — 2026-04-07T12:00:00.000Z]\n' +
          'Active Jobs: 2\n' +
          'Failed Jobs: 0\n' +
          'Queued Jobs: 1\n' +
          'Credit Balance: 1,250\n' +
          'Burn Rate: ~0.45/hour',
      },
    },
  ]],
};
