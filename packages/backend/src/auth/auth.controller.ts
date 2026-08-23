import {
  Body,
  Controller,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Request } from 'express';
import { UsersService } from '../users/users.service';
import { TimerService } from '../timer/timer.service';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthenticateDto } from './dto/authenticate.dto';
import { LogoutDto } from './dto/logout.dto';
import { SocialAuthDto } from './dto/social-auth.dto';
import { SocialTokenService } from './social-token.service';

@Controller()
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private timerService: TimerService,
    private socialTokens: SocialTokenService
  ) {}

  @TsRestHandler(apiContract.sessions.create)
  async authenticate(@Body() body: AuthenticateDto): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.create, async () => {
      const result = await this.authService.authenticateUser(
        body.username,
        body.password,
        body.language
      );
      const createdAt = result.user.createdAt;
      const user = {
        ...result.user,
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : String(createdAt),
      };

      return {
        status: 200,
        body: {
          ...result,
          user,
        },
      };
    });
  }

  @TsRestHandler(apiContract.sessions.socialChallenge)
  async socialChallenge(): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.socialChallenge, async () => ({
      status: 201,
      body: await this.socialTokens.createChallenge(),
    }));
  }

  @TsRestHandler(apiContract.sessions.createSocial)
  async authenticateSocial(@Body() body: SocialAuthDto): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.createSocial, async () => {
      const result = await this.authService.authenticateSocial(body);
      const createdAt = result.user.createdAt;
      return {
        status: 200,
        body: {
          ...result,
          user: {
            ...result.user,
            createdAt:
              createdAt instanceof Date
                ? createdAt.toISOString()
                : String(createdAt),
          },
        },
      };
    });
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.sessions.deleteCurrent)
  async logout(
    @Req() request: Request,
    @Query() query: LogoutDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.sessions.deleteCurrent, async () => {
      const userId = request['user']?.sub;
      if (!userId) {
        throw new UnauthorizedException();
      }

      if (query.platform === 'android' || query.platform === 'ios') {
        await this.usersService.clearPushToken(
          userId,
          query.platform,
          query.token
        );
      }
      await this.timerService.clearTimerHistory(userId);

      return {
        status: 200,
        body: { success: true },
      };
    });
  }
}
