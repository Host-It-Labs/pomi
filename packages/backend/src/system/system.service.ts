import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemInfo } from '@pomi/shared';

export type HostingMode = 'hosted' | 'self-hosted';

export function resolveHostingMode(rawMode?: string): HostingMode {
  return rawMode?.toLowerCase().trim() === 'hosted' ? 'hosted' : 'self-hosted';
}

@Injectable()
export class SystemService {
  constructor(private configService: ConfigService) {}

  getHostingMode(): HostingMode {
    return resolveHostingMode(
      this.configService.get<string>('POMI_HOSTING_MODE')
    );
  }

  isSelfHosted(): boolean {
    return this.getHostingMode() === 'self-hosted';
  }

  getSystemInfo(): SystemInfo {
    const hosted = !this.isSelfHosted();
    return {
      hostingMode: this.getHostingMode(),
      selfHosted: this.isSelfHosted(),
      paymentsRequired: hosted,
      authProviders: {
        google: hosted && this.hasCsvValue('GOOGLE_AUTH_CLIENT_IDS'),
        apple: hosted && this.hasCsvValue('APPLE_AUTH_CLIENT_IDS'),
      },
    };
  }

  private hasCsvValue(key: string): boolean {
    return (this.configService.get<string>(key) ?? '')
      .split(',')
      .some(value => value.trim().length > 0);
  }
}
