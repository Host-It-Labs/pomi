import { Controller, Request, UseGuards } from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { AuthGuard } from '../auth/auth.guard';
import { DescriptionsService } from './descriptions.service';

@Controller()
@UseGuards(AuthGuard)
export class DescriptionsController {
  constructor(private readonly descriptionsService: DescriptionsService) {}
  @TsRestHandler(apiContract.descriptions.generate)
  generate(@Request() request): unknown {
    return tsRestHandler(apiContract.descriptions.generate, async () => ({
      status: 200,
      body: await this.descriptionsService.generate(request.user.sub),
    }));
  }
}
