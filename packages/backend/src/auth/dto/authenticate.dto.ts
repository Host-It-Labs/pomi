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
}
