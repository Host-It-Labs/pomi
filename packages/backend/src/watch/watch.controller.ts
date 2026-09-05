import { Controller, Query, Request, UseGuards } from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import {
  TsRestHandler,
  tsRestHandler,
} from '../validation/ts-rest-zod4.adapter';
import { AuthGuard } from '../auth/auth.guard';
import { WatchStatusQueryDto } from './dto/watch-status-query.dto';
import { WatchService } from './watch.service';

@Controller()
@UseGuards(AuthGuard)
export class WatchController {
  constructor(private readonly watchService: WatchService) {}

  @TsRestHandler(apiContract.watch.status)
  async getStatus(
    @Request() req,
    @Query() query: WatchStatusQueryDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.watch.status, async () => {
      const status = await this.watchService.getStatus(req.user.sub, {
        taskMode: query.taskMode,
        limit: query.limit,
      });

      return {
        status: 200,
        body: status,
      };
    });
  }

  @TsRestHandler(apiContract.watch.intentions)
  async intentions(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.watch.intentions, async () => {
      const intentions = await this.watchService.listIntentions(req.user.sub);

      return {
        status: 200,
        body: intentions,
      };
    });
  }
}
