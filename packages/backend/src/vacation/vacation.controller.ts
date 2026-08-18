import { Body, Controller, Request, UseGuards } from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { AuthGuard } from '../auth/auth.guard';
import { VacationService } from './vacation.service';
import { ActivateVacationDto, ConfigureVacationDto } from './vacation.dto';

@Controller()
@UseGuards(AuthGuard)
export class VacationController {
  constructor(private readonly vacationService: VacationService) {}

  @TsRestHandler(apiContract.vacation.status)
  status(@Request() request): unknown {
    return tsRestHandler(apiContract.vacation.status, async () => ({
      status: 200,
      body: await this.vacationService.status(request.user.sub),
    }));
  }

  @TsRestHandler(apiContract.vacation.configure)
  configure(@Request() request, @Body() body: ConfigureVacationDto): unknown {
    return tsRestHandler(apiContract.vacation.configure, async () => ({
      status: 200,
      body: await this.vacationService.configure(request.user.sub, body),
    }));
  }

  @TsRestHandler(apiContract.vacation.activate)
  activate(@Request() request, @Body() body: ActivateVacationDto): unknown {
    return tsRestHandler(apiContract.vacation.activate, async () => ({
      status: 200,
      body: await this.vacationService.activate(request.user.sub, body.endsOn),
    }));
  }

  @TsRestHandler(apiContract.vacation.deactivate)
  deactivate(@Request() request): unknown {
    return tsRestHandler(apiContract.vacation.deactivate, async () => ({
      status: 200,
      body: await this.vacationService.deactivate(request.user.sub),
    }));
  }
}
