import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AppleNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  signedPayload: string;
}
