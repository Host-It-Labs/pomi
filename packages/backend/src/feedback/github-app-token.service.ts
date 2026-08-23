import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

type InstallationToken = {
  token?: string;
  expires_at?: string;
};

@Injectable()
export class GitHubAppTokenService {
  private cachedToken?: { value: string; expiresAt: number };
  private pendingToken?: Promise<string>;

  async getToken() {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 300_000) {
      return this.cachedToken.value;
    }
    if (this.pendingToken) return this.pendingToken;

    this.pendingToken = this.createInstallationToken();
    try {
      return await this.pendingToken;
    } finally {
      this.pendingToken = undefined;
    }
  }

  private async createInstallationToken() {
    const appId = process.env.GITHUB_FEEDBACK_APP_ID?.trim();
    const installationId =
      process.env.GITHUB_FEEDBACK_APP_INSTALLATION_ID?.trim();
    const privateKeyPath =
      process.env.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH?.trim();
    if (!appId && !installationId) {
      throw new ServiceUnavailableException(
        'Feedback submission is not configured'
      );
    }
    if (
      !appId ||
      !installationId ||
      !privateKeyPath ||
      !/^\d+$/.test(appId) ||
      !/^\d+$/.test(installationId)
    ) {
      throw new ServiceUnavailableException(
        'Feedback GitHub App configuration is invalid'
      );
    }

    let privateKey: string;
    try {
      privateKey = readFileSync(privateKeyPath, 'utf8');
    } catch {
      throw new ServiceUnavailableException(
        'Feedback GitHub App private key is unavailable'
      );
    }

    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.createJwt(appId, privateKey)}`,
          'Content-Type': 'application/json',
          'User-Agent': 'pomi-feedback',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!response.ok) {
      throw new BadGatewayException(
        'GitHub did not authenticate the feedback application'
      );
    }

    const result = (await response.json()) as InstallationToken;
    const expiresAt = Date.parse(result.expires_at ?? '');
    if (!result.token || !Number.isFinite(expiresAt)) {
      throw new BadGatewayException(
        'GitHub returned invalid feedback application credentials'
      );
    }
    this.cachedToken = { value: result.token, expiresAt };
    return result.token;
  }

  private createJwt(appId: string, privateKey: string) {
    const timestamp = Math.floor(Date.now() / 1000);
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iat: timestamp - 60,
      exp: timestamp + 540,
      iss: appId,
    })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
  }
}
