import {
  Body,
  Controller,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Request, Response } from 'express';
import { UsersService } from '../users/users.service';
import { TimerService } from '../timer/timer.service';
import { AuthGuard } from './auth.guard';
import { AuthRateLimitException } from './auth-rate-limit.exception';
import { AuthService } from './auth.service';
import {
  clearRefreshTokenCookie,
  getRefreshTokenCookieValue,
  setRefreshTokenCookieValue,
} from './auth-cookie';
import { AuthenticateDto } from './dto/authenticate.dto';
import { LogoutDto } from './dto/logout.dto';
import { MigrateSessionDto } from './dto/migrate-session.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { SessionService } from './session.service';

@Controller()
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private timerService: TimerService,
    private sessionService: SessionService
  ) {}

  @TsRestHandler(apiContract.sessions.create)
  async authenticate(
    @Body() body: AuthenticateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.create, async () => {
      let result;
      try {
        result = await this.authService.authenticateUser(
          body.username,
          body.password,
          request.ip || request.socket.remoteAddress || 'unknown',
          body.language,
          {
            platform: body.platform,
            deviceId: body.deviceId,
            bootstrapToken: body.bootstrapToken,
          }
        );
      } catch (error) {
        if (error instanceof AuthRateLimitException) {
          response.setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        throw error;
      }
      return this.sessionResponse(result, request, response, body.platform);
    });
  }

  @TsRestHandler(apiContract.sessions.refresh)
  async refresh(
    @Body() body: RefreshSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.refresh, async () => {
      const platform = body.platform ?? 'web';
      const refreshToken =
        platform === 'web'
          ? this.readRefreshTokenCookie(request)
          : body.refreshToken;
      if (!refreshToken) {
        throw new UnauthorizedException('Invalid session');
      }

      const result = await this.authService.refreshSession(refreshToken, {
        platform,
      });
      return this.sessionResponse(result, request, response, platform);
    });
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.sessions.migrate)
  async migrate(
    @Body() body: MigrateSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.migrate, async () => {
      const userId = request['user']?.sub;
      if (typeof userId !== 'string') {
        throw new UnauthorizedException();
      }
      const user = await this.usersService.findUserById(userId);
      if (!user) {
        throw new UnauthorizedException();
      }

      const platform = body.platform ?? 'web';
      const result = await this.authService.createSessionForUser(user, {
        platform,
      });
      return this.sessionResponse(result, request, response, platform);
    });
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.sessions.deleteCurrent)
  async logout(
    @Req() request: Request,
    @Query() query: LogoutDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.deleteCurrent, async () => {
      const userId = request['user']?.sub;
      if (!userId) {
        throw new UnauthorizedException();
      }

      const sessionId = request['user']?.sid;
      if (typeof sessionId === 'string' && typeof userId === 'string') {
        await this.sessionService.revokeAccessSession(sessionId, userId);
      }
      const refreshToken = this.readRefreshTokenCookie(request);
      if (refreshToken) {
        await this.sessionService.revokeRefreshSession(refreshToken);
      }
      clearRefreshTokenCookie(response, request);

      if (query.platform === 'android' || query.platform === 'ios') {
        await this.usersService.clearPushToken(userId, query.platform);
      }
      await this.timerService.clearTimerHistory(userId);

      return {
        status: 200,
        body: { success: true },
      };
    });
  }

  private sessionResponse(
    result: any,
    request: Request,
    response: Response,
    platform?: string
  ) {
    const createdAt = result.user.createdAt;
    const user = {
      ...result.user,
      createdAt:
        createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    };
    const sessionBody = {
      ...result,
      user,
    };

    if ((platform ?? 'web') === 'web') {
      setRefreshTokenCookieValue(
        response,
        request,
        this.sessionService.protectRefreshCookie(result.refreshToken)
      );
      delete sessionBody.refreshToken;
    }

    return {
      status: 200 as const,
      body: sessionBody,
    };
  }

  private readRefreshTokenCookie(request: Request): string | undefined {
    const value = getRefreshTokenCookieValue(request);
    if (!value) return undefined;
    return this.sessionService.readProtectedRefreshCookie(value) ?? undefined;
  }
}
