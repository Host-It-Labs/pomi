import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemInfo } from '@pomi/shared';

export type HostingMode = 'hosted' | 'self-hosted';

@Injectable()
export class SystemService {
  constructor(private configService: ConfigService) {}

  getHostingMode(): HostingMode {
    const rawMode = this.configService.get<string>('POMI_HOSTING_MODE');
    const normalized = rawMode ? rawMode.toLowerCase().trim() : '';

    if (normalized === 'hosted') {
      return 'hosted';
    }

    return 'self-hosted';
  }

  isSelfHosted(): boolean {
    return this.getHostingMode() === 'self-hosted';
  }

  getSystemInfo(): SystemInfo {
    return {
      hostingMode: this.getHostingMode(),
      selfHosted: this.isSelfHosted(),
    };
  }
}
