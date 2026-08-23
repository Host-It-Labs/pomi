import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackService } from '../../src/feedback/feedback.service';
import { GitHubAppTokenService } from '../../src/feedback/github-app-token.service';

describe('FeedbackService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_FEEDBACK_REPOSITORY;
    delete process.env.GITHUB_FEEDBACK_LABEL;
  });

  it('creates a GitHub issue with only feedback and bounded safe diagnostics', async () => {
    process.env.GITHUB_FEEDBACK_REPOSITORY = 'community/pomi-feedback';
    const githubAppTokenService = {
      getToken: vi.fn().mockResolvedValue('installation-token'),
    } as unknown as GitHubAppTokenService;
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

    const result = await new FeedbackService(githubAppTokenService).submit(
      'The dock is useful.',
      {
        platform: 'android',
        viewport: '412x915',
      }
    );

    expect(result.issueNumber).toBe(42);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer installation-token',
    });
    const body = JSON.parse(String(request.body));
    expect(body.title).toBe('[Feedback] The dock is useful.');
    expect(body.body).toContain('- platform: android');
    expect(body.body).toContain('- viewport: 412x915');
    expect(body.body).not.toContain('username');
    expect(body.body).not.toContain('task');
  });

  it('fails clearly when GitHub submission is not configured', async () => {
    process.env.GITHUB_FEEDBACK_REPOSITORY = 'community/pomi-feedback';
    await expect(
      new FeedbackService(new GitHubAppTokenService()).submit('Feedback')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('translates issue-creation transport failures', async () => {
    process.env.GITHUB_FEEDBACK_REPOSITORY = 'community/pomi-feedback';
    const githubAppTokenService = {
      getToken: vi.fn().mockResolvedValue('installation-token'),
    } as unknown as GitHubAppTokenService;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(
      new FeedbackService(githubAppTokenService).submit('Feedback')
    ).rejects.toEqual(
      new BadGatewayException('GitHub feedback submission is unavailable')
    );
  });
});
