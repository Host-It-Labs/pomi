import {
  Body,
  Controller,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { DebugGuard } from '../auth/debug.guard';
import { AssistantDebugService } from './assistant-debug.service';
import { AssistantCaptureService } from './assistant-capture.service';
import { AssistantService } from './assistant.service';
import {
  CreateAssistantTaskFromTextDto,
  FinalizeAssistantVoiceCommandDto,
  PrepareAssistantTaskFromTextDto,
  PrepareAssistantVoiceCommandDto,
  RegisterAssistantVoiceChunksDto,
  TranscribeAssistantVoiceChunkDto,
  TranscribeAssistantTaskDto,
} from './dto/assistant-task-capture.dto';
import {
  AssistantDebugLogParamDto,
  UpdateAssistantDebugLogFlagDto,
  UpdateAssistantDebugStatusDto,
} from './dto/assistant-debug.dto';
import { AssistantModelsQueryDto } from './dto/assistant-models-query.dto';
import { UpdateAssistantSettingsDto } from './dto/update-assistant-settings.dto';

@Controller()
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(
    private assistantService: AssistantService,
    private assistantCaptureService: AssistantCaptureService,
    private assistantDebugService: AssistantDebugService
  ) {}

  @TsRestHandler(apiContract.assistant.status)
  async getStatus(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.status, async () => {
      const status = await this.assistantService.getStatus(req.user.sub);
      return {
        status: 200,
        body: status,
      };
    });
  }

  @UseGuards(AdminGuard)
  @TsRestHandler(apiContract.assistant.settings)
  async getSettings(): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.settings, async () => {
      const settings = await this.assistantService.getSettings();
      return {
        status: 200,
        body: settings,
      };
    });
  }

  @UseGuards(AdminGuard)
  @TsRestHandler(apiContract.assistant.updateSettings)
  async updateSettings(
    @Body() updates: UpdateAssistantSettingsDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.updateSettings, async () => {
      const settings = await this.assistantService.updateSettings(updates);
      return {
        status: 200,
        body: settings,
      };
    });
  }

  @UseGuards(AdminGuard)
  @TsRestHandler(apiContract.assistant.models)
  async listModels(@Query() query: AssistantModelsQueryDto): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.models, async () => {
      const models = await this.assistantService.listModels(query);
      return {
        status: 200,
        body: models,
      };
    });
  }

  @TsRestHandler(apiContract.assistant.createTaskFromText)
  async createTaskFromText(
    @Request() req,
    @Body() body: CreateAssistantTaskFromTextDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.createTaskFromText, async () => {
      const result = await this.assistantCaptureService.createTaskFromText(
        req.user.sub,
        body.text,
        body.defaults,
        body.debugLogId
      );
      return {
        status: 201,
        body: result,
      };
    });
  }

  @TsRestHandler(apiContract.assistant.prepareTaskFromText)
  async prepareTaskFromText(
    @Request() req,
    @Body() body: PrepareAssistantTaskFromTextDto
  ): Promise<unknown> {
    return tsRestHandler(
      apiContract.assistant.prepareTaskFromText,
      async () => {
        const result = await this.assistantCaptureService.prepareTaskFromText(
          req.user.sub,
          body.preparationId,
          body.text,
          body.defaults,
          body.debugLogId
        );
        return { status: 202, body: result };
      }
    );
  }

  @TsRestHandler(apiContract.assistant.transcribeTaskInput)
  async transcribeTaskInput(
    @Request() req,
    @Body() body: TranscribeAssistantTaskDto
  ): Promise<unknown> {
    return tsRestHandler(
      apiContract.assistant.transcribeTaskInput,
      async () => {
        const result = await this.assistantCaptureService.transcribeTaskInput(
          req.user.sub,
          body
        );
        return {
          status: 200,
          body: result,
        };
      }
    );
  }

  @TsRestHandler(apiContract.assistant.prepareVoiceCommand)
  async prepareVoiceCommand(
    @Request() req,
    @Body() body: PrepareAssistantVoiceCommandDto
  ): Promise<unknown> {
    return tsRestHandler(
      apiContract.assistant.prepareVoiceCommand,
      async () => {
        if (body.kind === 'chunks') {
          const result = await this.assistantCaptureService.prepareVoiceChunks(
            req.user.sub,
            body.preparationId
          );
          return { status: 202, body: result };
        }
        const input =
          body.kind === 'audio'
            ? {
                audioBase64: body.audioBase64,
                mimeType: body.mimeType,
                debugLogId: body.debugLogId,
              }
            : {
                transcript: body.transcript,
                transcriptionCostUsd: body.transcriptionCostUsd,
                debugLogId: body.debugLogId,
              };
        const result = await this.assistantCaptureService.prepareVoiceCommand(
          req.user.sub,
          body.preparationId,
          input
        );
        return { status: 202, body: result };
      }
    );
  }

  @TsRestHandler(apiContract.assistant.registerVoiceChunks)
  async registerVoiceChunks(
    @Request() req,
    @Body() body: RegisterAssistantVoiceChunksDto
  ): Promise<unknown> {
    return tsRestHandler(
      apiContract.assistant.registerVoiceChunks,
      async () => {
        const result = await this.assistantCaptureService.registerVoiceChunks(
          req.user.sub,
          body.preparationId,
          body.manifest
        );
        return { status: 202, body: result };
      }
    );
  }

  @TsRestHandler(apiContract.assistant.transcribeVoiceChunk)
  async transcribeVoiceChunk(
    @Request() req,
    @Body() body: TranscribeAssistantVoiceChunkDto
  ): Promise<unknown> {
    return tsRestHandler(
      apiContract.assistant.transcribeVoiceChunk,
      async () => {
        const result = await this.assistantCaptureService.transcribeVoiceChunk(
          req.user.sub,
          body
        );
        return { status: 200, body: result };
      }
    );
  }

  @TsRestHandler(apiContract.assistant.finalizeVoiceCommand)
  async finalizeVoiceCommand(
    @Request() req,
    @Body() body: FinalizeAssistantVoiceCommandDto
  ): Promise<unknown> {
    return tsRestHandler(
      apiContract.assistant.finalizeVoiceCommand,
      async () => {
        const result =
          await this.assistantCaptureService.finalizePreparedVoiceCommand(
            req.user.sub,
            body.preparationId
          );
        return { status: 200, body: result };
      }
    );
  }

  @UseGuards(DebugGuard)
  @TsRestHandler(apiContract.assistant.debugStatus)
  async getDebugStatus(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.debugStatus, async () => {
      const status = await this.assistantDebugService.getStatus(req.user.sub);
      return {
        status: 200,
        body: status,
      };
    });
  }

  @UseGuards(DebugGuard)
  @TsRestHandler(apiContract.assistant.updateDebugStatus)
  async updateDebugStatus(
    @Request() req,
    @Body() body: UpdateAssistantDebugStatusDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.updateDebugStatus, async () => {
      const status = await this.assistantDebugService.updateStatus(
        req.user.sub,
        body.enabled
      );
      return {
        status: 200,
        body: status,
      };
    });
  }

  @UseGuards(DebugGuard)
  @TsRestHandler(apiContract.assistant.debugLogs)
  async getDebugLogs(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.debugLogs, async () => {
      const logs = await this.assistantDebugService.listLogs(req.user.sub);
      return {
        status: 200,
        body: logs,
      };
    });
  }

  @UseGuards(DebugGuard)
  @TsRestHandler(apiContract.assistant.updateDebugLogFlag)
  async updateDebugLogFlag(
    @Request() req,
    @Param() params: AssistantDebugLogParamDto,
    @Body() body: UpdateAssistantDebugLogFlagDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.updateDebugLogFlag, async () => {
      const log = await this.assistantDebugService.updateFlag(
        req.user.sub,
        params.id,
        body.flagged
      );
      return { status: 200, body: log };
    });
  }

  @UseGuards(DebugGuard)
  @TsRestHandler(apiContract.assistant.exportFlaggedDebugLogs)
  async exportFlaggedDebugLogs(@Request() req): Promise<unknown> {
    return tsRestHandler(
      apiContract.assistant.exportFlaggedDebugLogs,
      async () => {
        const result = await this.assistantDebugService.exportFlaggedLogs(
          req.user.sub
        );
        return { status: 200, body: result };
      }
    );
  }

  @UseGuards(DebugGuard)
  @TsRestHandler(apiContract.assistant.clearDebugLogs)
  async clearDebugLogs(@Request() req): Promise<unknown> {
    return tsRestHandler(apiContract.assistant.clearDebugLogs, async () => {
      await this.assistantDebugService.clearLogs(req.user.sub);
      return {
        status: 200,
        body: { success: true },
      };
    });
  }
}
