import { APP_LANGUAGE_VALUES } from '@pomi/shared';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SocialAuthDto {
  @IsIn(['google', 'apple'])
  provider: 'google' | 'apple';

  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @IsUUID()
  state: string;

  @IsUUID()
  nonce: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  givenName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  familyName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  authorizationCode?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(APP_LANGUAGE_VALUES)
  language?: (typeof APP_LANGUAGE_VALUES)[number];
}
