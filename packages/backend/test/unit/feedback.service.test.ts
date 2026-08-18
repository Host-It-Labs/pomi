import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackService } from '../../src/feedback/feedback.service';

describe('FeedbackService', () => {
  const originalToken = process.env.GITHUB_FEEDBACK_TOKEN;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.GITHUB_FEEDBACK_TOKEN;
    else process.env.GITHUB_FEEDBACK_TOKEN = originalToken;
    delete process.env.GITHUB_FEEDBACK_REPOSITORY;
    delete process.env.GITHUB_FEEDBACK_LABEL;
  });

  it('creates a GitHub issue with only feedback and bounded safe diagnostics', async () => {
    process.env.GITHUB_FEEDBACK_TOKEN = 'test-token';
    process.env.GITHUB_FEEDBACK_REPOSITORY = 'community/pomi-feedback';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ number: 42, html_url: 'https://example.test/42' }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FeedbackService().submit('The dock is useful.', {
      platform: 'android',
      viewport: '412x915',
    });

    expect(result.issueNumber).toBe(42);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.title).toBe('[Feedback] The dock is useful.');
    expect(body.body).toContain('- platform: android');
    expect(body.body).toContain('- viewport: 412x915');
    expect(body.body).not.toContain('username');
    expect(body.body).not.toContain('task');
  });

  it('fails clearly when GitHub submission is not configured', async () => {
    delete process.env.GITHUB_FEEDBACK_TOKEN;
    await expect(
      new FeedbackService().submit('Feedback')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
