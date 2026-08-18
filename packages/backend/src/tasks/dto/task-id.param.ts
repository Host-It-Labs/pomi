import { IsUUID } from 'class-validator';

export class TaskIdParamDto {
  @IsUUID()
  id: string;
}
