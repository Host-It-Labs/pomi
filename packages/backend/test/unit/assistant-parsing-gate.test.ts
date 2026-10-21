import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantCaptureService } from '../../src/assistant/assistant-capture.service';
import { AssistantModelRequestError } from '../../src/assistant/assistant-input-types';
import { AssistantInputInterpreter } from '../../src/assistant/assistant-input-interpreter';
import { AssistantListRoutingService } from '../../src/assistant/assistant-list-routing.service';
import {
  assistantParsingGateAnswersSchema,
  buildParsingGateRequest,
  PARSING_GATE_MODEL,
  readParsingGateDecision,
  shouldAskParsingGate,
} from '../../src/assistant/assistant-parsing-gate';
import { AssistantService } from '../../src/assistant/assistant.service';
import type { PreparedAssistantTaskCapture } from '../../src/assistant/assistant-task-preparation.store';
import { captureObject } from '../helpers/assistant-output';

const intentions = [
  {
    slug: 'cooking-groceries',
    title: 'Cooking - Groceries',
    type: 'work' as const,
    parentSlug: null,
    description: null,
  },
  {
    slug: 'projects',
    title: 'Projects',
    type: 'work' as const,
    parentSlug: null,
    description: null,
  },
  {
    slug: 'pomi',
    title: 'Pomi',
    type: 'work' as const,
    parentSlug: 'projects',
    description: 'The Pomodoro app',
  },
];

function answers(localParse: number, choice: string, probability: number) {
  return {
    localParse: { noul: localParse },
    intention: { choice, probabilities: { [choice]: probability } },
  };
}

function gateCall(costUsd: number) {
  return {
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    stage: 'gate' as const,
    request: {},
    attempts: [],
    costUsd,
    durationMs: 1,
  };
}

function createCaptureService(
  requestDecision: AssistantService['requestDecision']
) {
  const assistantService = {
    prepareRequest: vi.fn(async () => ({
      settings: { textModel: 'google/gemini-3.5-flash-lite' },
      preferences: {
        language: 'en',
        listsExtension: false,
        taskDefaultDueDateMode: 'off',
        assistantTaskTranscriptsEnabled: false,
        assistantTaskTranscriptMinWords: 15,
      },
      today: '2026-10-21',
    })),
    requestDecision: vi.fn(requestDecision),
    requestObject: vi.fn(
      async (
        _userId: string,
        _model: string,
        messages: Array<{ content: string }>
      ) => {
        const { text } = JSON.parse(messages.at(-1)?.content ?? '{}');
        return {
          object: captureObject({
            tasks: [{ title: text, sourceSegments: [text] }],
          }),
          content: '',
          costUsd: 0.0004,
        };
      }
    ),
  };
  const service = new AssistantCaptureService(
    assistantService as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getActiveIntentionsForAssistant: vi.fn(async () =>
        intentions.map(intention => ({
          ...intention,
          parentIntention: intention.parentSlug
            ? { slug: intention.parentSlug }
            : null,
        }))
      ),
    } as never,
    {
      beginCapture: vi.fn(async () => null),
      recordLog: vi.fn(async () => undefined),
    } as never,
    {} as never,
    { list: vi.fn(async () => []) } as never,
    new AssistantListRoutingService(),
    {} as never
  );
  const prepareTaskCapture = (
    service as unknown as {
      prepareTaskCapture(
        userId: string,
        text: string
      ): Promise<PreparedAssistantTaskCapture>;
    }
  ).prepareTaskCapture.bind(service);
  return { assistantService, prepareTaskCapture };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Assistant parsing gate', () => {
  it('asks only about short single-line input', () => {
    expect(shouldAskParsingGate('Buy milk', intentions, false)).toBe(true);
    expect(shouldAskParsingGate('Buy milk', intentions, true)).toBe(false);
    expect(shouldAskParsingGate('Buy milk\nCall mom', intentions, false)).toBe(
      false
    );
    expect(
      shouldAskParsingGate(
        'one two three four five six seven eight nine ten eleven',
        intentions,
        false
      )
    ).toBe(false);
  });

  it('offers every Intention with its parent and description', () => {
    const request = buildParsingGateRequest('Buy milk', intentions);

    expect(request.state).toEqual({ input: 'Buy milk' });
    expect(request.questions.localParse.type).toBe('noul');
    expect(request.questions.intention.criteria).toMatchObject({
      'cooking-groceries': 'Cooking - Groceries',
      projects: 'Projects',
      pomi: 'Projects / Pomi: The Pomodoro app',
    });
    expect(request.questions.intention.criteria).toHaveProperty([
      'no intention',
    ]);
  });

  it('parses locally only when both answers are confident', () => {
    expect(
      readParsingGateDecision(
        answers(0.95, 'cooking-groceries', 0.9),
        intentions
      )
    ).toEqual({ intentionSlug: 'cooking-groceries', subIntentionSlug: null });
    expect(
      readParsingGateDecision(answers(0.95, 'no intention', 0.9), intentions)
    ).toEqual({ intentionSlug: null, subIntentionSlug: null });
    expect(
      readParsingGateDecision(answers(0.85, 'no intention', 0.99), intentions)
    ).toBeNull();
    expect(
      readParsingGateDecision(answers(0.99, 'projects', 0.5), intentions)
    ).toBeNull();
    expect(
      readParsingGateDecision(answers(0.99, 'unknown', 0.99), intentions)
    ).toBeNull();
  });

  it('keeps a real Intention whose slug resembles the no-intention option', () => {
    const withLookalike = [
      ...intentions,
      {
        slug: 'no-intention',
        title: 'No Intention',
        type: 'work' as const,
        parentSlug: null,
        description: null,
      },
    ];

    expect(
      buildParsingGateRequest('Buy milk', withLookalike).questions.intention
        .criteria
    ).toMatchObject({
      'no intention': 'No existing Intention clearly fits this Task.',
      'no-intention': 'No Intention',
    });
    expect(
      readParsingGateDecision(answers(0.99, 'no-intention', 0.9), withLookalike)
    ).toEqual({ intentionSlug: 'no-intention', subIntentionSlug: null });
  });

  it('leaves a parent with Sub-intentions to the text model', () => {
    expect(
      readParsingGateDecision(answers(0.99, 'projects', 0.99), intentions)
    ).toBeNull();
  });

  it('links a chosen sub-intention under its parent', () => {
    expect(
      readParsingGateDecision(answers(0.99, 'pomi', 0.95), intentions)
    ).toEqual({ intentionSlug: 'projects', subIntentionSlug: 'pomi' });
  });

  it('keeps the decision model Intention over words that match an Intention title', () => {
    const result = new AssistantInputInterpreter().interpretLocally(
      {
        text: 'Fix the bike brakes',
        today: '2026-10-21',
        intentions: [
          ...intentions,
          {
            slug: 'fix',
            title: 'Fix',
            type: 'work',
            parentSlug: 'projects',
            description: null,
          },
        ],
      },
      { intentionSlug: null, subIntentionSlug: null }
    );

    expect(result.tasks[0]).toMatchObject({
      title: 'Fix the bike brakes',
      intentionSlug: null,
      subIntentionSlug: null,
    });
  });

  it.each(['Research priority queues', 'Review due process', 'Read today'])(
    'keeps metadata-like words in the plain title %s',
    text => {
      const result = new AssistantInputInterpreter().interpretLocally(
        { text, today: '2026-10-21', intentions },
        { intentionSlug: null, subIntentionSlug: null }
      );

      expect(result.tasks[0].title).toBe(text);
      expect(result.tasks[0].priority).toBeUndefined();
    }
  );

  it('builds a plain local Task without repeating the input as its description', () => {
    const result = new AssistantInputInterpreter().interpretLocally(
      { text: 'Renew domain high priority', today: '2026-10-21', intentions },
      { intentionSlug: 'projects', subIntentionSlug: 'pomi' }
    );

    expect(result.usedFallback).toBe(false);
    expect(result.modelCalls).toEqual([]);
    expect(result.tasks[0].description).toBeUndefined();
    expect(result.tasks).toEqual([
      expect.objectContaining({
        title: 'Renew domain',
        priority: 'high',
        intentionSlug: 'projects',
        subIntentionSlug: 'pomi',
        timerType: 'work',
      }),
    ]);
  });

  it('keeps a default Intention over the decision model suggestion', () => {
    const result = new AssistantInputInterpreter().interpretLocally(
      {
        text: 'Buy milk',
        today: '2026-10-21',
        intentions,
        defaults: { intentionSlug: 'projects', description: 'From Projects' },
      },
      { intentionSlug: 'cooking-groceries', subIntentionSlug: null }
    );

    expect(result.tasks[0]).toMatchObject({
      intentionSlug: 'projects',
      description: 'From Projects',
    });
  });

  it('creates a plain Task without calling the text model', async () => {
    const context = createCaptureService(async () => ({
      answers: answers(0.99, 'cooking-groceries', 0.97),
      costUsd: 0.000003,
      modelCall: gateCall(0.000003),
    }));

    const prepared = await context.prepareTaskCapture('user-1', 'Buy milk');

    expect(context.assistantService.requestDecision).toHaveBeenCalledWith(
      'user-1',
      PARSING_GATE_MODEL,
      buildParsingGateRequest('Buy milk', intentions),
      assistantParsingGateAnswersSchema,
      '2026-10-21'
    );
    expect(context.assistantService.requestObject).not.toHaveBeenCalled();
    expect(prepared.usedFallback).toBe(false);
    expect(prepared.taskDrafts).toEqual([
      expect.objectContaining({
        title: 'Buy milk',
        intentionSlug: 'cooking-groceries',
      }),
    ]);
    expect(prepared.modelCalls.map(call => call.stage)).toEqual(['gate']);
    expect(prepared.costUsd).toBe(0.000003);
  });

  it('sends input the gate rejects to the text model', async () => {
    const context = createCaptureService(async () => ({
      answers: answers(0.02, 'cooking-groceries', 0.97),
      costUsd: 0.000003,
      modelCall: gateCall(0.000003),
    }));

    const prepared = await context.prepareTaskCapture(
      'user-1',
      'Buy milk tomorrow'
    );

    expect(context.assistantService.requestObject).toHaveBeenCalledOnce();
    expect(prepared.usedFallback).toBe(false);
    expect(prepared.modelCalls.map(call => call.stage)).toEqual(['gate']);
    expect(prepared.costUsd).toBeCloseTo(0.000403);
  });

  it('sends input to the text model when the gate request fails', async () => {
    const context = createCaptureService(async () => {
      throw new AssistantModelRequestError('timed out', gateCall(0));
    });

    const prepared = await context.prepareTaskCapture('user-1', 'Buy milk');

    expect(context.assistantService.requestObject).toHaveBeenCalledOnce();
    expect(prepared.modelCalls.map(call => call.stage)).toEqual(['gate']);
  });

  it('skips the gate for an explicit List destination', async () => {
    const context = createCaptureService(async () => {
      throw new Error('unexpected gate call');
    });

    await context
      .prepareTaskCapture('user-1', 'Add milk to the Groceries list')
      .catch(() => undefined);

    expect(context.assistantService.requestDecision).not.toHaveBeenCalled();
  });

  it('skips the gate for long input', async () => {
    const context = createCaptureService(async () => {
      throw new Error('unexpected gate call');
    });

    await context.prepareTaskCapture(
      'user-1',
      'Buy milk and eggs and bread and coffee and tea for the weekend trip'
    );

    expect(context.assistantService.requestDecision).not.toHaveBeenCalled();
    expect(context.assistantService.requestObject).toHaveBeenCalledOnce();
  });
});

describe('AssistantService decision transport', () => {
  function stubDecisionResponse(status: number, body: unknown) {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit) => {
        requests.push({ url: input, body: JSON.parse(String(init.body)) });
        return {
          status,
          ok: status < 400,
          headers: { get: () => null },
          text: async () => JSON.stringify(body),
        };
      })
    );
    const service = new AssistantService({} as never, {} as never, {} as never);
    const recordCostForLocalDate = vi.fn(async () => undefined);
    Object.assign(service, { recordCostForLocalDate });
    return { service, requests, recordCostForLocalDate };
  }

  it('posts typed questions beside the versioned chat API and records the cost', async () => {
    const context = stubDecisionResponse(200, {
      answers: answers(0.98, 'no intention', 0.99),
      usage: { input_tokens: 120, output_tokens: 0, cost: 0.000003 },
    });
    const request = buildParsingGateRequest('Buy milk', intentions);

    const result = await context.service.requestDecision(
      'user-1',
      PARSING_GATE_MODEL,
      request,
      assistantParsingGateAnswersSchema,
      '2026-10-21'
    );

    expect(context.requests).toEqual([
      {
        url: 'https://openrouter.ai/api/alpha/decisions',
        body: { model: PARSING_GATE_MODEL, ...request },
      },
    ]);
    expect(result.answers.localParse.noul).toBe(0.98);
    expect(result.modelCall).toMatchObject({
      stage: 'gate',
      endpoint: 'https://openrouter.ai/api/alpha/decisions',
      costUsd: 0.000003,
    });
    expect(context.recordCostForLocalDate).toHaveBeenCalledWith(
      'user-1',
      'chat',
      0.000003,
      '2026-10-21'
    );
  });

  it('aborts a decision whose body stalls after its headers', async () => {
    vi.useFakeTimers();
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init: RequestInit) => ({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          ),
      }))
    );
    const service = new AssistantService({} as never, {} as never, {} as never);

    const decision = service.requestDecision(
      'user-1',
      PARSING_GATE_MODEL,
      buildParsingGateRequest('Buy milk', intentions),
      assistantParsingGateAnswersSchema,
      '2026-10-21'
    );
    const rejection = expect(decision).rejects.toBeInstanceOf(
      AssistantModelRequestError
    );
    await vi.advanceTimersByTimeAsync(3_000);

    await rejection;
    vi.useRealTimers();
  });

  it('rejects answers that do not match the requested questions', async () => {
    const context = stubDecisionResponse(200, {
      answers: { localParse: { noul: 0.98 } },
      usage: { cost: 0.000003 },
    });

    await expect(
      context.service.requestDecision(
        'user-1',
        PARSING_GATE_MODEL,
        buildParsingGateRequest('Buy milk', intentions),
        assistantParsingGateAnswersSchema,
        '2026-10-21'
      )
    ).rejects.toBeInstanceOf(AssistantModelRequestError);
    expect(context.recordCostForLocalDate).toHaveBeenCalledOnce();
  });
});
