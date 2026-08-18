import { IsNotEmpty, IsString } from 'class-validator';

export class UsernameParamDto {
  @IsString()
  @IsNotEmpty()
  username: string;
}
