import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

type FeedbackDiagnostics = {
  appVersion?: string;
  platform?: string;
  path?: string;
  viewport?: string;
};

@Injectable()
export class FeedbackService {
  async submit(text: string, diagnostics?: FeedbackDiagnostics) {
    const token = process.env.GITHUB_FEEDBACK_TOKEN?.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        'Feedback submission is not configured'
      );
    }
    const repository = process.env.GITHUB_FEEDBACK_REPOSITORY?.trim();
    if (!repository) {
      throw new ServiceUnavailableException(
        'Feedback submission is not configured'
      );
    }
    if (!/^[^/]+\/[^/]+$/.test(repository)) {
      throw new ServiceUnavailableException('Feedback repository is invalid');
    }
    const feedback = text.trim();
    if (!feedback) throw new BadRequestException('Feedback is required');

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
    const response = await fetch(
      `https://api.github.com/repos/${repository}/issues`,
      {
        method: 'POST',
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
      }
    );
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
