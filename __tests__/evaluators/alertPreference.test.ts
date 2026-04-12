import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { alertPreferenceEvaluator } from '../../src/plugins/nosana-ops/evaluators/alertPreference.ts';
import {
  extractAlertPreference,
  storeAlertPreference,
} from '../../src/plugins/nosana-ops/evaluators/alertPreferenceStore.ts';

jest.mock('../../src/plugins/nosana-ops/evaluators/alertPreferenceStore.ts', () => ({
  extractAlertPreference: jest.fn(),
  storeAlertPreference: jest.fn(),
}));

const extractAlertPreferenceMock = extractAlertPreference as unknown as jest.Mock;
const storeAlertPreferenceMock = storeAlertPreference as unknown as jest.Mock;

describe('alertPreferenceEvaluator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates true for alert-intent messages', async () => {
    const valid = await alertPreferenceEvaluator.validate(
      {} as any,
      { content: { text: 'alert me when any job fails' } } as any
    );

    expect(valid).toBe(true);
  });

  it('validates false for alert settings query', async () => {
    const valid = await alertPreferenceEvaluator.validate(
      {} as any,
      { content: { text: 'what are my alert settings' } } as any
    );

    expect(valid).toBe(false);
  });

  it('stores extracted preferences on handler execution', async () => {
    const runtime = { agentId: 'agent-1' } as any;
    const message = {
      id: 'msg-1',
      roomId: 'room-1',
      entityId: 'entity-1',
      content: { text: 'notify me on credit drop below 10%' },
    } as any;

    const pref = {
      event: 'credit_drop',
      threshold: '10%',
      channel: 'in-app',
      enabled: true,
      sourceText: message.content.text,
      updatedAt: new Date('2026-04-11T00:00:00.000Z').toISOString(),
    };

    extractAlertPreferenceMock.mockResolvedValue(pref);
    storeAlertPreferenceMock.mockResolvedValue(undefined);

    await alertPreferenceEvaluator.handler(runtime, message);

    expect(extractAlertPreferenceMock).toHaveBeenCalledWith(runtime, 'notify me on credit drop below 10%');
    expect(storeAlertPreferenceMock).toHaveBeenCalledWith(runtime, message, pref);
  });

  it('does nothing when message text is empty', async () => {
    await alertPreferenceEvaluator.handler({} as any, { content: { text: '' } } as any);

    expect(extractAlertPreferenceMock).not.toHaveBeenCalled();
    expect(storeAlertPreferenceMock).not.toHaveBeenCalled();
  });
});
