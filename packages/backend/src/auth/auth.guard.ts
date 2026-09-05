import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { UsersService } from '../users/users.service';
import { SessionPayload, SessionService } from './session.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private sessionService: SessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync<SessionPayload>(token);
      const userId = typeof payload?.sub === 'string' ? payload.sub : null;
      const sessionId = typeof payload?.sid === 'string' ? payload.sid : null;
      if (!userId) {
        throw new UnauthorizedException();
      }

      const sessionIsActive = sessionId
        ? await this.sessionService.isAccessSessionActive(sessionId, userId)
        : this.sessionService.isLegacyTokenAllowed(payload);
      if (!sessionIsActive || !(await this.usersService.userExists(userId))) {
        throw new UnauthorizedException();
      }
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException();
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
