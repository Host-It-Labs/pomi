import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const AUTH_PLATFORMS = [
  'android',
  'ios',
  'web',
  'macos',
  'windows',
  'linux',
] as const;

export class RefreshSessionDto {
  @IsOptional()
  @IsIn(AUTH_PLATFORMS)
  platform?: (typeof AUTH_PLATFORMS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(256)
  refreshToken?: string;
}
