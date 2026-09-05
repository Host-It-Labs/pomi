import { APP_LANGUAGE_VALUES } from '@pomi/shared';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AuthenticateDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;

  @IsOptional()
  @IsString()
  @IsIn(APP_LANGUAGE_VALUES)
  language?: (typeof APP_LANGUAGE_VALUES)[number];

  @IsOptional()
  @IsIn(['android', 'ios', 'web', 'macos', 'windows', 'linux'])
  platform?: 'android' | 'ios' | 'web' | 'macos' | 'windows' | 'linux';

  @IsOptional()
  @IsString()
  @MaxLength(256)
  bootstrapToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}
