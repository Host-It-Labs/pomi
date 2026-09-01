import 'reflect-metadata';
import {
  ASSISTANT_MAX_RECORDING_MINUTES,
  CLIENT_NOTIFICATION_TYPES,
  HELP_TIP_IDS,
  TASK_FOLLOW_UP_DELAY_MAX_DAYS,
  TASK_DEFAULT_DUE_DATE_MODES,
  TASK_IMPORT_SOURCES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TIMER_TYPES,
} from '@pomi/shared';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  AssistantDebugLogParamDto,
  UpdateAssistantDebugLogFlagDto,
  UpdateAssistantDebugStatusDto,
} from '../../src/assistant/dto/assistant-debug.dto';
import {
  AssistantAudioDto,
  AssistantTaskDefaultsDto,
  CreateAssistantTaskFromTextDto,
  PrepareAssistantVoiceCommandDto,
  RegisterAssistantVoiceChunksDto,
  TranscribeAssistantTaskDto,
  TranscribeAssistantVoiceChunkDto,
} from '../../src/assistant/dto/assistant-task-capture.dto';
import { AssistantModelsQueryDto } from '../../src/assistant/dto/assistant-models-query.dto';
import { UpdateAssistantSettingsDto } from '../../src/assistant/dto/update-assistant-settings.dto';
import { AuthenticateDto } from '../../src/auth/dto/authenticate.dto';
import { LogoutDto } from '../../src/auth/dto/logout.dto';
import { CreateIntentionDto } from '../../src/intentions/dto/create-intention.dto';
import { IntentionsQueryDto } from '../../src/intentions/dto/intentions-query.dto';
import { ReparentIntentionDto } from '../../src/intentions/dto/reparent-intention.dto';
import { SlugParamDto } from '../../src/intentions/dto/slug.param';
import { UpdateIntentionDto } from '../../src/intentions/dto/update-intention.dto';
import { UpdateListDto } from '../../src/lists/lists.dto';
import { UpdatePreferencesDto } from '../../src/preferences/dto/update-preferences.dto';
import { HeatmapQueryDto } from '../../src/statistics/dto/heatmap-query.dto';
import { StatisticsQueryDto } from '../../src/statistics/dto/statistics-query.dto';
import { TopIntentionsQueryDto } from '../../src/statistics/dto/top-intentions-query.dto';
import { UpdateWorkTimerLogDto } from '../../src/statistics/dto/update-work-timer-log.dto';
import { WorkTimerLogParamDto } from '../../src/statistics/dto/work-timer-log-param.dto';
import { WorkTimerLogsQueryDto } from '../../src/statistics/dto/work-timer-logs-query.dto';
import { CreateTaskDto } from '../../src/tasks/dto/create-task.dto';
import {
  ReorderTaskDto,
  ReorderTasksDto,
} from '../../src/tasks/dto/reorder-tasks.dto';
import { TaskImportDto } from '../../src/tasks/dto/task-import.dto';
import { TaskEventLogParamDto } from '../../src/tasks/dto/task-event-log-param.dto';
import { TaskIdParamDto } from '../../src/tasks/dto/task-id.param';
import { TasksQueryDto } from '../../src/tasks/dto/tasks-query.dto';
import { TaskLogsQueryDto } from '../../src/tasks/dto/task-logs-query.dto';
import { TaskStatisticsQueryDto } from '../../src/tasks/dto/task-statistics-query.dto';
import { UpdateTaskDto } from '../../src/tasks/dto/update-task.dto';
import { TestNotificationDto } from '../../src/timer/dto/test-notification.dto';
import { CreateUserActionDto } from '../../src/user-actions/dto/create-user-action.dto';
import { UserActionIdParam } from '../../src/user-actions/dto/user-action-id.param';
import { UserActionStatusQuery } from '../../src/user-actions/dto/user-action-status.query';
import { UpdatePushTokenDto } from '../../src/users/dto/update-push-token.dto';
import { UserIdParamDto } from '../../src/users/dto/user-id.param';
import { UsernameParamDto } from '../../src/users/dto/username.param';
import { WatchStatusQueryDto } from '../../src/watch/dto/watch-status-query.dto';

type DtoConstructor = new () => object;
const UUID = '00000000-0000-4000-8000-000000000001';

async function validateDto(
  Dto: DtoConstructor,
  value: Record<string, unknown>
): Promise<{ instance: object; errors: ValidationError[] }> {
  const instance = plainToInstance(Dto, value);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { instance, errors };
}

async function expectValid(
  Dto: DtoConstructor,
  value: Record<string, unknown>
): Promise<object> {
  const result = await validateDto(Dto, value);
  expect(result.errors).toEqual([]);
  return result.instance;
}

async function expectInvalid(
  Dto: DtoConstructor,
  value: Record<string, unknown>,
  property?: string
): Promise<void> {
  const { errors } = await validateDto(Dto, value);
  expect(errors.length).toBeGreaterThan(0);
  if (property) {
    expect(errors.some(error => error.property === property)).toBe(true);
  }
}

describe('backend scalar and parameter DTO validation', () => {
  const cases: Array<{
    Dto: DtoConstructor;
    valid: Record<string, unknown>;
    invalid: Record<string, unknown>;
    property: string;
  }> = [
    {
      Dto: AssistantDebugLogParamDto,
      valid: { id: UUID },
      invalid: { id: 'x' },
      property: 'id',
    },
    {
      Dto: UpdateAssistantDebugLogFlagDto,
      valid: { flagged: true },
      invalid: { flagged: 'true' },
      property: 'flagged',
    },
    {
      Dto: AuthenticateDto,
      valid: { username: 'user', password: 'secret' },
      invalid: { username: '', password: '' },
      property: 'username',
    },
    {
      Dto: LogoutDto,
      valid: { platform: 'web' },
      invalid: { platform: 'watch' },
      property: 'platform',
    },
    {
      Dto: SlugParamDto,
      valid: { slug: 'focus' },
      invalid: { slug: '' },
      property: 'slug',
    },
    {
      Dto: WorkTimerLogParamDto,
      valid: { id: UUID },
      invalid: { id: 'x' },
      property: 'id',
    },
    {
      Dto: TaskEventLogParamDto,
      valid: { id: UUID },
      invalid: { id: 'x' },
      property: 'id',
    },
    {
      Dto: TaskIdParamDto,
      valid: { id: UUID },
      invalid: { id: 'x' },
      property: 'id',
    },
    {
      Dto: TasksQueryDto,
      valid: { status: TASK_STATUSES.ACTIVE },
      invalid: { status: 'waiting' },
      property: 'status',
    },
    {
      Dto: AssistantModelsQueryDto,
      valid: { inputModalities: 'text', outputModalities: 'audio' },
      invalid: { inputModalities: 42 },
      property: 'inputModalities',
    },
    {
      Dto: UpdateAssistantDebugStatusDto,
      valid: { enabled: true },
      invalid: { enabled: 'true' },
      property: 'enabled',
    },
    {
      Dto: TaskStatisticsQueryDto,
      valid: { filter: 'completed', rankingPeriod: 'week' },
      invalid: { filter: 'unknown' },
      property: 'filter',
    },
    {
      Dto: TaskLogsQueryDto,
      valid: { limit: '100', offset: '0' },
      invalid: { limit: '101' },
      property: 'limit',
    },
    {
      Dto: UserActionIdParam,
      valid: { id: 'client:action_1' },
      invalid: { id: 'contains spaces' },
      property: 'id',
    },
    {
      Dto: UserIdParamDto,
      valid: { userId: UUID },
      invalid: { userId: 'x' },
      property: 'userId',
    },
    {
      Dto: UsernameParamDto,
      valid: { username: 'copyme' },
      invalid: { username: '' },
      property: 'username',
    },
  ];

  for (const { Dto, valid, invalid, property } of cases) {
    it(`${Dto.name} accepts its contract and rejects its boundary`, async () => {
      await expectValid(Dto, valid);
      await expectInvalid(Dto, invalid, property);
      await expectInvalid(Dto, { ...valid, unexpected: true }, 'unexpected');
    });
  }

  it('enforces action identifier length boundaries', async () => {
    await expectValid(UserActionIdParam, { id: 'a' });
    await expectValid(UserActionIdParam, { id: 'a'.repeat(128) });
    await expectInvalid(UserActionIdParam, { id: '' }, 'id');
    await expectInvalid(UserActionIdParam, { id: 'a'.repeat(129) }, 'id');
  });

  it('keeps existing long usernames valid during authentication', async () => {
    await expectValid(AuthenticateDto, {
      username: 'u'.repeat(129),
      password: 'secret',
    });
  });

  it('keeps the password maximum independent from registration minimums', async () => {
    await expectValid(AuthenticateDto, {
      username: 'user',
      password: 'a'.repeat(256),
    });
    await expectInvalid(
      AuthenticateDto,
      { username: 'user', password: 'a'.repeat(257) },
      'password'
    );
  });

  it('accepts supported account languages and rejects unsupported locales', async () => {
    await expectValid(AuthenticateDto, {
      username: 'language-user',
      password: 'secret',
      language: 'fr',
    });
    await expectInvalid(
      AuthenticateDto,
      { username: 'language-user', password: 'secret', language: 'de' },
      'language'
    );
  });
});

describe('assistant DTO validation', () => {
  it('validates all Assistant task defaults and numeric transformations', async () => {
    const instance = await expectValid(AssistantTaskDefaultsDto, {
      description: 'details',
      dueDate: '2026-07-27',
      dueTime: '23:59',
      priority: TASK_PRIORITIES.HIGH,
      timerType: TIMER_TYPES.WORK,
      intentionSlug: 'focus',
      subIntentionSlug: 'review',
      recurrenceRule: 'FREQ=DAILY',
      recurrenceInterval: '1.5',
      recurrenceAnchorMode: 'completion',
    });
    expect(instance).toMatchObject({
      recurrenceInterval: 1.5,
    });
    for (const [property, value] of [
      ['dueDate', '27-07-2026'],
      ['dueTime', '24:00'],
      ['priority', 'critical'],
      ['timerType', 'idle'],
      ['recurrenceInterval', 0],
      ['recurrenceInterval', Number.NaN],
      ['recurrenceAnchorMode', 'start'],
    ] as const) {
      await expectInvalid(
        AssistantTaskDefaultsDto,
        { [property]: value },
        property
      );
    }
  });

  it('validates nested text capture, audio, chunk, task, and transcript payloads', async () => {
    await expectValid(CreateAssistantTaskFromTextDto, {
      text: 'Buy milk',
      defaults: { dueDate: '2026-07-27', recurrenceInterval: '2' },
      debugLogId: UUID,
    });
    await expectInvalid(
      CreateAssistantTaskFromTextDto,
      { text: '', defaults: { dueDate: 'bad' } },
      'text'
    );
    await expectInvalid(
      CreateAssistantTaskFromTextDto,
      { text: 'x'.repeat(1_000_001) },
      'text'
    );
    await expectValid(AssistantAudioDto, {
      audioBase64: 'YQ==',
      mimeType: 'audio/webm',
    });
    await expectInvalid(
      AssistantAudioDto,
      { audioBase64: '', mimeType: '' },
      'audioBase64'
    );
    for (const Dto of [TranscribeAssistantTaskDto]) {
      await expectValid(Dto, {
        audioBase64: 'YQ==',
        mimeType: 'audio/webm',
        debugLogId: UUID,
      });
      await expectInvalid(
        Dto,
        { audioBase64: '', mimeType: '' },
        'audioBase64'
      );
      await expectInvalid(
        Dto,
        { audioBase64: 'YQ==', mimeType: 'x'.repeat(129) },
        'mimeType'
      );
    }
    await expectValid(TranscribeAssistantVoiceChunkDto, {
      preparationId: UUID,
      index: 0,
      audioBase64: 'YQ==',
      mimeType: 'audio/webm',
    });
    await expectValid(RegisterAssistantVoiceChunksDto, {
      preparationId: UUID,
      manifest: [
        { audioSha256: 'a'.repeat(64), mimeType: 'audio/webm' },
        { audioSha256: 'b'.repeat(64), mimeType: 'audio/webm' },
      ],
    });
    await expectInvalid(
      RegisterAssistantVoiceChunksDto,
      {
        preparationId: UUID,
        manifest: [
          { audioSha256: 'invalid', mimeType: 'audio/webm' },
          { audioSha256: 'b'.repeat(64), mimeType: 'audio/webm' },
        ],
      },
      'manifest'
    );
    await expectInvalid(
      RegisterAssistantVoiceChunksDto,
      {
        preparationId: UUID,
        manifest: Array.from({ length: 121 }, (_, index) => ({
          audioSha256: index.toString(16).padStart(64, '0'),
          mimeType: 'audio/webm',
        })),
      },
      'manifest'
    );
  });

  it('requires the fields that match each prepared voice variant', async () => {
    await expectValid(PrepareAssistantVoiceCommandDto, {
      preparationId: UUID,
      kind: 'audio',
      audioBase64: 'YQ==',
      mimeType: 'audio/webm',
    });
    await expectValid(PrepareAssistantVoiceCommandDto, {
      preparationId: UUID,
      kind: 'transcript',
      transcript: 'Create a task',
    });
    await expectValid(PrepareAssistantVoiceCommandDto, {
      preparationId: UUID,
      kind: 'chunks',
    });
    await expectInvalid(
      PrepareAssistantVoiceCommandDto,
      { preparationId: UUID, kind: 'audio', mimeType: 'audio/webm' },
      'audioBase64'
    );
    await expectInvalid(
      PrepareAssistantVoiceCommandDto,
      { preparationId: UUID, kind: 'transcript' },
      'transcript'
    );
  });

  it('validates Assistant settings nullable fields, enums, and numeric limits', async () => {
    const instance = await expectValid(UpdateAssistantSettingsDto, {
      textModel: null,
      transcriptionModel: 'whisper',
      speechModel: 'speech',
      speechVoice: 'alloy',
      assistantRecordingMaxMinutes: '1',
      usageBudgetPeriod: 'daily',
      usageBudgetCapUsd: '0',
    });
    expect(instance).toMatchObject({
      assistantRecordingMaxMinutes: 1,
      usageBudgetCapUsd: 0,
    });
    await expectValid(UpdateAssistantSettingsDto, {
      usageBudgetPeriod: 'monthly',
      usageBudgetCapUsd: null,
    });
    await expectValid(UpdateAssistantSettingsDto, {
      assistantRecordingMaxMinutes: ASSISTANT_MAX_RECORDING_MINUTES,
    });
    for (const [property, value] of [
      ['textModel', 1],
      ['assistantRecordingMaxMinutes', 0],
      ['assistantRecordingMaxMinutes', 1.5],
      ['assistantRecordingMaxMinutes', ASSISTANT_MAX_RECORDING_MINUTES + 1],
      ['usageBudgetPeriod', 'weekly'],
      ['usageBudgetCapUsd', -1],
      ['usageBudgetCapUsd', Number.NaN],
    ] as const) {
      await expectInvalid(
        UpdateAssistantSettingsDto,
        { [property]: value },
        property
      );
    }
  });

  it('rejects oversized Assistant model filters and task defaults', async () => {
    await expectInvalid(
      AssistantModelsQueryDto,
      { inputModalities: 'x'.repeat(129) },
      'inputModalities'
    );
    await expectInvalid(
      CreateAssistantTaskFromTextDto,
      {
        text: 'Create a task',
        defaults: { description: 'x'.repeat(10_001) },
      },
      'defaults'
    );
  });
});

describe('Task follow-up DTO validation', () => {
  const definition = {
    title: 'Send the follow-up',
    description: null,
    dueTime: '09:00',
    priority: TASK_PRIORITIES.NORMAL,
    timerType: TIMER_TYPES.WORK,
    intentionSlug: null,
    subIntentionSlug: null,
    vacationEligible: false,
  };

  it('accepts an embedded definition and nonnegative integer delay', async () => {
    const create = await expectValid(CreateTaskDto, {
      title: 'Source Task',
      followUpDefinition: definition,
      followUpDelayDays: '3',
    });
    const update = await expectValid(UpdateTaskDto, {
      followUpDefinition: definition,
      followUpDelayDays: '0',
    });

    expect(create).toMatchObject({
      followUpDefinition: definition,
      followUpDelayDays: 3,
    });
    expect(update).toMatchObject({
      followUpDefinition: definition,
      followUpDelayDays: 0,
    });
    await expectValid(CreateTaskDto, {
      title: 'Source Task',
      followUpDefinition: definition,
      followUpDelayDays: TASK_FOLLOW_UP_DELAY_MAX_DAYS,
    });
  });

  it('rejects malformed definitions and negative delays', async () => {
    await expectInvalid(
      CreateTaskDto,
      {
        title: 'Source Task',
        followUpDefinition: { ...definition, title: '' },
      },
      'followUpDefinition'
    );
    await expectInvalid(
      UpdateTaskDto,
      { followUpDelayDays: -1 },
      'followUpDelayDays'
    );
    await expectInvalid(
      UpdateTaskDto,
      { followUpDelayDays: TASK_FOLLOW_UP_DELAY_MAX_DAYS + 1 },
      'followUpDelayDays'
    );
  });
});

describe('intentions and preferences DTO validation', () => {
  for (const Dto of [CreateIntentionDto, UpdateIntentionDto]) {
    it(`${Dto.name} validates conditional durations and optional state`, async () => {
      const instance = await expectValid(Dto, {
        title: 'Focus',
        emoji: '🎯',
        type: TIMER_TYPES.LONG_BREAK,
        hasCustomDuration: true,
        customDuration: '1',
        keepScreenAwake: true,
        isHabit: false,
        isFavorite: true,
        allowsTasks: false,
        parentIntentionId: UUID,
      });
      expect(instance).toMatchObject({ customDuration: 1 });
      await expectValid(Dto, {
        title: 'Focus',
        emoji: '🎯',
        hasCustomDuration: false,
        customDuration: 'bad',
      });
      await expectInvalid(Dto, { title: '', emoji: '' }, 'title');
      await expectInvalid(
        Dto,
        {
          title: 'Focus',
          emoji: '🎯',
          hasCustomDuration: true,
          customDuration: 0,
        },
        'customDuration'
      );
      await expectInvalid(
        Dto,
        { title: 'Focus', emoji: '🎯', type: 'idle' },
        'type'
      );
      await expectInvalid(
        Dto,
        { title: 'Focus', emoji: '🎯', parentIntentionId: 'bad' },
        'parentIntentionId'
      );
    });
  }

  it('transforms intention query booleans and validates filters', async () => {
    const truthy = await expectValid(IntentionsQueryDto, {
      type: TIMER_TYPES.BREAK,
      isArchived: 'true',
      parentSlug: 'rest',
      includeSubIntentions: true,
    });
    expect(truthy).toMatchObject({
      isArchived: true,
      includeSubIntentions: true,
    });
    const falsey = await expectValid(IntentionsQueryDto, {
      isArchived: 'false',
      includeSubIntentions: 'false',
    });
    expect(falsey).toMatchObject({
      isArchived: false,
      includeSubIntentions: false,
    });
    await expectInvalid(IntentionsQueryDto, { type: 'idle' }, 'type');
    await expectInvalid(IntentionsQueryDto, { parentSlug: 1 }, 'parentSlug');
  });

  it('validates reparenting', async () => {
    await expectValid(ReparentIntentionDto, {
      type: TIMER_TYPES.WORK,
      parentSlug: 'focus',
    });
    await expectInvalid(
      ReparentIntentionDto,
      { type: 'idle', parentSlug: '' },
      'parentSlug'
    );
  });

  it('accepts every preference field and enforces representative boundaries', async () => {
    const booleans = [
      'autoStartBreak',
      'notifications',
      'notifyOnWorkComplete',
      'notifyOnBreakComplete',
      'notifyBeforeWorkComplete',
      'soundNotifications',
      'pushNotifications',
      'globalShortcut',
      'keyboardShortcuts',
      'intentionExtension',
      'intentionRequireSelection',
      'intentionShowDailyCount',
      'intentionBreakIntentions',
      'intentionMultiSelect',
      'intentionShowBreakIntentionsInLongBreak',
      'intentionCustomDurations',
      'intentionSubIntentions',
      'intentionHabits',
      'workTimerLogsExtension',
      'sessionsExtension',
      'sessionHasLongBreak',
      'resetBreakOnFirstIntention',
      'resetLongBreakOnFirstIntention',
      'sessionShowLongBreakButton',
      'sessionShowEta',
      'sessionStackTimers',
      'sessionAutoDetectLongBreak',
      'keepScreenAwake',
      'undoAlerts',
      'tasksExtension',
      'tasksShowSetupPrompts',
      'tasksShowInMinimizedTimer',
      'tasksAutoSwitchToIntentionMode',
      'tasksDuringBreaks',
      'taskUrgentReminderRepeatEnabled',
      'advancedSkip',
      'timerExtension',
      'timerExtrasSeen',
      'sessionsExtrasSeen',
      'intentionsExtrasSeen',
      'assistantExtension',
      'assistantTaskTranscriptsEnabled',
    ];
    const payload: Record<string, unknown> = Object.fromEntries(
      booleans.map(key => [key, true])
    );
    Object.assign(payload, {
      workTimerDuration: '1',
      breakTimerDuration: '1',
      notifyBeforeTime: '0',
      timeZone: 'UTC',
      sessionPomodorosCount: '1',
      sessionLongBreakDuration: '1',
      taskDefaultDueDateMode: Object.values(TASK_DEFAULT_DUE_DATE_MODES)[0],
      taskDefaultDueDateDays: '365',
      hiddenHelpTips: [Object.values(HELP_TIP_IDS)[0]],
      taskReminderPriorities: [TASK_PRIORITIES.HIGH, TASK_PRIORITIES.URGENT],
      taskBeforeDueReminderMinutes: '0',
      taskUrgentReminderRepeatIntervalMinutes: '1',
      assistantTaskTranscriptMinWords: '100000',
    });
    const instance = await expectValid(UpdatePreferencesDto, payload);
    expect(instance).toMatchObject({
      workTimerDuration: 1,
      taskDefaultDueDateDays: 365,
    });
    await expectValid(UpdatePreferencesDto, { taskReminderPriorities: [] });

    for (const [property, value] of [
      ['workTimerDuration', 0],
      ['notifyBeforeTime', -1],
      ['timeZone', 'x'.repeat(65)],
      ['sessionPomodorosCount', 1.5],
      ['taskDefaultDueDateMode', 'later'],
      ['taskDefaultDueDateDays', 366],
      ['hiddenHelpTips', ['unknown-tip']],
      ['taskReminderPriorities', ['critical']],
      ['taskReminderPriorities', [TASK_PRIORITIES.HIGH, TASK_PRIORITIES.HIGH]],
      ['taskBeforeDueReminderMinutes', -1],
      ['taskUrgentReminderRepeatIntervalMinutes', 0],
      ['assistantTaskTranscriptMinWords', 100001],
      ['notifications', 'true'],
    ] as const) {
      await expectInvalid(
        UpdatePreferencesDto,
        { [property]: value },
        property
      );
    }
  });
});

describe('List DTO validation', () => {
  it('accepts only boolean favorite updates', async () => {
    await expectValid(UpdateListDto, { isFavorite: true });
    await expectInvalid(UpdateListDto, { isFavorite: 'true' }, 'isFavorite');
  });
});

describe('statistics DTO validation', () => {
  it('validates heatmap and statistics query transforms and bounds', async () => {
    const heatmap = await expectValid(HeatmapQueryDto, {
      year: '2026',
      type: TIMER_TYPES.WORK,
      intention: 'focus',
      subIntention: 'review',
    });
    expect(heatmap).toMatchObject({ year: 2026 });
    await expectInvalid(HeatmapQueryDto, { year: '2026.5' }, 'year');
    await expectInvalid(
      HeatmapQueryDto,
      { year: '2026', type: 'idle' },
      'type'
    );
    const query = await expectValid(StatisticsQueryDto, {
      intention: 'focus',
      subIntention: 'review',
      type: TIMER_TYPES.BREAK,
      start: '0',
      end: '1',
    });
    expect(query).toMatchObject({ start: 0, end: 1 });
    await expectInvalid(StatisticsQueryDto, { start: -1 }, 'start');
    await expectInvalid(StatisticsQueryDto, { end: 1.5 }, 'end');
  });

  it('validates top-intention period, type, and metric', async () => {
    for (const period of ['today', 'week', 'month', 'year']) {
      await expectValid(TopIntentionsQueryDto, {
        period,
        type: TIMER_TYPES.LONG_BREAK,
        parentIntention: 'rest',
        metric: 'hours',
      });
    }
    await expectValid(TopIntentionsQueryDto, {
      period: 'today',
      metric: 'count',
    });
    await expectInvalid(TopIntentionsQueryDto, { period: 'all' }, 'period');
    await expectInvalid(
      TopIntentionsQueryDto,
      { period: 'today', metric: 'seconds' },
      'metric'
    );
  });

  it('validates work-log updates and pagination boundaries', async () => {
    const log = await expectValid(UpdateWorkTimerLogDto, {
      intention: null,
      intentions: ['focus'],
      subIntentions: { focus: 'review' },
      duration: '1',
    });
    expect(log).toMatchObject({ duration: 1 });
    await expectValid(UpdateWorkTimerLogDto, { duration: 86_400_000 });
    await expectInvalid(UpdateWorkTimerLogDto, { duration: 0 }, 'duration');
    await expectInvalid(
      UpdateWorkTimerLogDto,
      { duration: 86_400_001 },
      'duration'
    );
    await expectInvalid(
      UpdateWorkTimerLogDto,
      { duration: 1, intentions: [1] },
      'intentions'
    );
    const page = await expectValid(WorkTimerLogsQueryDto, {
      offset: '0',
      limit: '100',
    });
    expect(page).toMatchObject({ offset: 0, limit: 100 });
    await expectInvalid(WorkTimerLogsQueryDto, { offset: -1 }, 'offset');
    await expectInvalid(WorkTimerLogsQueryDto, { limit: 0 }, 'limit');
    await expectInvalid(WorkTimerLogsQueryDto, { limit: 101 }, 'limit');
  });
});

describe('Task DTO validation', () => {
  const taskPayload = {
    title: 'Ship tests',
    description: null,
    dueDate: '2026-07-27',
    dueTime: '00:00',
    priority: TASK_PRIORITIES.URGENT,
    timerType: TIMER_TYPES.WORK,
    customDuration: '1800000',
    pinned: true,
    intentionSlug: 'pomi',
    subIntentionSlug: 'tests',
    recurrenceRule: 'FREQ=DAILY',
    recurrenceInterval: '1.5',
    recurrenceAnchorMode: 'planned',
    vacationEligible: false,
  };

  it('validates Task creation and update fields', async () => {
    const created = await expectValid(CreateTaskDto, taskPayload);
    expect(created).toMatchObject({
      recurrenceInterval: 1.5,
      customDuration: 1_800_000,
    });
    const updated = await expectValid(UpdateTaskDto, {
      ...taskPayload,
      manualOrder: '0',
      manualOrderOverride: false,
      status: TASK_STATUSES.COMPLETED,
    });
    expect(updated).toMatchObject({ manualOrder: 0 });
    for (const Dto of [CreateTaskDto, UpdateTaskDto]) {
      await expectInvalid(Dto, { title: '' }, 'title');
      await expectInvalid(Dto, { title: 'x', dueDate: 'bad' }, 'dueDate');
      await expectInvalid(Dto, { title: 'x', dueTime: '24:00' }, 'dueTime');
      await expectInvalid(
        Dto,
        { title: 'x', recurrenceInterval: 0 },
        'recurrenceInterval'
      );
    }
    await expectInvalid(UpdateTaskDto, { manualOrder: -1 }, 'manualOrder');
    await expectInvalid(UpdateTaskDto, { status: 'waiting' }, 'status');
    for (const Dto of [CreateTaskDto, UpdateTaskDto]) {
      await expectValid(Dto, { title: 'x', customDuration: null });
      await expectInvalid(
        Dto,
        { title: 'x', customDuration: 0 },
        'customDuration'
      );
      await expectInvalid(
        Dto,
        { title: 'x', customDuration: 1.5 },
        'customDuration'
      );
      await expectInvalid(
        Dto,
        { title: 'x', customDuration: 'bad' },
        'customDuration'
      );
    }
    for (const Dto of [CreateTaskDto, UpdateTaskDto]) {
      await expectInvalid(Dto, { title: 'x'.repeat(501) }, 'title');
      await expectInvalid(
        Dto,
        { title: 'x', description: 'x'.repeat(10_001) },
        'description'
      );
    }
  });

  it('transforms and validates nested Task reordering', async () => {
    const result = await expectValid(ReorderTasksDto, {
      tasks: [{ id: UUID, manualOrder: '0', manualOrderOverride: true }],
    });
    expect(result).toMatchObject({ tasks: [{ manualOrder: 0 }] });
    await expectValid(ReorderTaskDto, { id: UUID, manualOrder: 0 });
    await expectInvalid(ReorderTasksDto, { tasks: [] }, 'tasks');
    await expectInvalid(
      ReorderTasksDto,
      { tasks: [{ id: 'not-a-uuid', manualOrder: -1 }] },
      'tasks'
    );
  });

  it('validates Task import envelopes and rows before service dispatch', async () => {
    await expectValid(TaskImportDto, {
      source: TASK_IMPORT_SOURCES.VIKUNJA,
      tasks: [
        {
          sourceId: 'task-1',
          title: 'Buy milk',
          dueDate: '2026-07-27',
          dueTime: '10:00',
          priority: TASK_PRIORITIES.NORMAL,
          timerType: TIMER_TYPES.WORK,
          recurrenceAnchorMode: 'planned',
          include: true,
        },
      ],
    });
    await expectInvalid(
      TaskImportDto,
      { source: 'unknown', tasks: [] },
      'source'
    );
    await expectInvalid(
      TaskImportDto,
      {
        source: TASK_IMPORT_SOURCES.VIKUNJA,
        tasks: [{ sourceId: '', title: 'Buy milk', include: true }],
      },
      'tasks'
    );
    await expectInvalid(
      TaskImportDto,
      {
        source: TASK_IMPORT_SOURCES.VIKUNJA,
        tasks: Array.from({ length: 5_001 }, (_, index) => ({
          sourceId: `task-${index}`,
          title: 'Buy milk',
          include: true,
        })),
      },
      'tasks'
    );
    await expectInvalid(
      TaskImportDto,
      {
        source: TASK_IMPORT_SOURCES.VIKUNJA,
        tasks: [{ sourceId: 'task-1', title: 'Buy milk', include: 'true' }],
      },
      'tasks'
    );
  });

  it('rejects string booleans with production implicit conversion enabled', async () => {
    const instance = plainToInstance(
      TaskImportDto,
      {
        source: TASK_IMPORT_SOURCES.VIKUNJA,
        tasks: [{ sourceId: 'task-1', title: 'Buy milk', include: 'false' }],
      },
      { enableImplicitConversion: true }
    );
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(instance.tasks[0].include).toBe('false');
    expect(errors.some(error => error.property === 'tasks')).toBe(true);
  });
});

describe('timer, user-action, user, and Watch DTO validation', () => {
  it('validates test-notification combinations and boundaries', async () => {
    for (const type of [
      CLIENT_NOTIFICATION_TYPES.COMPLETE,
      CLIENT_NOTIFICATION_TYPES.WARNING,
      CLIENT_NOTIFICATION_TYPES.LONG_BREAK_DETECTED,
      CLIENT_NOTIFICATION_TYPES.PAUSED_TIMER_REMINDER,
    ]) {
      await expectValid(TestNotificationDto, {
        type,
        timerType: TIMER_TYPES.WORK,
        minutesLeft: 1,
        isLastWorkTimerInSession: false,
      });
    }
    await expectInvalid(
      TestNotificationDto,
      { type: 'other', timerType: TIMER_TYPES.WORK },
      'type'
    );
    await expectInvalid(
      TestNotificationDto,
      { type: CLIENT_NOTIFICATION_TYPES.WARNING, timerType: 'idle' },
      'timerType'
    );
    await expectInvalid(
      TestNotificationDto,
      {
        type: CLIENT_NOTIFICATION_TYPES.WARNING,
        timerType: TIMER_TYPES.WORK,
        minutesLeft: 0,
      },
      'minutesLeft'
    );
  });

  it('validates queued action submission and wait boundaries', async () => {
    await expectValid(CreateUserActionDto, {
      actionId: 'client:action-1',
      action: { kind: 'timer', operation: 'pause' },
    });
    await expectInvalid(
      CreateUserActionDto,
      { actionId: '', action: [] },
      'actionId'
    );
    await expectInvalid(
      CreateUserActionDto,
      { actionId: 'a'.repeat(129), action: {} },
      'actionId'
    );
    const zero = await expectValid(UserActionStatusQuery, { waitMs: '0' });
    expect(zero).toMatchObject({ waitMs: 0 });
    await expectValid(UserActionStatusQuery, { waitMs: 30_000 });
    await expectInvalid(UserActionStatusQuery, { waitMs: -1 }, 'waitMs');
    await expectInvalid(UserActionStatusQuery, { waitMs: 30_001 }, 'waitMs');
    await expectInvalid(UserActionStatusQuery, { waitMs: 1.5 }, 'waitMs');
  });

  it('validates push-token platforms', async () => {
    await expectValid(UpdatePushTokenDto, {
      token: 'token',
      platform: 'android',
    });
    await expectValid(UpdatePushTokenDto, { token: 'token', platform: 'ios' });
    await expectValid(UpdatePushTokenDto, {
      token: 'token',
      platform: 'ios-live-activity',
    });
    await expectValid(UpdatePushTokenDto, {
      token: null,
      platform: 'ios-live-activity',
    });
    await expectInvalid(
      UpdatePushTokenDto,
      { token: '', platform: 'web' },
      'token'
    );
  });

  it('validates the Watch status query at the runtime boundary', async () => {
    const query = await expectValid(WatchStatusQueryDto, {
      taskMode: 'intention',
      limit: '12',
    });
    expect(query).toMatchObject({ limit: 12 });
    await expectInvalid(WatchStatusQueryDto, { taskMode: 'all' }, 'taskMode');
    await expectInvalid(WatchStatusQueryDto, { limit: 13 }, 'limit');
  });
});
