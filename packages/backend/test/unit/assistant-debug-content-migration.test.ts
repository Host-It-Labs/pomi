import { describe, expect, it } from 'vitest';
import { ScrubAssistantDebugContent1774467700000 } from '../../migrations/1774467700000-scrubAssistantDebugContent';

describe('ScrubAssistantDebugContent migration', () => {
  it('scrubs every persisted content field, including flagged rows', async () => {
    const queries: string[] = [];
    await new ScrubAssistantDebugContent1774467700000().up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toMatch(/UPDATE "assistant_debug_logs"/);
    expect(sql).toMatch(/"userPrompt" = NULL/);
    expect(sql).toMatch(/"processedOutput" = NULL/);
    expect(sql).toMatch(/"invalidParserOutput" = NULL/);
    expect(sql).toMatch(/"resolutionNotes" = '\[\]'::jsonb/);
    expect(sql).toMatch(/"modelCalls" = '\[\]'::jsonb/);
    expect(sql).toMatch(/"error" = NULL/);
    expect(sql).not.toMatch(/WHERE/);
  });
});
