import assert from 'node:assert/strict';
import { test } from 'vitest';

import { AssistantInputInterpreter } from '../../src/assistant/assistant-input-interpreter';

const confidence = {
  reviewRequired: false,
  confidence: {
    title: 'high',
    dueDate: 'high',
    dueTime: 'high',
    recurrence: 'high',
    priority: 'high',
    intention: 'high',
  },
  unresolvedMetadata: [],
};

function run(interpreter, { text, intentions, tasks, ...options }) {
  return interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-22',
    intentions,
    ...options,
    requestJson: async () => ({
      content: JSON.stringify({ tasks, ...confidence }),
      costUsd: 0,
    }),
  });
}

test('preserves concrete source details omitted from a concise title', async () => {
  const interpreter = new AssistantInputInterpreter();
  const text = 'pay rent on morgage of house computer intention';
  const result = await run(interpreter, {
    text,
    intentions: [
      { slug: 'computer', title: 'Computer', type: 'work', parentSlug: null },
    ],
    tasks: [
      {
        title: 'Mortgage payment',
        description: null,
        sourceSegments: ['pay rent on morgage of house'],
        essentialDetails: ['house'],
        outcomeKey: 'mortgage',
        intentionSlug: 'computer',
      },
    ],
  });

  assert.equal(result.tasks[0].title, 'Mortgage payment');
  assert.equal(result.tasks[0].description, 'house');
});

test('retains a valid supplied slug when ASR only says a partial title', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await run(interpreter, {
    text: 'garlic powder and tofu to groceries intention',
    intentions: [
      {
        slug: 'cooking-groceries',
        title: 'Cooking - Groceries',
        type: 'work',
        parentSlug: null,
      },
    ],
    tasks: [
      {
        title: 'Garlic powder and tofu',
        description: null,
        sourceSegments: ['garlic powder and tofu to groceries intention'],
        essentialDetails: ['garlic powder and tofu'],
        outcomeKey: 'groceries',
        intentionSlug: 'cooking-groceries',
        intentionMention: 'groceries intention',
      },
    ],
  });

  assert.equal(result.tasks[0].intentionSlug, 'cooking-groceries');
});

test('does not preserve an ambiguous parent without a child match', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await run(interpreter, {
    text: 'review project planning',
    intentions: [
      { slug: 'projects', title: 'Projects', type: 'work', parentSlug: null },
      { slug: 'pomi', title: 'Pomi', type: 'work', parentSlug: 'projects' },
    ],
    tasks: [
      {
        title: 'Review project planning',
        sourceSegments: ['review project planning'],
        outcomeKey: 'review',
        intentionSlug: 'projects',
      },
    ],
  });

  assert.equal(result.tasks[0].intentionSlug, null);
  assert.equal(result.tasks[0].subIntentionSlug, null);
  assert.match(
    result.resolutionNotes.join(' '),
    /requires a uniquely matched Sub-intention/
  );
});

test('keeps explicit model timer type ahead of conflicting transcript wording', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'voiceCommand',
    text: 'Start a break timer and add a note to review the lights.',
    today: '2026-07-22',
    intentions: [],
    requestJson: async () => ({
      content: JSON.stringify({
        tasks: [],
        timerAction: { action: 'startTimer', timerType: 'work' },
        ...confidence,
      }),
      costUsd: 0,
    }),
  });

  assert.equal(result.timerCommand.timerType, 'work');
});

test('applies a contextual timer type default when the model omits it', async () => {
  const result = await run(new AssistantInputInterpreter(), {
    text: 'Stretch for five minutes',
    intentions: [],
    defaults: { timerType: 'break' },
    tasks: [
      {
        title: 'Stretch for five minutes',
        sourceSegments: ['Stretch for five minutes'],
        outcomeKey: 'stretch',
      },
    ],
  });

  assert.equal(result.tasks[0].timerType, 'break');
});

test('merges interleaved continuation passages sharing one outcome key', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await run(interpreter, {
    text: 'add vacation mode. pay the fee. also make intentions vacation compatible.',
    intentions: [],
    tasks: [
      {
        title: 'Add vacation mode',
        description: null,
        sourceSegments: ['add vacation mode'],
        essentialDetails: ['vacation mode'],
        outcomeKey: 'vacation',
      },
      {
        title: 'Pay the fee',
        description: null,
        sourceSegments: ['pay the fee'],
        essentialDetails: ['fee'],
        outcomeKey: 'fee',
      },
      {
        title: 'Add vacation mode',
        description: null,
        sourceSegments: ['also make intentions vacation compatible'],
        essentialDetails: ['intentions vacation compatible'],
        outcomeKey: 'vacation',
      },
    ],
  });

  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].sourceTranscript, null);
  assert.match(result.tasks[0].description, /intentions vacation compatible/);
});

test('merges a marked continuation when the model uses different outcome keys', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await run(interpreter, {
    text: 'In the Pomi project, add a vacation mode feature. Also renew the domain. Back to the vacation feature: support date ranges.',
    intentions: [
      { slug: 'projects', title: 'Projects', type: 'work', parentSlug: null },
      { slug: 'pomi', title: 'Pomi', type: 'work', parentSlug: 'projects' },
    ],
    tasks: [
      {
        title: 'Add vacation mode',
        sourceSegments: ['In the Pomi project, add a vacation mode feature.'],
        essentialDetails: ['vacation mode'],
        outcomeKey: 'vacation-mode',
        intentionSlug: 'pomi',
      },
      {
        title: 'Renew the domain',
        sourceSegments: ['Also renew the domain.'],
        essentialDetails: ['domain'],
        outcomeKey: 'domain',
        intentionSlug: null,
      },
      {
        title: 'Support date ranges for vacation feature',
        sourceSegments: ['Back to the vacation feature: support date ranges.'],
        essentialDetails: ['date ranges'],
        outcomeKey: 'date-ranges',
        intentionSlug: 'pomi',
      },
    ],
  });

  assert.equal(result.tasks.length, 2);
  assert.match(result.tasks[0].description ?? '', /date ranges/i);
});

test('does not create a transcript when only metadata pushes a short action over the threshold', async () => {
  const interpreter = new AssistantInputInterpreter();
  const text =
    'check a bag downstairs every week starting tomorrow urgent to Tools intention';
  const result = await run(interpreter, {
    text,
    intentions: [
      { slug: 'tools', title: 'Tools', type: 'work', parentSlug: null },
    ],
    taskTranscriptEnabled: true,
    taskTranscriptMinWords: 5,
    tasks: [
      {
        title: 'Check a bag downstairs',
        description: null,
        sourceSegments: [text],
        essentialDetails: ['bag downstairs'],
        outcomeKey: 'bag',
        intentionSlug: 'tools',
        intentionMention: 'Tools intention',
        priority: 'urgent',
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
      },
    ],
  });

  assert.equal(result.tasks[0].sourceTranscript, null);
});

test('corrects a short ASR Intention spelling against supplied vocabulary', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await run(interpreter, {
    text: 'add the vacation feature to POMMY project',
    intentions: [
      { slug: 'projects', title: 'Projects', type: 'work', parentSlug: null },
      { slug: 'pomi', title: 'Pomi', type: 'work', parentSlug: 'projects' },
    ],
    tasks: [
      {
        title: 'Add the vacation feature',
        description: null,
        sourceSegments: ['add the vacation feature to POMMY project'],
        essentialDetails: ['vacation feature'],
        outcomeKey: 'feature',
        intentionSlug: 'pomi',
        intentionMention: 'POMMY',
      },
    ],
  });

  assert.equal(result.tasks[0].intentionSlug, 'projects');
  assert.equal(result.tasks[0].subIntentionSlug, 'pomi');
});

test('does not duplicate an explicit voice timer as a Task', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'voiceCommand',
    text: 'Start a break timer and add a note to the Pomi project to check the garden light.',
    today: '2026-07-22',
    intentions: [
      { slug: 'projects', title: 'Projects', type: 'work', parentSlug: null },
      { slug: 'pomi', title: 'Pomi', type: 'work', parentSlug: 'projects' },
      { slug: 'news', title: 'News', type: 'break', parentSlug: null },
    ],
    requestJson: async () => ({
      content: JSON.stringify({
        tasks: [
          {
            title: 'Start a break timer',
            sourceSegments: ['Start a break timer'],
            outcomeKey: 'timer',
          },
          {
            title: 'Check the garden light',
            sourceSegments: [
              'add a note to the Pomi project to check the garden light',
            ],
            intentionSlug: 'pomi',
            outcomeKey: 'note',
          },
        ],
        timerAction: { action: 'startTimer', timerType: 'break' },
        ...confidence,
      }),
      costUsd: 0,
    }),
  });

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, 'Check the garden light');
  assert.equal(result.timerCommand.action, 'startTimer');
  assert.equal(result.timerCommand.timerType, 'break');
});

test('expands an independent list but keeps feature details in one Task', async () => {
  const interpreter = new AssistantInputInterpreter();
  const listResult = await run(interpreter, {
    text: 'Add tofu, seitan, and vegan milk to the groceries intention.',
    intentions: [
      {
        slug: 'cooking-groceries',
        title: 'Cooking - Groceries',
        type: 'work',
        parentSlug: null,
      },
    ],
    tasks: [
      {
        title: 'Add tofu, seitan, and vegan milk',
        description: 'Add grocery items',
        sourceSegments: [
          'Add tofu, seitan, and vegan milk to the groceries intention.',
        ],
        essentialDetails: ['tofu', 'seitan', 'vegan milk'],
        outcomeKey: 'add-groceries',
        intentionSlug: 'cooking-groceries',
        intentionMention: 'groceries intention',
      },
    ],
  });

  assert.equal(listResult.tasks.length, 3);
  assert.deepEqual(
    listResult.tasks.map(task => task.title),
    ['Add tofu', 'Add seitan', 'Add vegan milk']
  );
  assert.ok(
    listResult.tasks.every(task => task.intentionSlug === 'cooking-groceries')
  );

  const noisyListResult = await run(interpreter, {
    text: 'Add tofu, seitan, and vegan milk to the groceries intention.',
    intentions: [
      {
        slug: 'cooking-groceries',
        title: 'Cooking - Groceries',
        type: 'work',
        parentSlug: null,
      },
    ],
    tasks: [
      {
        title: 'Add tofu, seitan, and vegan milk to groceries',
        sourceSegments: [
          'Add tofu, seitan, and vegan milk to the groceries intention.',
        ],
        outcomeKey: 'add-groceries',
        intentionSlug: 'cooking-groceries',
      },
      {
        title: 'Set reminder for groceries intention',
        sourceSegments: [
          'Add tofu, seitan, and vegan milk to the groceries intention.',
        ],
        outcomeKey: 'set-reminder',
        intentionSlug: 'cooking-groceries',
      },
    ],
  });

  assert.deepEqual(
    noisyListResult.tasks.map(task => task.title),
    ['Add tofu', 'Add seitan', 'Add vegan milk']
  );

  const detailResult = await run(interpreter, {
    text: 'Implement the vacation feature in the Pomi project with date ranges, a travel summary, and blocked dates.',
    intentions: [
      { slug: 'projects', title: 'Projects', type: 'work', parentSlug: null },
      { slug: 'pomi', title: 'Pomi', type: 'work', parentSlug: 'projects' },
    ],
    tasks: [
      {
        title: 'Implement the vacation feature',
        sourceSegments: [
          'Implement the vacation feature in the Pomi project with date ranges, a travel summary, and blocked dates.',
        ],
        essentialDetails: ['date ranges', 'a travel summary', 'blocked dates'],
        outcomeKey: 'vacation-feature',
        intentionSlug: 'pomi',
        subIntentionSlug: null,
      },
    ],
  });

  assert.equal(detailResult.tasks.length, 1);
  assert.match(detailResult.tasks[0].description ?? '', /date ranges/i);

  const metadataResult = await run(interpreter, {
    text: 'Check the parcel downstairs every week starting tomorrow, mark urgent, under Tools intention.',
    intentions: [
      { slug: 'tools', title: 'Tools', type: 'work', parentSlug: null },
    ],
    tasks: [
      {
        title: 'Check the parcel downstairs',
        sourceSegments: [
          'Check the parcel downstairs every week starting tomorrow, mark urgent, under Tools intention.',
        ],
        outcomeKey: 'parcel',
        intentionSlug: 'tools',
        priority: 'urgent',
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
      },
    ],
  });

  assert.equal(metadataResult.tasks.length, 1);
});

test('caps independently expanded lists at the Assistant task limit', async () => {
  const interpreter = new AssistantInputInterpreter();
  const items = Array.from({ length: 30 }, (_, index) => `item-${index + 1}`);
  const text = `Add ${items.join(', ')} to the groceries intention.`;
  const result = await run(interpreter, {
    text,
    intentions: [
      { slug: 'groceries', title: 'Groceries', type: 'work', parentSlug: null },
    ],
    tasks: [
      {
        title: items.join(', '),
        sourceSegments: [text],
        essentialDetails: items,
        outcomeKey: 'groceries',
        intentionSlug: 'groceries',
      },
    ],
  });

  assert.equal(result.tasks.length, 25);
  assert.equal(result.tasks[0].title, 'Add item-1');
  assert.equal(result.tasks.at(-1).title, 'Add item-25');
});

test('rejects overlapping source ownership instead of creating a fallback Task', async () => {
  const interpreter = new AssistantInputInterpreter();
  const extraction = {
    tasks: [
      {
        title: 'Buy milk',
        sourceSegments: ['Buy milk'],
        outcomeKey: 'milk',
      },
      {
        title: 'Buy milk today',
        sourceSegments: ['Buy milk today'],
        outcomeKey: 'milk-today',
      },
    ],
    ...confidence,
  };
  const responses = [extraction, extraction];

  await assert.rejects(
    interpreter.interpret({
      mode: 'taskCapture',
      text: 'Buy milk today',
      today: '2026-07-22',
      intentions: [],
      requestJson: async () => ({
        content: JSON.stringify(responses.shift()),
        costUsd: 0,
      }),
    }),
    /Assistant source evidence was invalid/
  );
  assert.equal(responses.length, 0);
});
