import { IsIn, IsOptional } from 'class-validator';

const AUTH_PLATFORMS = [
  'android',
  'ios',
  'web',
  'macos',
  'windows',
  'linux',
] as const;

export class MigrateSessionDto {
  @IsOptional()
  @IsIn(AUTH_PLATFORMS)
  platform?: (typeof AUTH_PLATFORMS)[number];
}
