import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../../src/assistant/assistant.service';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AssistantService transport', () => {
  it('uses one JSON object request without tools, reasoning, or schema retries', async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: '{"tasks":[]}' } }],
              usage: { cost: 0 },
            }),
        };
      })
    );
    const service = new AssistantService({} as never, {} as never, {} as never);
    service.ensureWithinUsageBudget = async () => undefined;
    service.recordCost = async () => undefined;

    await service.requestJson(
      'user-1',
      'google/gemini-2.5-flash-lite',
      [{ role: 'user', content: 'capture this' }],
      {
        responseSchema: {
          type: 'object',
          properties: { tasks: { type: 'array' } },
          required: ['tasks'],
          additionalProperties: false,
        },
        tools: [
          {
            type: 'function',
            function: {
              name: 'legacy_tool',
              description: 'must not be sent with structured output',
              parameters: { type: 'object' },
            },
          },
        ],
      }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      response_format: { type: 'json_object' },
    });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
    expect(requests[0]).not.toHaveProperty('reasoning');
  });

  it('reuses prepared context instead of repeating budget and timezone reads', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const usageRepository = {
      create: vi.fn(value => value),
      save: vi.fn(async value => value),
    };
    const preferencesService = {
      getPreferences: vi.fn(async () => {
        throw new Error('prepared request must not reload preferences');
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{"tasks":[]}' } }],
            usage: { cost: 0.001 },
          }),
      }))
    );
    const service = new AssistantService(
      {} as never,
      usageRepository as never,
      preferencesService as never
    );
    service.ensureWithinUsageBudget = vi.fn(async () => {
      throw new Error('prepared request must not repeat budget preflight');
    });

    await service.requestJson(
      'user-1',
      'google/gemini-2.5-flash-lite',
      [{ role: 'user', content: 'capture this' }],
      {},
      '2026-07-27'
    );

    expect(service.ensureWithinUsageBudget).not.toHaveBeenCalled();
    expect(preferencesService.getPreferences).not.toHaveBeenCalled();
    expect(usageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        localDate: '2026-07-27',
        kind: 'chat',
      })
    );
  });

  it('prepares description generation when Tasks are disabled', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const queryBuilder = {
      insert: vi.fn(),
      into: vi.fn(),
      values: vi.fn(),
      orIgnore: vi.fn(),
      execute: vi.fn(async () => undefined),
    };
    Object.values(queryBuilder).forEach(method => {
      if (method !== queryBuilder.execute) method.mockReturnValue(queryBuilder);
    });
    const settingsRepository = {
      createQueryBuilder: vi.fn(() => queryBuilder),
      findOne: vi.fn(async () => ({
        id: 'default',
        textModel: 'google/gemini-2.5-flash-lite',
        transcriptionModel: null,
        speechModel: null,
        speechVoice: null,
        assistantRecordingMaxMinutes: 5,
        usageBudgetPeriod: 'daily',
        usageBudgetCapUsd: null,
      })),
    };
    const preferencesService = {
      getPreferences: vi.fn(async () => ({
        tasksExtension: false,
        assistantExtension: true,
        timeZone: 'Europe/Zurich',
      })),
    };
    const service = new AssistantService(
      settingsRepository as never,
      {} as never,
      preferencesService as never
    );

    const runtime = await service.prepareRequest(
      'user-1',
      'descriptionGeneration'
    );

    expect(runtime.settings.textModel).toBe('google/gemini-2.5-flash-lite');
  });

  it('localizes preparation errors using the saved account language', async () => {
    const queryBuilder = {
      insert: vi.fn(),
      into: vi.fn(),
      values: vi.fn(),
      orIgnore: vi.fn(),
      execute: vi.fn(async () => undefined),
    };
    Object.values(queryBuilder).forEach(method => {
      if (method !== queryBuilder.execute) method.mockReturnValue(queryBuilder);
    });
    const service = new AssistantService(
      {
        createQueryBuilder: vi.fn(() => queryBuilder),
        findOne: vi.fn(async () => ({
          id: 'default',
          textModel: null,
          transcriptionModel: null,
          speechModel: null,
          speechVoice: null,
          assistantRecordingMaxMinutes: 5,
          usageBudgetPeriod: 'daily',
          usageBudgetCapUsd: null,
        })),
      } as never,
      {} as never,
      {
        getPreferences: vi.fn(async () => ({
          language: 'fr',
          tasksExtension: true,
          assistantExtension: true,
          timeZone: 'Europe/Zurich',
        })),
      } as never
    );

    await expect(
      service.prepareRequest('user-1', 'taskCapture')
    ).rejects.toThrow('La capture de tâches par IA n’est pas configurée.');
  });

  it('returns model output without waiting for usage-cost persistence', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    let finishSave!: () => void;
    const pendingSave = new Promise<void>(resolve => {
      finishSave = resolve;
    });
    const usageRepository = {
      create: vi.fn(value => value),
      save: vi.fn(() => pendingSave),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{"tasks":[]}' } }],
            usage: { cost: 0.001 },
          }),
      }))
    );
    const service = new AssistantService(
      {} as never,
      usageRepository as never,
      {} as never
    );

    const response = await service.requestJson(
      'user-1',
      'google/gemini-2.5-flash-lite',
      [{ role: 'user', content: 'capture this' }],
      {},
      '2026-07-27'
    );

    expect(response.content).toBe('{"tasks":[]}');
    expect(usageRepository.save).toHaveBeenCalledOnce();
    finishSave();
    await pendingSave;
  });

  it('loads prepared capture settings and preferences once when budget is unlimited', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const queryBuilder = {
      insert: vi.fn(),
      into: vi.fn(),
      values: vi.fn(),
      orIgnore: vi.fn(),
      execute: vi.fn(async () => undefined),
    };
    Object.values(queryBuilder).forEach(method => {
      if (method !== queryBuilder.execute) method.mockReturnValue(queryBuilder);
    });
    const settingsRepository = {
      createQueryBuilder: vi.fn(() => queryBuilder),
      findOne: vi.fn(async () => ({
        id: 'default',
        textModel: 'google/gemini-2.5-flash-lite',
        transcriptionModel: null,
        speechModel: null,
        speechVoice: null,
        assistantRecordingMaxMinutes: 5,
        usageBudgetPeriod: 'daily',
        usageBudgetCapUsd: null,
      })),
    };
    const usageRepository = {
      createQueryBuilder: vi.fn(() => {
        throw new Error('unlimited capture must not query usage totals');
      }),
    };
    const preferencesService = {
      getPreferences: vi.fn(async () => ({
        tasksExtension: true,
        assistantExtension: false,
        timeZone: 'Europe/Zurich',
      })),
    };
    const service = new AssistantService(
      settingsRepository as never,
      usageRepository as never,
      preferencesService as never
    );

    const runtime = await service.prepareRequest('user-1', 'taskCapture');

    expect(runtime.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(settingsRepository.findOne).toHaveBeenCalledOnce();
    expect(preferencesService.getPreferences).toHaveBeenCalledOnce();
    expect(usageRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('does not aggregate usage for unlimited assistant status', async () => {
    const queryBuilder = {
      insert: vi.fn(),
      into: vi.fn(),
      values: vi.fn(),
      orIgnore: vi.fn(),
      execute: vi.fn(async () => undefined),
    };
    Object.values(queryBuilder).forEach(method => {
      if (method !== queryBuilder.execute) method.mockReturnValue(queryBuilder);
    });
    const settingsRepository = {
      createQueryBuilder: vi.fn(() => queryBuilder),
      findOne: vi.fn(async () => ({
        id: 'default',
        textModel: null,
        transcriptionModel: null,
        speechModel: null,
        speechVoice: null,
        assistantRecordingMaxMinutes: 5,
        usageBudgetPeriod: 'daily',
        usageBudgetCapUsd: null,
      })),
    };
    const usageRepository = {
      createQueryBuilder: vi.fn(() => {
        throw new Error('unlimited status must not query usage totals');
      }),
    };
    const preferencesService = {
      getPreferences: vi.fn(async () => ({
        tasksExtension: true,
        assistantExtension: false,
        timeZone: 'Europe/Zurich',
      })),
    };
    const service = new AssistantService(
      settingsRepository as never,
      usageRepository as never,
      preferencesService as never
    );

    await expect(service.getStatus('user-1')).resolves.toMatchObject({
      usageBudgetCapUsd: null,
      usageBudgetUsedUsd: 0,
    });
    expect(usageRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('does not retry a rejected JSON object request', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return response(400, { error: { message: 'unsupported JSON mode' } });
      })
    );
    const service = transportService();

    await expect(
      service.requestJson(
        'user-1',
        'test/model',
        [{ role: 'user', content: 'capture' }],
        { responseSchema: taskSchema('tasks') }
      )
    ).rejects.toThrow('OpenRouter model request failed. Try again shortly.');

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      response_format: { type: 'json_object' },
    });
  });

  function transportService() {
    const service = new AssistantService({} as never, {} as never, {} as never);
    service.ensureWithinUsageBudget = async () => undefined;
    service.recordCost = async () => undefined;
    return service;
  }

  function taskSchema(property: string) {
    return {
      type: 'object',
      properties: { [property]: { type: 'array' } },
      required: [property],
      additionalProperties: false,
    };
  }

  function response(status: number, body: unknown) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  }
});
