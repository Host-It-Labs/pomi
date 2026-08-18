import { IsUUID } from 'class-validator';

export class WorkTimerLogParamDto {
  @IsUUID()
  id: string;
}
