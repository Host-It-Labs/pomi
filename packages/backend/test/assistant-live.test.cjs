const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { config } = require('dotenv');

config({ path: path.join(process.cwd(), 'packages', 'backend', '.env') });

const {
  AssistantInputInterpreter,
} = require('../dist/src/assistant/assistant-input-interpreter');
const { AssistantService } = require('../dist/src/assistant/assistant.service');

const MODEL = 'google/gemini-2.5-flash-lite';
const TODAY = '2026-07-22';
const liveTestOptions =
  process.env.RUN_ASSISTANT_LIVE_TESTS === '1'
    ? {}
    : { skip: 'Set RUN_ASSISTANT_LIVE_TESTS=1 to run the paid live suite.' };
const intentions = [
  { slug: 'computer', title: 'Computer', type: 'work', parentSlug: null },
  { slug: 'tools', title: 'Tools', type: 'work', parentSlug: null },
  {
    slug: 'cooking-groceries',
    title: 'Cooking - Groceries',
    type: 'work',
    parentSlug: null,
  },
  { slug: 'projects', title: 'Projects', type: 'work', parentSlug: null },
  { slug: 'pomi', title: 'Pomi', type: 'work', parentSlug: 'projects' },
  { slug: 'news', title: 'News', type: 'break', parentSlug: null },
];

function requireApiKey() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error(
      'OPENROUTER_API_KEY is required. Put it in packages/backend/.env or the environment.'
    );
  }
}

function createInterpreter() {
  const service = new AssistantService({}, {}, {});
  service.ensureWithinUsageBudget = async () => {};
  service.recordCost = async () => {};
  const interpreter = new AssistantInputInterpreter();
  return {
    interpret(input) {
      return interpreter.interpret({
        mode: input.mode ?? 'taskCapture',
        text: input.text,
        today: TODAY,
        intentions,
        taskTranscriptEnabled: input.taskTranscriptEnabled ?? false,
        taskTranscriptMinWords: input.taskTranscriptMinWords ?? 15,
        requestJson: (messages, options) =>
          service.requestJson('assistant-live-suite', MODEL, messages, options),
      });
    },
  };
}

function hasText(task, pattern) {
  return pattern.test(`${task.title} ${task.description ?? ''}`);
}

function assertCleanTransport(result) {
  for (const call of result.modelCalls) {
    for (const attempt of call.attempts ?? []) {
      assert.equal(attempt.request?.tools, undefined);
      assert.equal(attempt.request?.tool_choice, undefined);
      assert.equal(attempt.request?.reasoning, undefined);
    }
  }
}

test(
  'live assistant capture preserves concrete details and links a supplied intention',
  liveTestOptions,
  async () => {
    requireApiKey();
    const { interpret } = createInterpreter();
    const result = await interpret({
      text: 'Schedule the mortgage payment for the lake house under the Computer intention.',
    });

    assert.equal(result.tasks.length, 1);
    assertCleanTransport(result);
    assert.equal(result.tasks[0].intentionSlug, 'computer');
    assert.match(
      `${result.tasks[0].title} ${result.tasks[0].description ?? ''}`,
      /mortgage/i
    );
    assert.match(
      `${result.tasks[0].title} ${result.tasks[0].description ?? ''}`,
      /house/i
    );
  }
);

test(
  'live assistant capture resolves a spoken partial groceries intention to the supplied slug',
  liveTestOptions,
  async () => {
    requireApiKey();
    const { interpret } = createInterpreter();
    const result = await interpret({
      text: 'Add garlic powder to the groceries intention.',
    });

    assert.equal(result.tasks.length, 1);
    assertCleanTransport(result);
    assert.equal(result.tasks[0].intentionSlug, 'cooking-groceries');
    assert.ok(hasText(result.tasks[0], /garlic powder|tofu|oat cream/i));
  }
);

test(
  'live assistant capture separates independent enumerated items but keeps one detailed outcome together',
  liveTestOptions,
  async () => {
    requireApiKey();
    const { interpret } = createInterpreter();
    const itemList = await interpret({
      text: 'Add tofu, seitan, and vegan milk to the groceries intention.',
    });

    assertCleanTransport(itemList);
    assert.equal(
      itemList.tasks.length,
      3,
      JSON.stringify({ tasks: itemList.tasks, calls: itemList.modelCalls })
    );
    assert.ok(
      ['tofu', 'seitan', 'vegan milk'].every(item =>
        itemList.tasks.some(task => hasText(task, new RegExp(item, 'i')))
      ),
      'expected one Task for each independent list item'
    );
    assert.ok(
      itemList.tasks.every(task => task.intentionSlug === 'cooking-groceries'),
      'expected every list item to retain the supplied Intention'
    );

    const detailedOutcome = await interpret({
      text: 'Implement the vacation feature in the Pomi project with date ranges, a travel summary, and blocked dates.',
    });

    assertCleanTransport(detailedOutcome);
    assert.equal(
      detailedOutcome.tasks.length,
      1,
      JSON.stringify({
        tasks: detailedOutcome.tasks,
        calls: detailedOutcome.modelCalls,
      })
    );
    assert.ok(
      hasText(
        detailedOutcome.tasks[0],
        /vacation|date ranges|travel summary|blocked dates/i
      ),
      'expected the larger outcome to retain its details'
    );
  }
);

test(
  'live assistant capture merges an interleaved continuation into its original outcome',
  liveTestOptions,
  async () => {
    requireApiKey();
    const { interpret } = createInterpreter();
    const result = await interpret({
      text: 'In the Pomi project, add a vacation mode feature that blocks dates and shows a travel summary. Also remind me to renew the domain on Friday under Computer. Back to the vacation feature: make the date picker support date ranges.',
    });

    assert.equal(
      result.tasks.length,
      2,
      JSON.stringify({
        tasks: result.tasks,
        notes: result.resolutionNotes,
        calls: result.modelCalls,
        error: result.error,
        fallback: result.usedFallback,
      })
    );
    assertCleanTransport(result);
    const pomiTask = result.tasks.find(
      task =>
        task.intentionSlug === 'projects' && task.subIntentionSlug === 'pomi'
    );
    assert.ok(pomiTask, 'expected one Pomi project task');
    assert.ok(
      hasText(pomiTask, /vacation|date picker|date range|travel summary/i),
      'expected the continuation details on the Pomi task'
    );
    assert.equal(
      result.tasks.find(task => task.intentionSlug === 'computer')?.priority,
      'normal'
    );
  }
);

test(
  'live assistant capture omits a transcript when metadata leaves a short core request',
  liveTestOptions,
  async () => {
    requireApiKey();
    const { interpret } = createInterpreter();
    const result = await interpret({
      text: 'Check the parcel downstairs every week starting tomorrow, mark urgent, under Tools intention.',
      taskTranscriptEnabled: true,
      taskTranscriptMinWords: 15,
    });

    assert.equal(result.tasks.length, 1);
    assertCleanTransport(result);
    assert.equal(result.tasks[0].intentionSlug, 'tools');
    assert.equal(result.tasks[0].priority, 'urgent');
    assert.equal(result.tasks[0].sourceTranscript, null);
  }
);

test(
  'live voice capture keeps timer classification separate from Task type',
  liveTestOptions,
  async () => {
    requireApiKey();
    const { interpret } = createInterpreter();
    let result;
    try {
      result = await interpret({
        mode: 'voiceCommand',
        text: 'Start a break timer and add a note to the Pomi project to check the garden light.',
      });
    } catch (error) {
      const diagnostics = error?.diagnostics;
      throw new Error(
        `${error?.message ?? error}: ${JSON.stringify(diagnostics?.modelCalls ?? [])}`
      );
    }

    assert.equal(result.timerCommand.action, 'startTimer');
    assertCleanTransport(result);
    assert.equal(result.timerCommand.timerType, 'break');
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].timerType, 'work');
  }
);
