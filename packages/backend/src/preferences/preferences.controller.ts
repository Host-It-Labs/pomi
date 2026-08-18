import { Body, Controller, Request, UseGuards } from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { AuthGuard } from '../auth/auth.guard';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferencesService } from './preferences.service';

@Controller()
@UseGuards(AuthGuard)
export class PreferencesController {
  constructor(private preferencesService: PreferencesService) {}

  @TsRestHandler(apiContract.preferences.get)
  async getPreferences(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.preferences.get, async () => {
      const userId = req.user.sub;
      const preferences = await this.preferencesService.getPreferences(userId);
      return {
        status: 200,
        body: preferences,
      };
    });
  }

  @TsRestHandler(apiContract.preferences.update)
  async updatePreferences(
    @Request() req,
    @Body() updates: UpdatePreferencesDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.preferences.update, async () => {
      const userId = req.user.sub;
      const preferences = await this.preferencesService.updatePreferences(
        userId,
        updates
      );
      return {
        status: 200,
        body: preferences,
      };
    });
  }
}
