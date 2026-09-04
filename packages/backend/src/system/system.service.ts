import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemInfo } from '@pomi/shared';
import { UsersService } from '../users/users.service';

export type HostingMode = 'hosted' | 'self-hosted';

@Injectable()
export class SystemService {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService
  ) {}

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

  async getSystemInfo(): Promise<SystemInfo> {
    const requiresAdminBootstrapToken =
      this.isSelfHosted() && (await this.usersService.countAdmins()) === 0;
    return {
      hostingMode: this.getHostingMode(),
      selfHosted: this.isSelfHosted(),
      requiresAdminBootstrapToken,
    };
  }
}
