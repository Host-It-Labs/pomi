import { IsString, Length, Matches } from 'class-validator';

export class UserActionIdParam {
  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  id: string;
}
