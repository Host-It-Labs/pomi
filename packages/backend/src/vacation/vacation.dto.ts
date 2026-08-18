import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class ConfigureVacationDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  intentionSlugs: string[];

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  listIds: string[];

  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID(undefined, { each: true })
  excludedItemIds: string[];
}

export class ActivateVacationDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endsOn?: string | null;
}
