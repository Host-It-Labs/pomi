import { IsIn } from 'class-validator';

export class LogoutDto {
  @IsIn(['android', 'ios', 'web', 'macos', 'windows', 'linux'])
  platform: 'android' | 'ios' | 'web' | 'macos' | 'windows' | 'linux';
}
