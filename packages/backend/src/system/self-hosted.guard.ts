import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SystemService } from './system.service';

@Injectable()
export class SelfHostedGuard implements CanActivate {
  constructor(private systemService: SystemService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.systemService.isSelfHosted()) {
      throw new ForbiddenException('Self-hosted environment required');
    }

    return true;
  }
}
