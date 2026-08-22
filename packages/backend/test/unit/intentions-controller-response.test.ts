import { describe, expect, it } from 'vitest';
import { IntentionsController } from '../../src/intentions/intentions.controller';

describe('Intention responses', () => {
  it('normalizes description and Vacation fields from legacy rows', () => {
    const controller = new IntentionsController({} as never);
    const formatted = (
      controller as unknown as {
        formatIntention(
          intention: Record<string, unknown>
        ): Record<string, unknown>;
      }
    ).formatIntention({
      id: 'intention-1',
      parentIntentionId: undefined,
      parentIntention: undefined,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    });

    expect(formatted).toMatchObject({
      description: null,
      vacationDefault: false,
      parentIntentionId: null,
      parentIntention: null,
    });
  });
});
