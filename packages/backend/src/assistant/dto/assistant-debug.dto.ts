import { IsBoolean, IsUUID } from 'class-validator';

export class AssistantDebugLogParamDto {
  @IsUUID()
  id: string;
}

export class UpdateAssistantDebugLogFlagDto {
  @IsBoolean()
  flagged: boolean;
}

export class UpdateAssistantDebugStatusDto {
  @IsBoolean()
  enabled: boolean;
}
