import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createRequire } from 'node:module';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';

const require = createRequire(import.meta.url);
const { AppModule } = require('../../dist/src/app.module.js');
const {
  UserDataTransferService,
} = require('../../dist/src/system/user-data-transfer.service.js');
const { TaskEntity } = require('../../dist/src/tasks/tasks.entity.js');
const { TasksService } = require('../../dist/src/tasks/tasks.service.js');
const { UserEntity } = require('../../dist/src/users/users.entity.js');
const hasInfrastructure = Boolean(
  process.env.DATABASE_URL && process.env.REDIS_URL
);

describe.runIf(hasInfrastructure)('User data transfer integration', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let userId: string | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    redis = app.get(REDIS_CLIENT);
  });

  afterAll(async () => {
    if (dataSource && userId) {
      await dataSource.query('DELETE FROM task_events WHERE "userId" = $1', [
        userId,
      ]);
      await dataSource.query('DELETE FROM tasks WHERE "userId" = $1', [userId]);
      await dataSource.query('DELETE FROM preferences WHERE "userId" = $1', [
        userId,
      ]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
      const keys = await redis.keys(`*${userId}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
    await app?.close();
  });

  it('upgrades version-one follow-up rows and preserves replacement behavior', async () => {
    const user = await dataSource.getRepository(UserEntity).save({
      username: `vitest_legacy_follow_up_${Date.now()}`,
      password: 'not-used',
      isAdmin: false,
    });
    userId = user.id;

    await app.get(UserDataTransferService).importUserData(user.id, {
      version: 1,
      exportedAt: '2026-08-01T00:00:00.000Z',
      sourceUser: { id: 'source-user', username: 'source' },
      data: {
        preferences: null,
        intentions: [],
        statistics: [],
        tasks: [
          {
            id: 'legacy-parent',
            userId: 'source-user',
            title: 'Prepare legacy launch',
            itemKind: 'task',
            followUpTaskId: 'legacy-template',
            followUpDelayDays: 1,
          },
          {
            id: 'legacy-template',
            userId: 'source-user',
            title: 'Send legacy recap',
            description: null,
            dueTime: null,
            priority: 'normal',
            timerType: 'work',
            intentionSlug: null,
            subIntentionSlug: null,
            vacationEligible: false,
            itemKind: 'task',
          },
          {
            id: 'legacy-generated',
            userId: 'source-user',
            title: 'Existing legacy recap',
            itemKind: 'task',
            followUpSourceTaskId: 'legacy-parent',
          },
        ],
        taskEvents: [],
        assistantDebugSetting: null,
        assistantDebugLogs: [],
        assistantUsageEvents: [],
        timerRuntime: {
          currentTimer: null,
          sessionState: null,
          lastCompletionTimestamp: null,
          idleDetected: false,
          undoState: null,
          undoHistory: [],
          redoHistory: [],
          extensionState: null,
        },
      },
    });

    const repository = dataSource.getRepository(TaskEntity);
    const imported = await repository.find({ where: { userId: user.id } });
    const parent = imported.find(
      task => task.title === 'Prepare legacy launch'
    );
    const template = imported.find(task => task.title === 'Send legacy recap');
    const generated = imported.find(
      task => task.title === 'Existing legacy recap'
    );
    expect(parent).toMatchObject({
      followUpTaskId: null,
      followUpDelayDays: 1,
      followUpDefinition: { title: 'Send legacy recap' },
    });
    expect(template?.itemKind).toBe('followUpTemplate');
    expect(generated).toMatchObject({
      itemKind: 'followUp',
      followUpSourceTaskId: parent?.id,
    });

    await app.get(TasksService).updateTask(user.id, parent!.id, {
      followUpDelayDays: 2,
    });
    await app.get(TasksService).updateTask(user.id, parent!.id, {
      status: 'completed',
    });

    const followUps = await repository.find({
      where: { userId: user.id, followUpSourceTaskId: parent!.id },
      order: { createdAt: 'ASC' },
    });
    expect(followUps).toHaveLength(2);
    expect(followUps.map(task => task.status).sort()).toEqual([
      'active',
      'archived',
    ]);
    expect(followUps.every(task => task.itemKind === 'followUp')).toBe(true);
  });
});
