import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { BillingService } from '../billing/billing.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    @Optional() private billing?: BillingService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    let payload: { sub?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }

    if (!payload?.sub || !(await this.usersService.userExists(payload.sub))) {
      throw new UnauthorizedException();
    }
    await this.enforceHostedEntitlement(request, payload.sub);
    request['user'] = payload;

    return true;
  }

  private async enforceHostedEntitlement(request: Request, userId: string) {
    if (
      request.path === '/billing/entitlement' ||
      request.path === '/billing/entitlement/sync' ||
      request.path === '/billing/entitlement/claim' ||
      request.path === '/sessions/current'
    ) {
      return;
    }
    if (this.billing && !(await this.billing.hasProductAccess(userId))) {
      throw new HttpException('An active Pomi subscription is required', 402);
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
