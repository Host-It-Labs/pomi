import { describe, expect, it } from 'vitest';
import { AddIntentionAllowsTasks1774467500000 } from '../../migrations/1774467500000-addIntentionAllowsTasks';

describe('AddIntentionAllowsTasks migration', () => {
  it('defaults existing and new Intentions to allowing linked Tasks', async () => {
    const statements: string[] = [];
    await new AddIntentionAllowsTasks1774467500000().up({
      query: async (statement: string) => {
        statements.push(statement);
      },
    } as never);

    expect(statements).toEqual([
      'ALTER TABLE "intentions" ADD COLUMN IF NOT EXISTS "allowsTasks" boolean NOT NULL DEFAULT true',
    ]);
  });
});
