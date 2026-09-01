import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePushTokenDto {
  @IsString()
  @IsOptional()
  @MaxLength(4096)
  token: string | null;

  @IsIn(['android', 'ios', 'ios-live-activity'])
  platform: 'android' | 'ios' | 'ios-live-activity';
}
