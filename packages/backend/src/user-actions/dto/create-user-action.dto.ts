import { IsObject, IsString, Length, Matches } from 'class-validator';

export class CreateUserActionDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  actionId: string;

  @IsObject()
  action: Record<string, unknown>;
}
