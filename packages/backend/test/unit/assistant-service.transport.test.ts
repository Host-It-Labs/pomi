import { z } from 'zod';
import {
  assistantCaptureSchema,
  assistantVoiceSchema,
  assistantReviewSchema,
  assistantDescriptionsSchema,
} from '../../src/assistant/assistant-output-schemas';
import { captureObject, modelTask } from '../helpers/assistant-output';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../../src/assistant/assistant.service';
import { AssistantInputInterpreter } from '../../src/assistant/assistant-input-interpreter';

const emptyCapture = captureObject({});
const capturePayload = {
  tasks: emptyCapture.tasks,
  confidence: emptyCapture.confidence,
  reviewRequired: emptyCapture.reviewRequired,
  unresolvedMetadata: emptyCapture.unresolvedMetadata,
  responseLanguage: emptyCapture.responseLanguage,
};
const captureContent = JSON.stringify(capturePayload);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AssistantService transport', () => {
  it('sends the Zod-derived strict schema without tools, reasoning, or retries', async () => {
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
              choices: [{ message: { content: captureContent } }],
              usage: { cost: 0 },
            }),
        };
      })
    );
    const service = new AssistantService({} as never, {} as never, {} as never);
    service.ensureWithinUsageBudget = async () => undefined;
    service.recordCost = async () => undefined;

    await service.requestObject(
      'user-1',
      'google/gemini-2.5-flash-lite',
      [{ role: 'user', content: 'capture this' }],
      {
        schema: assistantCaptureSchema,
        schemaName: 'taskCapture',
      }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'taskCapture', strict: true },
      },
      usage: { include: true },
    });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]).not.toHaveProperty('tool_choice');
    expect(requests[0]).not.toHaveProperty('reasoning');
    expect(requests[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'taskCapture',
        strict: true,
        schema: z.toJSONSchema(assistantCaptureSchema, { target: 'draft-7' }),
      },
    });
  });

  it.each([
    [
      'capture',
      assistantCaptureSchema,
      { ...capturePayload, tasks: [modelTask({ title: 'Buy milk' })] },
    ],
    ['review', assistantReviewSchema, capturePayload],
    [
      'voice',
      assistantVoiceSchema,
      captureObject({
        timerAction: {
          action: 'startTimer',
          timerType: 'work',
          intentionSlugs: ['projects'],
          subIntentions: [
            { intentionSlug: 'projects', subIntentionSlug: 'pomi' },
          ],
        },
      }),
    ],
    [
      'descriptions',
      assistantDescriptionsSchema,
      {
        descriptions: [
          { kind: 'list', id: 'list-1', description: 'Groceries to buy.' },
        ],
      },
    ],
  ] as const)(
    'validates the %s contract using the schema sent to OpenRouter',
    async (schemaName, schema, object) => {
      vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
      const fetch = vi.fn(async () =>
        response(200, {
          choices: [{ message: { content: JSON.stringify(object) } }],
          usage: { cost: 0.0042 },
        })
      );
      vi.stubGlobal('fetch', fetch);
      const service = transportService();
      service.recordCost = vi.fn(async () => undefined);
      const result = await service.requestObject('user-1', 'test/model', [], {
        schema,
        schemaName,
      });
      await result.usagePersistence;

      expect(result.object).toEqual(object);
      expect(service.recordCost).toHaveBeenCalledExactlyOnceWith(
        'user-1',
        'chat',
        0.0042
      );
      expect(result.modelCall).toMatchObject({
        provider: 'openrouter',
        stage: 'initial',
        content: JSON.stringify(object),
        costUsd: 0.0042,
        attempts: [{ status: 200, error: null }],
        durationMs: expect.any(Number),
      });
      expect(result.modelCall.request).toEqual(
        result.modelCall.attempts[0].request
      );
      expect(result.modelCall.response).toEqual(
        result.modelCall.attempts[0].response
      );
    }
  );

  it.each([
    'not json',
    '```json\n' + captureContent + '\n```',
    'Here is the result: ' + captureContent,
    '[]',
    '{}',
    JSON.stringify({
      ...capturePayload,
      confidence: { ...capturePayload.confidence, title: 'certain' },
    }),
    JSON.stringify({ ...capturePayload, unexpected: true }),
    JSON.stringify({
      ...capturePayload,
      tasks: [modelTask({ title: 'Buy milk', priority: 'critical' as never })],
    }),
    JSON.stringify({
      ...capturePayload,
      tasks: [modelTask({ title: 'Buy milk', sourceSegments: [] })],
    }),
    JSON.stringify({
      ...capturePayload,
      tasks: [
        modelTask({ title: 'Buy milk', recurrenceInterval: '2' as never }),
      ],
    }),
    JSON.stringify({ ...capturePayload, tasks: [{ title: 'Buy milk' }] }),
    JSON.stringify({
      ...capturePayload,
      tasks: Array.from({ length: 26 }, () => modelTask({ title: 'Buy milk' })),
    }),
  ])(
    'rejects invalid model output without repair and still records its cost: %#',
    async content => {
      vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
      const fetch = vi.fn(async () =>
        response(200, {
          choices: [{ message: { content } }],
          usage: { cost: 0.002 },
        })
      );
      vi.stubGlobal('fetch', fetch);
      const service = transportService();
      service.recordCost = vi.fn(async () => undefined);

      await expect(
        service.requestObject('user-1', 'test/model', [], {
          schema: assistantCaptureSchema,
          schemaName: 'taskCapture',
          language: 'fr',
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'La réponse de l’assistant n’était pas un JSON valide.',
        modelCall: { content, costUsd: 0.002, attempts: [{ status: 200 }] },
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(service.recordCost).toHaveBeenCalledExactlyOnceWith(
        'user-1',
        'chat',
        0.002
      );
    }
  );

  it('rejects legacy tool calls rather than merging unvalidated arguments', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(200, {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'create_tasks',
                      arguments: captureContent,
                    },
                  },
                ],
              },
            },
          ],
          usage: { cost: 0.001 },
        })
      )
    );
    await expect(
      transportService().requestObject('user-1', 'test/model', [], {
        schema: assistantCaptureSchema,
        schemaName: 'taskCapture',
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('retains valid extraction and accounts for a schema-invalid optional review', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const first = {
      ...capturePayload,
      reviewRequired: true,
      tasks: [modelTask({ title: 'Buy milk' })],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          choices: [{ message: { content: JSON.stringify(first) } }],
          usage: { cost: 0.01 },
        })
      )
      .mockResolvedValueOnce(
        response(200, {
          choices: [{ message: { content: '{}' } }],
          usage: { cost: 0.02 },
        })
      );
    vi.stubGlobal('fetch', fetch);
    const service = transportService();
    service.recordCost = vi.fn(async () => undefined);

    const result = await new AssistantInputInterpreter().interpret({
      mode: 'taskCapture',
      text: 'Buy milk',
      today: '2026-10-21',
      intentions: [],
      requestObject: (messages, options) =>
        service.requestObject('user-1', 'test/model', messages, options),
    });

    expect(result.tasks).toMatchObject([{ title: 'Buy milk' }]);
    expect(result.usedFallback).toBe(false);
    expect(result.costUsd).toBe(0.03);
    expect(result.modelCalls).toMatchObject([
      { stage: 'initial', costUsd: 0.01 },
      { stage: 'review', costUsd: 0.02 },
    ]);
    expect(service.recordCost).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not call OpenRouter when the per-user budget check rejects the request', async () => {
    const service = transportService();
    service.ensureWithinUsageBudget = vi.fn(async () => {
      throw new Error('budget exhausted');
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      service.requestObject('user-1', 'test/model', [], {
        schema: assistantCaptureSchema,
        schemaName: 'taskCapture',
      })
    ).rejects.toThrow('budget exhausted');
    expect(service.ensureWithinUsageBudget).toHaveBeenCalledExactlyOnceWith(
      'user-1'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a valid response without inventing a missing usage cost', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(200, { choices: [{ message: { content: captureContent } }] })
      )
    );
    const service = transportService();
    service.recordCost = vi.fn(async () => undefined);
    const warning = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);
    const result = await service.requestObject('user-1', 'test/model', [], {
      schema: assistantCaptureSchema,
      schemaName: 'taskCapture',
    });
    expect(result.costUsd).toBe(0);
    expect(service.recordCost).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      'OpenRouter chat response did not include usage.cost.'
    );
  });

  it('preserves endpoint settings and application headers', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://router.example/api/v1');
    vi.stubEnv('OPENROUTER_HTTP_REFERER', 'https://pomi.example');
    const fetch = vi.fn(async () =>
      response(200, {
        choices: [{ message: { content: captureContent } }],
        usage: { cost: 0 },
      })
    );
    vi.stubGlobal('fetch', fetch);
    const result = await transportService().requestObject(
      'user-1',
      'test/model',
      [],
      { schema: assistantCaptureSchema, schemaName: 'taskCapture' }
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://router.example/api/v1/chat/completions',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://pomi.example',
          'X-Title': 'Pomi',
        },
        signal: expect.any(AbortSignal),
      })
    );
    expect(result.modelCall.endpoint).toBe(
      'https://router.example/api/v1/chat/completions'
    );
  });

  it('aborts the provider request after 30 seconds without retries', async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
      const fetch = vi.fn(
        (_input, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new Error('aborted'))
            );
          })
      );
      vi.stubGlobal('fetch', fetch);
      const request = transportService().requestObject(
        'user-1',
        'test/model',
        [],
        { schema: assistantCaptureSchema, schemaName: 'taskCapture' }
      );
      const assertion = expect(request).rejects.toMatchObject({
        modelCall: { attempts: [{ status: null, error: 'Error' }] },
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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
            choices: [{ message: { content: captureContent } }],
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

    await service.requestObject(
      'user-1',
      'google/gemini-2.5-flash-lite',
      [{ role: 'user', content: 'capture this' }],
      { schema: assistantCaptureSchema, schemaName: 'taskCapture' },
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
            choices: [{ message: { content: captureContent } }],
            usage: { cost: 0.001 },
          }),
      }))
    );
    const service = new AssistantService(
      {} as never,
      usageRepository as never,
      {} as never
    );

    const response = await service.requestObject(
      'user-1',
      'google/gemini-2.5-flash-lite',
      [{ role: 'user', content: 'capture this' }],
      { schema: assistantCaptureSchema, schemaName: 'taskCapture' },
      '2026-07-27'
    );

    expect(response.object.tasks).toEqual([]);
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

  it('does not retry a rejected structured output request', async () => {
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
      service.requestObject(
        'user-1',
        'test/model',
        [{ role: 'user', content: 'capture' }],
        { schema: assistantCaptureSchema, schemaName: 'taskCapture' }
      )
    ).rejects.toThrow('OpenRouter model request failed. Try again shortly.');

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'taskCapture', strict: true },
      },
      usage: { include: true },
    });
  });

  function transportService() {
    const service = new AssistantService({} as never, {} as never, {} as never);
    service.ensureWithinUsageBudget = async () => undefined;
    service.recordCost = async () => undefined;
    return service;
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
