import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createRequire } from 'node:module';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpApp } from '../../src/configure-app';

const require = createRequire(import.meta.url);
const { AppModule } = require('../../dist/src/app.module.js');

const hasInfrastructure = Boolean(
  process.env.DATABASE_URL && process.env.REDIS_URL
);

describe.runIf(hasInfrastructure)('production Nest HTTP integration', () => {
  let app: INestApplication;
  let token: string;
  const usernames = [
    'testuser_vitest_http_contract',
    'testuser_vitest_http_contract_secondary',
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttpApp(app as NestExpressApplication);
    await app.init();
    const session = await request(app.getHttpServer()).post('/sessions').send({
      username: usernames[0],
      password: 'vitest-password',
    });
    token = session.body.token;
  });

  afterAll(async () => {
    if (app) {
      const dataSource = app.get(DataSource);
      const entityTarget = (tableName: string) => {
        const metadata = dataSource.entityMetadatas.find(
          candidate => candidate.tableName === tableName
        );
        if (!metadata) throw new Error(`Missing ${tableName} test metadata`);
        return metadata.target;
      };
      const targets = {
        intentions: entityTarget('intentions'),
        preferences: entityTarget('preferences'),
        statistics: entityTarget('statistics'),
        tasks: entityTarget('tasks'),
        users: entityTarget('users'),
      };
      const users = await dataSource.getRepository(targets.users).find({
        select: { id: true },
        where: { username: In(usernames) },
      });
      const userIds = users.map(user => user.id);
      if (userIds.length > 0) {
        await dataSource.transaction(async manager => {
          await manager
            .getRepository(targets.intentions)
            .delete({ userId: In(userIds) });
          await manager
            .getRepository(targets.statistics)
            .delete({ userId: In(userIds) });
          await manager
            .getRepository(targets.tasks)
            .delete({ userId: In(userIds) });
          await manager
            .getRepository(targets.preferences)
            .delete({ userId: In(userIds) });
          await manager
            .getRepository(targets.users)
            .delete({ id: In(userIds) });
        });
      }
    }
    await app?.close();
  });

  it('serves the real health controller through production middleware', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, {
      status: 'ok',
    });
  });

  it('rejects oversized ordinary JSON bodies before controller dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/sessions')
      .set('content-type', 'application/json')
      .send({ username: 'x'.repeat(2 * 1024 * 1024 + 1) });

    expect(response.status).toBe(413);
  });

  it('creates an authenticated database-backed session', async () => {
    const response = await request(app.getHttpServer()).post('/sessions').send({
      username: usernames[1],
      password: 'vitest-password',
    });

    expect(response.status).toBe(200);
    expect(response.body.user.username).toBe(usernames[1]);
    expect(response.body.token).toEqual(expect.any(String));
  });

  it('applies DTO validation and persists preferences through real services', async () => {
    const unauthorized = await request(app.getHttpServer()).get('/preferences');
    expect(unauthorized.status).toBe(401);

    const invalid = await request(app.getHttpServer())
      .put('/preferences')
      .set('authorization', `Bearer ${token}`)
      .send({ unsupportedPreference: true });
    expect(invalid.status).toBe(400);

    const updated = await request(app.getHttpServer())
      .put('/preferences')
      .set('authorization', `Bearer ${token}`)
      .send({ workTimerDuration: 17 });
    expect(updated.status).toBe(200);
    expect(updated.body.workTimerDuration).toBe(17);

    const persisted = await request(app.getHttpServer())
      .get('/preferences')
      .set('authorization', `Bearer ${token}`);
    expect(persisted.status).toBe(200);
    expect(persisted.body.workTimerDuration).toBe(17);
  });

  it('records successful Task imports and exposes import status', async () => {
    const initial = await request(app.getHttpServer())
      .get('/tasks/import-status')
      .set('authorization', `Bearer ${token}`);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ hasImportedTasks: false });

    const imported = await request(app.getHttpServer())
      .post('/tasks/import')
      .set('authorization', `Bearer ${token}`)
      .send({
        source: 'vikunja',
        tasks: [
          {
            sourceId: 'integration-import-1',
            title: 'Imported Task',
            timerType: 'work',
            newIntentionTitle: 'Imported Work',
            newIntentionEmoji: '📥',
            include: true,
          },
        ],
      });
    expect(imported.status).toBe(200);
    expect(imported.body.imported).toHaveLength(1);

    const status = await request(app.getHttpServer())
      .get('/tasks/import-status')
      .set('authorization', `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ hasImportedTasks: true });
  });

  it('logs out through the authenticated production contract', async () => {
    await request(app.getHttpServer())
      .delete('/sessions/current?platform=web')
      .set('authorization', `Bearer ${token}`)
      .expect(200, { success: true });
  });
});
