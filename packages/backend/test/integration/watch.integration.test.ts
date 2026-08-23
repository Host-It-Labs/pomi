import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpApp } from '../../src/configure-app';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';
import { clearAuthRateLimitKeys } from './auth-rate-limit-cleanup';

const require = createRequire(import.meta.url);
const { AppModule } = require('../../dist/src/app.module.js');
const hasInfrastructure = Boolean(
  process.env.DATABASE_URL && process.env.REDIS_URL
);
const USER_PREFIX = 'vitest_watch_contract_';
const PASSWORD = 'vitest-password';

type Auth = { token: string; userId: string };
type TimerAction =
  | 'startOrResume'
  | 'selectIntention'
  | 'setIntentions'
  | 'pause'
  | 'addFiveMinutes'
  | 'reset'
  | 'skip';

describe.runIf(hasInfrastructure)('Watch HTTP integration', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttpApp(app as NestExpressApplication);
    await app.init();
    dataSource = app.get(DataSource);
    redis = app.get(REDIS_CLIENT);
    await clearAuthRateLimitKeys(redis);
    await cleanWatchUsers(dataSource, redis);
  });

  afterAll(async () => {
    if (dataSource && redis) await cleanWatchUsers(dataSource, redis);
    if (redis) await clearAuthRateLimitKeys(redis);
    if (app) await app.close();
  });

  async function createSession(name: string): Promise<Auth> {
    const response = await request(app.getHttpServer())
      .post('/sessions')
      .send({ username: `${USER_PREFIX}${name}`, password: PASSWORD });
    expect(response.status).toBe(200);
    return { token: response.body.token, userId: response.body.user.id };
  }

  function authenticated(auth: Auth) {
    return { authorization: `Bearer ${auth.token}` };
  }

  async function updatePreferences(
    auth: Auth,
    values: Record<string, boolean | number>
  ) {
    const response = await request(app.getHttpServer())
      .put('/preferences')
      .set(authenticated(auth))
      .send(values);
    expect(response.status).toBe(200);
    return response.body;
  }

  async function createIntention(
    auth: Auth,
    title: string,
    emoji: string,
    type: 'work' | 'break' | 'longBreak',
    parentIntentionId?: string
  ) {
    const response = await request(app.getHttpServer())
      .post('/intentions')
      .set(authenticated(auth))
      .send({ title, emoji, type, parentIntentionId });
    expect(response.status).toBe(201);
    return response.body;
  }

  async function createTask(
    auth: Auth,
    title: string,
    overrides: Record<string, unknown>
  ) {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .set(authenticated(auth))
      .send({ title, dueDate: null, priority: 'normal', ...overrides });
    expect(response.status).toBe(201);
    return response.body;
  }

  async function timerAction(
    auth: Auth,
    action: TimerAction,
    overrides: Record<string, unknown>
  ) {
    const lifecycle = await timerActionStatus(auth, action, overrides);
    expect(lifecycle.status).toBe('succeeded');
    const authoritative = await status(auth, '');
    return { timer: authoritative.timer };
  }

  async function timerActionStatus(
    auth: Auth,
    action: TimerAction,
    overrides: Record<string, unknown>
  ) {
    const {
      commandId,
      intentionSlug,
      subIntentionSlug,
      intentionSlugs,
      skipLogMode,
      ...fields
    } = overrides;
    const operation = action === 'startOrResume' ? 'createOrResume' : action;
    const subIntentions =
      fields.subIntentions ??
      (typeof intentionSlug === 'string' && typeof subIntentionSlug === 'string'
        ? { [intentionSlug]: subIntentionSlug }
        : undefined);
    return submitAction(
      auth,
      typeof commandId === 'string' ? commandId : randomUUID(),
      {
        kind: 'timer',
        operation,
        ...fields,
        ...(typeof intentionSlug === 'string'
          ? { intention: intentionSlug }
          : {}),
        ...(Array.isArray(intentionSlugs)
          ? { intentions: intentionSlugs }
          : {}),
        ...(subIntentions ? { subIntentions } : {}),
        ...(typeof skipLogMode === 'string'
          ? { requestedLogMode: skipLogMode }
          : {}),
      }
    );
  }

  async function submitAction(
    auth: Auth,
    actionId: string,
    action: Record<string, unknown>
  ) {
    const receipt = await request(app.getHttpServer())
      .post('/user-actions')
      .set(authenticated(auth))
      .send({ actionId, action });
    expect(receipt.status).toBe(202);
    const terminal = await request(app.getHttpServer())
      .get(`/user-actions/${encodeURIComponent(actionId)}?waitMs=30000`)
      .set(authenticated(auth));
    expect(terminal.status).toBe(200);
    return terminal.body;
  }

  async function status(auth: Auth, query: string) {
    const response = await request(app.getHttpServer())
      .get(`/watch/status${query}`)
      .set(authenticated(auth));
    expect(response.status).toBe(200);
    return response.body;
  }

  async function intentions(auth: Auth) {
    const response = await request(app.getHttpServer())
      .get('/watch/intentions')
      .set(authenticated(auth));
    expect(response.status).toBe(200);
    return response.body;
  }

  async function setSessionPosition(auth: Auth, position: number) {
    const lifecycle = await submitAction(auth, randomUUID(), {
      kind: 'timer',
      operation: 'setSessionPosition',
      position,
    });
    expect(lifecycle.status).toBe('succeeded');
    const authoritative = await status(auth, '');
    return { timer: authoritative.timer };
  }

  it('returns timer, Assistant, and compact Tasks status', async () => {
    const auth = await createSession('status');
    await updatePreferences(auth, {
      tasksExtension: true,
      assistantExtension: true,
    });
    const intention = await createIntention(
      auth,
      'Watch Deep Work',
      '⌚',
      'work'
    );
    await createTask(auth, 'Linked watch task', {
      intentionSlug: intention.slug,
      dueDate: nextDate(),
      priority: 'high',
    });
    await timerAction(auth, 'startOrResume', { timerType: 'work' });

    const result = await status(auth, '?taskMode=general&limit=2');
    expect(result.taskMode).toBe('general');
    expect(result.assistant).toEqual(
      expect.objectContaining({
        assistantEnabled: expect.any(Boolean),
        speechCaptureEnabled: expect.any(Boolean),
        aiTaskCaptureEnabled: expect.any(Boolean),
        assistantRecordingMaxMinutes: expect.any(Number),
      })
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toEqual(
      expect.objectContaining({
        title: 'Linked watch task',
        priority: 'high',
        intentionSlug: intention.slug,
        intentionEmoji: '⌚',
      })
    );
    expect(result.timerControls).toEqual(
      expect.objectContaining({
        canStartOrResume: false,
        canPause: true,
        canAddFiveMinutes: true,
        canReset: true,
        canSkip: true,
      })
    );
  });

  it('persists a new account language and keeps it authoritative on login', async () => {
    const username = `${USER_PREFIX}language`;
    const created = await request(app.getHttpServer())
      .post('/sessions')
      .send({ username, password: PASSWORD, language: 'fr' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ language: 'fr', isNewUser: true });

    const loggedIn = await request(app.getHttpServer())
      .post('/sessions')
      .send({ username, password: PASSWORD, language: 'ar' });
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body).toMatchObject({ language: 'fr', isNewUser: false });

    const status = await request(app.getHttpServer())
      .get('/watch/status')
      .set(
        authenticated({
          token: loggedIn.body.token,
          userId: loggedIn.body.user.id,
        })
      );
    expect(status.status).toBe(200);
    expect(status.body.language).toBe('fr');
  });

  it('keeps general Tasks visible before any timer exists', async () => {
    const auth = await createSession('tasks_no_timer');
    await updatePreferences(auth, { tasksExtension: true });
    const task = await createTask(auth, 'No timer watch task', {
      dueDate: nextDate(),
      priority: 'high',
    });

    const result = await status(auth, '?taskMode=general');
    expect(result.timer).toBeNull();
    expect(result.tasks.map((item: { id: string }) => item.id)).toContain(
      task.id
    );
    expect(result.totalVisibleTasks).toBe(1);
  });

  it('keeps timer-linked Tasks ahead of manual General anchors', async () => {
    const auth = await createSession('task_groups');
    await updatePreferences(auth, { tasksExtension: true });
    const intention = await createIntention(
      auth,
      'Watch Current',
      '🎯',
      'work'
    );
    const generalTask = await createTask(auth, 'Manual General anchor', {
      priority: 'urgent',
    });
    await createTask(auth, 'Current Watch task', {
      intentionSlug: intention.slug,
      priority: 'low',
    });
    await request(app.getHttpServer())
      .patch(`/tasks/${generalTask.id}`)
      .set(authenticated(auth))
      .send({ manualOrder: 0, manualOrderOverride: true })
      .expect(200);
    await timerAction(auth, 'startOrResume', {
      timerType: 'work',
      intentionSlugs: [intention.slug],
    });

    const result = await status(auth, '?taskMode=intention&limit=4');
    expect(result.tasks.map((task: { title: string }) => task.title)).toEqual([
      'Current Watch task',
      'Manual General anchor',
    ]);
  });

  it('starts and pauses Timer through the accepted-action gateway', async () => {
    const auth = await createSession('action');
    const started = await timerAction(auth, 'startOrResume', {
      timerType: 'work',
    });
    expect(started.timer).toEqual(
      expect.objectContaining({ type: 'work', status: 'running' })
    );

    const running = await status(auth, '');
    expect(running.timerControls).toEqual(
      expect.objectContaining({
        canPause: true,
        canAddFiveMinutes: true,
        canReset: true,
        canSkip: true,
      })
    );
    expect(running.timer.endsAtMs).toBeGreaterThan(running.serverNowMs);

    const paused = await timerAction(auth, 'pause', {});
    expect(paused.timer).toEqual(
      expect.objectContaining({ type: 'work', status: 'paused' })
    );
  });

  it('applies a queued Watch command ID only once', async () => {
    const auth = await createSession('idempotency');
    const started = await timerAction(auth, 'startOrResume', {
      timerType: 'work',
    });
    const initialDuration = started.timer.duration as number;
    const send = () =>
      timerActionStatus(auth, 'addFiveMinutes', {
        commandId: '00000000-0000-4000-8000-000000000001',
      });

    expect((await send()).status).toBe('succeeded');
    expect((await send()).status).toBe('succeeded');

    const result = await status(auth, '');
    expect(result.timer.duration).toBe(initialDuration + 5 * 60 * 1000);
  });

  it('keeps active long-break intention types in the Watch picker', async () => {
    const auth = await createSession('long_break_picker');
    await updatePreferences(auth, {
      intentionExtension: true,
      tasksExtension: true,
      intentionBreakIntentions: true,
      intentionShowBreakIntentionsInLongBreak: true,
    });
    const work = await createIntention(auth, 'Watch Work', '💼', 'work');
    const longBreak = await createIntention(
      auth,
      'Watch Long Break',
      '🌴',
      'longBreak'
    );
    await createTask(auth, 'Watch Long Break task', {
      timerType: 'longBreak',
      intentionSlug: longBreak.slug,
    });
    await timerAction(auth, 'startOrResume', { timerType: 'longBreak' });

    const options = await intentions(auth);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: longBreak.slug }),
      ])
    );
    expect(options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: work.slug })])
    );
    const result = await status(auth, '?taskMode=general');
    expect(result.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Watch Long Break task',
          intentionSlug: longBreak.slug,
          intentionEmoji: '🌴',
        }),
      ])
    );
  });

  it('sets multiple Parent and Sub-intentions only when enabled', async () => {
    const auth = await createSession('multi');
    await updatePreferences(auth, {
      intentionExtension: true,
      intentionMultiSelect: true,
      intentionSubIntentions: true,
    });
    const parent = await createIntention(
      auth,
      'Watch Multi Parent',
      '🧭',
      'work'
    );
    const child = await createIntention(
      auth,
      'Watch Multi Child',
      '🗺️',
      'work',
      parent.id
    );
    const peer = await createIntention(auth, 'Watch Multi Peer', '🧪', 'work');

    const selected = await timerAction(auth, 'setIntentions', {
      intentionSlugs: [parent.slug, peer.slug],
      subIntentions: { [parent.slug]: child.slug },
    });
    expect(selected.timer.status).toBe('paused');
    expect(selected.timer.intentions).toEqual([
      expect.objectContaining({ slug: parent.slug, subSlug: child.slug }),
      expect.objectContaining({ slug: peer.slug, subSlug: null }),
    ]);
    const selectedStatus = await status(auth, '');
    expect(selectedStatus.timerControls.intentionMultiSelect).toBe(true);
    expect(selectedStatus.timerControls.intentionRequireSelection).toBe(false);

    await updatePreferences(auth, { intentionMultiSelect: false });
    expect(
      (
        await timerActionStatus(auth, 'setIntentions', {
          intentionSlugs: [parent.slug, peer.slug],
          subIntentions: { [parent.slug]: child.slug },
        })
      ).status
    ).toBe('failed');
    expect(
      (
        await timerActionStatus(auth, 'startOrResume', {
          timerType: 'work',
          intentionSlugs: [parent.slug, peer.slug],
          subIntentions: { [parent.slug]: child.slug },
        })
      ).status
    ).toBe('failed');
  });

  it('supports Timer extras and Sessions flags from Watch', async () => {
    const auth = await createSession('extras');
    await updatePreferences(auth, {
      advancedSkip: true,
      sessionsExtension: true,
      sessionPomodorosCount: 4,
    });
    const started = await timerAction(auth, 'startOrResume', {
      timerType: 'work',
    });
    const initialDuration = started.timer.duration;

    const running = await status(auth, '');
    expect(running.timerControls).toEqual(
      expect.objectContaining({
        advancedSkip: true,
        sessionsEnabled: true,
        canAddFiveMinutes: true,
        canReset: true,
        canSkip: true,
      })
    );
    expect(running.timer).toEqual(
      expect.objectContaining({ sessionPosition: 1, sessionTotal: 4 })
    );

    const positioned = await setSessionPosition(auth, 2);
    expect(positioned.timer).toEqual(
      expect.objectContaining({ sessionPosition: 2, sessionTotal: 4 })
    );
    const extended = await timerAction(auth, 'addFiveMinutes', {});
    expect(extended.timer.duration).toBe(initialDuration + 300_000);
    const reset = await timerAction(auth, 'reset', {});
    expect(reset.timer).toEqual(
      expect.objectContaining({ type: 'work', status: 'running' })
    );
    const skipped = await timerAction(auth, 'skip', {
      skipLogMode: 'elapsed',
    });
    expect(skipped.timer.status).toEqual(expect.any(String));
  });

  it('resets the active session after a manual Watch long break', async () => {
    const auth = await createSession('long_break_reset');
    await updatePreferences(auth, {
      sessionsExtension: true,
      sessionPomodorosCount: 4,
      sessionHasLongBreak: true,
    });
    const intention = await createIntention(
      auth,
      'Watch Session',
      '🎯',
      'work'
    );
    await timerAction(auth, 'startOrResume', {
      timerType: 'work',
      intentionSlugs: [intention.slug],
    });
    await setSessionPosition(auth, 2);

    const longBreak = await timerAction(auth, 'startOrResume', {
      timerType: 'longBreak',
    });
    expect(longBreak.timer.type).toBe('longBreak');
    const nextWork = await timerAction(auth, 'skip', { skipLogMode: 'none' });
    expect(nextWork.timer).toEqual(
      expect.objectContaining({
        type: 'work',
        sessionPosition: 1,
        sessionTotal: 4,
      })
    );
  });

  it('starts with a picked Intention and completes Tasks from Watch', async () => {
    const auth = await createSession('complete');
    await updatePreferences(auth, {
      tasksExtension: true,
      intentionExtension: true,
      intentionRequireSelection: true,
    });
    const intention = await createIntention(auth, 'Watch Pick', '🎯', 'work');
    const task = await createTask(auth, 'Watch complete task', {});

    const initial = await status(auth, '');
    expect(initial.timerControls).toEqual(
      expect.objectContaining({
        requiresIntentionSelection: true,
        intentionRequireSelection: true,
        canStartOrResume: false,
      })
    );
    const options = await intentions(auth);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: intention.slug, emoji: '🎯' }),
      ])
    );

    const selected = await timerAction(auth, 'selectIntention', {
      intentionSlug: intention.slug,
    });
    expect(selected.timer).toEqual(
      expect.objectContaining({ type: 'work', status: 'paused' })
    );
    expect(selected.timer.intentions[0]).toEqual(
      expect.objectContaining({ slug: intention.slug, emoji: '🎯' })
    );
    const selectedStatus = await status(auth, '');
    expect(selectedStatus.timerControls).toEqual(
      expect.objectContaining({
        requiresIntentionSelection: false,
        intentionRequireSelection: true,
        canStartOrResume: true,
      })
    );
    const started = await timerAction(auth, 'startOrResume', {
      timerType: 'work',
    });
    expect(started.timer).toEqual(
      expect.objectContaining({ type: 'work', status: 'running' })
    );

    const completed = await submitAction(auth, randomUUID(), {
      kind: 'tasks',
      operation: 'complete',
      taskId: task.id,
    });
    expect(completed.status).toBe('succeeded');
    const finalStatus = await status(auth, '?taskMode=general');
    expect(
      finalStatus.tasks.map((item: { id: string }) => item.id)
    ).not.toContain(task.id);
  });

  it('requires and selects a work sub-intention after a completed break', async () => {
    const auth = await createSession('sub_intention');
    await updatePreferences(auth, {
      intentionExtension: true,
      intentionRequireSelection: true,
    });
    const parent = await createIntention(auth, 'Watch Parent', '🧭', 'work');
    const child = await createIntention(
      auth,
      'Watch Child',
      '🗺️',
      'work',
      parent.id
    );
    await redis.set(
      `user:${auth.userId}:current_timer`,
      JSON.stringify({
        id: 'completed-break',
        startTime: 1_700_000_000_000,
        duration: 60_000,
        type: 'break',
        status: 'completed',
        remainingTime: 0,
      })
    );

    const completedBreak = await status(auth, '');
    expect(completedBreak.timer).toEqual(
      expect.objectContaining({ type: 'break', status: 'completed' })
    );
    expect(completedBreak.timerControls.requiresIntentionSelection).toBe(true);
    const options = await intentions(auth);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: parent.slug,
          emoji: '🧭',
          subIntentions: [
            expect.objectContaining({ slug: child.slug, emoji: '🗺️' }),
          ],
        }),
      ])
    );
    expect(options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: child.slug })])
    );

    expect(
      (
        await timerActionStatus(auth, 'selectIntention', {
          intentionSlug: parent.slug,
        })
      ).status
    ).toBe('failed');
    const selected = await timerAction(auth, 'selectIntention', {
      intentionSlug: parent.slug,
      subIntentionSlug: child.slug,
    });
    expect(selected.timer).toEqual(
      expect.objectContaining({ type: 'work', status: 'paused' })
    );
    expect(selected.timer.intentions[0]).toEqual(
      expect.objectContaining({
        slug: parent.slug,
        emoji: '🧭',
        subSlug: child.slug,
        subTitle: child.title,
        subEmoji: '🗺️',
      })
    );
    const result = await status(auth, '');
    expect(result.timerControls.requiresIntentionSelection).toBe(false);
    expect(result.timer.intentions[0]).toEqual(
      expect.objectContaining({
        slug: parent.slug,
        subSlug: child.slug,
        subTitle: child.title,
        subEmoji: '🗺️',
      })
    );
  });
});

async function cleanWatchUsers(dataSource: DataSource, redis: Redis) {
  const users: Array<{ id: string }> = await dataSource.query(
    'SELECT id FROM users WHERE username LIKE $1',
    [`${USER_PREFIX}%`]
  );
  if (users.length === 0) return;
  const ids = users.map(user => user.id);
  await dataSource.query('DELETE FROM statistics WHERE "userId" = ANY($1)', [
    ids,
  ]);
  await dataSource.query('DELETE FROM intentions WHERE "userId" = ANY($1)', [
    ids,
  ]);
  await dataSource.query('DELETE FROM preferences WHERE "userId" = ANY($1)', [
    ids,
  ]);
  await dataSource.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
  for (const id of ids) {
    const keys = await redis.keys(`user:${id}:*`);
    if (keys.length > 0) await redis.del(...keys);
  }
}

function nextDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
