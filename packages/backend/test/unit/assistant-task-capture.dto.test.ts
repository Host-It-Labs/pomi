import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAssistantTaskFromTextDto } from '../../src/assistant/dto/assistant-task-capture.dto';

async function validateCapture(value: unknown) {
  return validate(plainToInstance(CreateAssistantTaskFromTextDto, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreateAssistantTaskFromTextDto', () => {
  it('accepts every shared Task default used by capture', async () => {
    const errors = await validateCapture({
      text: 'Buy milk tomorrow',
      listId: '11111111-1111-4111-8111-111111111111',
      defaults: {
        dueDate: '2026-07-27',
        dueTime: '10:00',
        priority: 'high',
        timerType: 'work',
        intentionSlug: 'admin',
        recurrenceRule: 'FREQ=DAILY',
        recurrenceInterval: 1,
        recurrenceAnchorMode: 'planned',
      },
    });

    expect(errors).toEqual([]);
  });

  it('rejects an invalid selected List context', async () => {
    const errors = await validateCapture({
      text: 'Buy milk',
      listId: 'not-a-uuid',
    });

    expect(errors).not.toEqual([]);
  });

  it('rejects unknown defaults under production whitelist rules', async () => {
    const errors = await validateCapture({
      text: 'Buy milk',
      defaults: { unknownDefault: true },
    });

    expect(errors).not.toEqual([]);
  });
});
