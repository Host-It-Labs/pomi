import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AssistantModelsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  inputModalities?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  outputModalities?: string;
}
