import { describe, expect, it } from 'vitest';
import { AdminCaptureLogConsent1789191000000 } from '../../migrations/1789191000000-adminCaptureLogConsent';

describe('AdminCaptureLogConsent migration', () => {
  it('requires fresh consent and bounds historical flagged diagnostics', async () => {
    const queries: string[] = [];
    await new AdminCaptureLogConsent1789191000000().up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toMatch(/ADD "consentVersion" integer/);
    expect(sql).toMatch(/ADD "generation" integer NOT NULL DEFAULT 0/);
    expect(sql).toMatch(
      /ADD "contentTruncated" boolean NOT NULL DEFAULT false/
    );
    expect(sql).toMatch(/SET "enabled" = false/);
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER/);
    expect(sql).toMatch(/WHERE "flagRank" > 200/);
    expect(sql).toMatch(/WHERE "flagged" = true/);
  });
});
