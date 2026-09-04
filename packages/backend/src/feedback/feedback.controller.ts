import { Controller, Request, UseGuards } from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import {
  TsRestHandler,
  tsRestHandler,
} from '../validation/ts-rest-zod4.adapter';
import { AssistantService } from '../assistant/assistant.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller()
@UseGuards(AuthGuard)
export class FeedbackController {
  constructor(private readonly assistantService: AssistantService) {}

  @TsRestHandler(apiContract.feedback.transcribe)
  transcribe(@Request() request): unknown {
    return tsRestHandler(apiContract.feedback.transcribe, async ({ body }) => ({
      status: 200,
      body: await this.assistantService.transcribeFeedback(
        request.user.sub,
        body
      ),
    }));
  }
}
