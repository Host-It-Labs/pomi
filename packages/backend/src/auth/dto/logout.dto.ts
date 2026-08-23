import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class LogoutDto {
  @IsIn(['android', 'ios', 'web', 'macos', 'windows', 'linux'])
  platform: 'android' | 'ios' | 'web' | 'macos' | 'windows' | 'linux';

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  token?: string;
}
