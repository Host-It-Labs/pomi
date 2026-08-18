import { IsUUID } from 'class-validator';

export class TaskEventLogParamDto {
  @IsUUID()
  id: string;
}
