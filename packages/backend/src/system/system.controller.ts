import { Body, Controller, Get, Request, UseGuards } from '@nestjs/common';
import { apiContract, type UserDataExport } from '@pomi/shared';
import * as Sentry from '@sentry/nestjs';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Request as ExpressRequest } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { DebugGuard } from '../auth/debug.guard';
import { SystemService } from './system.service';
import { UserDataTransferService } from './user-data-transfer.service';

@Controller()
export class SystemController {
  constructor(
    private systemService: SystemService,
    private userDataTransferService: UserDataTransferService
  ) {}

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @TsRestHandler(apiContract.system.get)
  async getInfo(): Promise<unknown> {
    return tsRestHandler(apiContract.system.get, async () => {
      const info = await this.systemService.getSystemInfo();
      return {
        status: 200,
        body: info,
      };
    });
  }

  @UseGuards(AuthGuard, DebugGuard)
  @TsRestHandler(apiContract.system.debugSentry)
  async debugSentry(@Request() request: ExpressRequest): Promise<unknown> {
    return tsRestHandler(apiContract.system.debugSentry, async () => {
      const userId = request['user']?.sub as string | undefined;

      Sentry.withScope(scope => {
        scope.setLevel('error');
        if (userId) {
          scope.setUser({ id: userId });
        }
        scope.setTag('source', 'debug-panel');
        Sentry.captureException(
          new Error('Debug panel backend Sentry test error')
        );
      });

      return {
        status: 200,
        body: { success: true },
      };
    });
  }

  @UseGuards(AuthGuard, AdminGuard)
  @TsRestHandler(apiContract.system.exportUserData)
  async exportUserData(@Request() request: ExpressRequest): Promise<unknown> {
    return tsRestHandler(apiContract.system.exportUserData, async () => {
      const userId = request['user'].sub;
      const exportPayload =
        await this.userDataTransferService.exportUserData(userId);

      return {
        status: 200,
        body: exportPayload,
      };
    });
  }

  @UseGuards(AuthGuard, AdminGuard)
  @TsRestHandler(apiContract.system.importUserData)
  async importUserData(
    @Request() request: ExpressRequest,
    @Body() body: UserDataExport
  ): Promise<unknown> {
    return tsRestHandler(apiContract.system.importUserData, async () => {
      const userId = request['user'].sub;
      const result = await this.userDataTransferService.importUserData(
        userId,
        body
      );

      return {
        status: 200,
        body: result,
      };
    });
  }
}
