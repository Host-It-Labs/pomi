import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ConfigureVacationDto } from '../../src/vacation/vacation.dto';

describe('ConfigureVacationDto', () => {
  it('rejects malformed List and item IDs before coverage mutation', async () => {
    const dto = plainToInstance(ConfigureVacationDto, {
      intentionSlugs: ['work'],
      listIds: ['not-a-uuid'],
      excludedItemIds: ['also-not-a-uuid'],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map(error => error.property)).toEqual([
      'listIds',
      'excludedItemIds',
    ]);
  });
});
