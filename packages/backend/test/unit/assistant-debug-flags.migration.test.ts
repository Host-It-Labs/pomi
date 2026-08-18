import { describe, expect, it } from 'vitest';
import { AddAssistantDebugFlagsAndModelCalls1774429000000 } from '../../migrations/1774429000000-addAssistantDebugFlagsAndModelCalls';

describe('AddAssistantDebugFlagsAndModelCalls migration', () => {
  it('adds persistent flags and complete model-call traces to AI debug logs', async () => {
    const queries: string[] = [];
    await new AddAssistantDebugFlagsAndModelCalls1774429000000().up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    const allQueries = queries.join('\n');
    expect(allQueries).toMatch(
      /ADD "modelCalls" jsonb NOT NULL DEFAULT '\[\]'::jsonb/
    );
    expect(allQueries).toMatch(/ADD "flagged" boolean NOT NULL DEFAULT false/);
  });
});
