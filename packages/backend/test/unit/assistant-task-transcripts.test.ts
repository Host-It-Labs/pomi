import assert from 'node:assert/strict';
import { test } from 'vitest';

import { AssistantInputInterpreter } from '../../src/assistant/assistant-input-interpreter';

const intentions = [
  { slug: 'groceries', title: 'Groceries', type: 'work', parentSlug: null },
];

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

function response(tasks) {
  return {
    content: JSON.stringify({ tasks, ...confidence }),
    costUsd: 0,
  };
}

test('keeps descriptions concise and leaves transcripts disabled by default', async () => {
  const text =
    'Buy milk for the week and remember to compare the organic options at the store';
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-22',
    intentions,
    requestJson: async () =>
      response([
        {
          title: 'Milk',
          description:
            'Buy milk for the week and remember to compare the organic options at the store',
          sourceSegments: [text],
          intentionSlug: 'groceries',
        },
      ]),
  });

  assert.equal(result.tasks[0].sourceTranscript, null);
  assert.equal(result.tasks[0].description, null);
});

test('stores one exact transcript per enabled Task above the strict word threshold', async () => {
  const first = 'Plan the migration checklist and confirm the rollback steps';
  const second = 'Then send the release announcement to the customer team';
  const text = `${first}. ${second}.`;
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-22',
    intentions,
    taskTranscriptEnabled: true,
    taskTranscriptMinWords: 5,
    requestJson: async () =>
      response([
        {
          title: 'Migration checklist',
          description: null,
          sourceSegments: [first],
        },
        {
          title: 'Release announcement',
          description: null,
          sourceSegments: [second, second],
        },
      ]),
  });

  assert.equal(result.tasks[0].sourceTranscript, first);
  assert.equal(result.tasks[1].sourceTranscript, second);
});

test('does not store a transcript at the configured word threshold', async () => {
  const text = 'Keep this short task exactly as written';
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-22',
    intentions,
    taskTranscriptEnabled: true,
    taskTranscriptMinWords: 7,
    requestJson: async () =>
      response([{ title: 'Keep short task', sourceSegments: [text] }]),
  });

  assert.equal(result.tasks[0].sourceTranscript, null);
});

test('preserves exact URLs in concise descriptions without copying source passages', async () => {
  const text =
    'Review the API proposal and include https://example.com/proposal in the task details';
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-22',
    intentions,
    taskTranscriptEnabled: true,
    taskTranscriptMinWords: 4,
    requestJson: async () =>
      response([
        {
          title: 'Review API proposal',
          description: text,
          sourceSegments: [text],
        },
      ]),
  });

  assert.equal(result.tasks[0].description, 'https://example.com/proposal');
  assert.equal(result.tasks[0].sourceTranscript, text);
});

test('removes repeated transcript passages from the description', async () => {
  const text =
    'Describe the rollout steps, verify the migration, and notify the team';
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-22',
    intentions,
    taskTranscriptEnabled: true,
    taskTranscriptMinWords: 4,
    requestJson: async () =>
      response([
        {
          title: 'Describe rollout steps',
          description: `Transcript: ${text}\n\n${text}\n\n${text}`,
          sourceSegments: [text],
        },
      ]),
  });

  assert.equal(result.tasks[0].description, null);
  assert.equal(result.tasks[0].sourceTranscript, text);
});

test('removes implicit linked category context from a Task title', async () => {
  const text = 'I need some Groceries, please buy milk and eggs';
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-22',
    intentions,
    requestJson: async () =>
      response([
        {
          title: 'Buy groceries milk and eggs',
          sourceSegments: [text],
          intentionSlug: 'groceries',
        },
      ]),
  });

  assert.equal(result.tasks[0].title, 'Buy milk and eggs');
});
