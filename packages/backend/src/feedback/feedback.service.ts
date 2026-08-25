import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GitHubAppTokenService } from './github-app-token.service';

type FeedbackDiagnostics = {
  appVersion?: string;
  platform?: string;
  path?: string;
  viewport?: string;
};

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9._-])?$/;

function githubIssuesUrl(repository: string) {
  const parts = repository.split('/');
  if (
    parts.length !== 2 ||
    !GITHUB_OWNER_PATTERN.test(parts[0]) ||
    !GITHUB_REPOSITORY_PATTERN.test(parts[1])
  ) {
    throw new ServiceUnavailableException('Feedback repository is invalid');
  }

  const url = new URL(GITHUB_API_ORIGIN);
  url.pathname = ['repos', parts[0], parts[1], 'issues'].join('/');
  if (url.origin !== GITHUB_API_ORIGIN) {
    throw new ServiceUnavailableException('Feedback repository is invalid');
  }
  return url;
}

@Injectable()
export class FeedbackService {
  constructor(private readonly githubAppTokenService: GitHubAppTokenService) {}

  async submit(text: string, diagnostics?: FeedbackDiagnostics) {
    const repository = process.env.GITHUB_FEEDBACK_REPOSITORY?.trim();
    if (!repository) {
      throw new ServiceUnavailableException(
        'Feedback submission is not configured'
      );
    }
    const issuesUrl = githubIssuesUrl(repository);
    const feedback = text.trim();
    if (!feedback) throw new BadRequestException('Feedback is required');
    const token = await this.githubAppTokenService.getToken();

    const diagnosticsLines = Object.entries(diagnostics ?? {})
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([key, value]) => `- ${key}: ${value}`);
    const body = [
      feedback,
      '',
      '---',
      'Submitted from Pomi feedback.',
      ...(diagnosticsLines.length
        ? ['', 'Safe diagnostics:', ...diagnosticsLines]
        : []),
    ].join('\n');
    const label = process.env.GITHUB_FEEDBACK_LABEL?.trim() || 'feedback';
    let response: Response;
    try {
      // codeql[js/request-forgery] -- githubIssuesUrl fixes and rechecks the API origin after validating both path segments.
      response = await fetch(issuesUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'pomi-feedback',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          title: this.title(feedback),
          body,
          ...(label ? { labels: [label] } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadGatewayException(
        'GitHub feedback submission is unavailable'
      );
    }
    if (!response.ok) {
      throw new BadGatewayException('GitHub did not accept the feedback');
    }
    const issue = (await response.json()) as {
      number?: number;
      html_url?: string;
    };
    return {
      issueNumber: issue.number ?? null,
      issueUrl: issue.html_url ?? null,
    };
  }

  private title(text: string) {
    const firstLine = text.split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim();
    const shortened =
      firstLine.length > 90 ? `${firstLine.slice(0, 87)}...` : firstLine;
    return `[Feedback] ${shortened || 'Pomi feedback'}`;
  }
}
