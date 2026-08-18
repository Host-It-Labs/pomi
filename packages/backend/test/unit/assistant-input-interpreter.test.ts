import assert from 'node:assert/strict';
import { expect, test } from 'vitest';

import { AssistantInputInterpreter } from '../../src/assistant/assistant-input-interpreter';

const intentions = [
  {
    slug: 'groceries',
    title: 'Groceries',
    type: 'work',
    parentSlug: null,
  },
  {
    slug: 'projects',
    title: 'Projects',
    type: 'work',
    parentSlug: null,
  },
  {
    slug: 'client-projects',
    title: 'Client Projects',
    type: 'work',
    parentSlug: null,
  },
  {
    slug: 'pomi',
    title: 'Pomi',
    type: 'work',
    parentSlug: 'projects',
  },
  {
    slug: 'finaversum',
    title: 'Finaversum',
    type: 'work',
    parentSlug: 'projects',
  },
];

function response(content, costUsd?: number) {
  const responseCostUsd = costUsd ?? 0.01;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.tasks)) {
      parsed.tasks = parsed.tasks.map(task =>
        task && typeof task === 'object' && !Array.isArray(task)
          ? {
              sourceSegments:
                Array.isArray(task.sourceSegments) &&
                task.sourceSegments.length > 0
                  ? task.sourceSegments
                  : [task.title ?? ''],
              ...task,
            }
          : task
      );
      return {
        content: JSON.stringify({
          ...parsed,
          ...(typeof parsed.reviewRequired === 'boolean'
            ? {}
            : confidentExtraction),
        }),
        costUsd: responseCostUsd,
      };
    }
  } catch {
    // Preserve malformed model output for repair tests.
  }
  return { content, costUsd: responseCostUsd };
}

const confidentExtraction = {
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

test('uses one AI pass for confident valid Task extraction', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Submit report next Tuesday',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return response(
        JSON.stringify({
          tasks: [{ title: 'Submit report', dueDate: '2026-07-14' }],
          responseLanguage: 'fr-FR',
          ...confidentExtraction,
        })
      );
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.tasks[0].title, 'Submit report');
  assert.equal(result.tasks[0].dueDate, '2026-07-14');
  assert.equal(result.responseLanguage, 'fr-FR');
});

test('normalizes requested due times without inventing date-only times', async () => {
  const interpreter = new AssistantInputInterpreter();
  const interpret = (text: string, dueTime: string | null) =>
    interpreter.interpret({
      mode: 'taskCapture',
      text,
      today: '2026-07-10',
      intentions,
      requestJson: async () =>
        response(
          JSON.stringify({
            tasks: [
              {
                title: 'Plan review',
                sourceSegments: [text],
                dueDate: '2026-07-11',
                dueTime,
              },
            ],
            ...confidentExtraction,
          })
        ),
    });

  await expect(
    interpret('Plan review tomorrow at 7 pm', null)
  ).resolves.toMatchObject({ tasks: [{ dueTime: '19:00' }] });
  await expect(
    interpret('Plan review tomorrow tonight', null)
  ).resolves.toMatchObject({ tasks: [{ dueTime: '20:00' }] });
  await expect(
    interpret('Planificar revisión esta tarde', '18:30')
  ).resolves.toMatchObject({ tasks: [{ dueTime: '18:30' }] });
  await expect(
    interpret('Plan review tomorrow', '09:00')
  ).resolves.toMatchObject({ tasks: [{ dueTime: undefined }] });
  await expect(
    interpret('Plan review tomorrow sometime later', null)
  ).resolves.toMatchObject({
    tasks: [{ dueTime: undefined }],
    resolutionNotes: [
      'Due time is ambiguous; review the requested time before saving.',
    ],
  });
});

test('preserves explicit clock phrases without adopting incidental meeting times', async () => {
  const interpreter = new AssistantInputInterpreter();
  const interpret = (text: string) =>
    interpreter.interpret({
      mode: 'taskCapture',
      text,
      today: '2026-07-10',
      intentions,
      requestJson: async () =>
        response(
          JSON.stringify({
            tasks: [
              {
                title: text,
                sourceSegments: [text],
                dueDate: '2026-07-11',
                dueTime: null,
              },
            ],
            ...confidentExtraction,
          })
        ),
    });

  await expect(
    interpret('Finish report tomorrow 19:00')
  ).resolves.toMatchObject({ tasks: [{ dueTime: '19:00' }] });
  await expect(interpret('Finish report tomorrow noon')).resolves.toMatchObject(
    { tasks: [{ dueTime: '12:00' }] }
  );
  await expect(interpret('Finish report by midnight')).resolves.toMatchObject({
    tasks: [{ dueTime: '00:00' }],
  });
  await expect(
    interpret('Prepare for the 2 pm meeting by 10 am')
  ).resolves.toMatchObject({ tasks: [{ dueTime: '10:00' }] });
  await expect(
    interpret('Review notes from the 3 pm meeting tomorrow')
  ).resolves.toMatchObject({ tasks: [{ dueTime: undefined }] });
});

test('does not retry a valid extraction solely for an ambiguous due time', async () => {
  const interpreter = new AssistantInputInterpreter();
  const text = 'Finish report tomorrow sometime later';
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text,
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return response(
        JSON.stringify({
          tasks: [
            {
              title: 'Finish report',
              sourceSegments: [text],
              dueDate: '2026-07-11',
              dueTime: null,
            },
          ],
          ...confidentExtraction,
        })
      );
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.tasks[0].dueTime, undefined);
  assert.deepEqual(result.resolutionNotes, [
    'Due time is ambiguous; review the requested time before saving.',
  ]);
});

test('accepts a null recurrence interval without an extra review pass', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Submit report',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return response(
        JSON.stringify({
          tasks: [{ title: 'Submit report', recurrenceInterval: null }],
          ...confidentExtraction,
        })
      );
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.tasks[0].recurrenceInterval, undefined);
});

test('reviews otherwise valid extraction when review metadata is missing', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Submit report',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return calls === 1
        ? {
            content: JSON.stringify({ tasks: [{ title: 'Submit report' }] }),
            costUsd: 0.01,
          }
        : response(
            JSON.stringify({ tasks: [{ title: 'Submit report' }] }),
            0.02
          );
    },
  });

  assert.equal(calls, 2);
});

test('keeps valid first extraction when review output is structurally unusable', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Submit report next Tuesday',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return calls === 1
        ? response(
            JSON.stringify({
              tasks: [{ title: 'Submit report', dueDate: '2026-07-14' }],
              reviewRequired: true,
              confidence: {
                ...confidentExtraction.confidence,
                dueDate: 'medium',
              },
              unresolvedMetadata: ['due date'],
            })
          )
        : response(JSON.stringify({ tasks: [{}] }));
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.tasks[0].title, 'Submit report');
  assert.equal(result.tasks[0].dueDate, '2026-07-14');
});

test('preserves timer action when reviewing an uncertain voice Task', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'voiceCommand',
    text: 'Start timer and submit report next Tuesday',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return calls === 1
        ? response(
            JSON.stringify({
              tasks: [{ title: 'Submit report' }],
              timerAction: { action: 'startTimer', timerType: 'work' },
              reviewRequired: true,
              confidence: {
                ...confidentExtraction.confidence,
                dueDate: 'medium',
              },
              unresolvedMetadata: ['due date'],
            })
          )
        : response(
            JSON.stringify({
              tasks: [{ title: 'Submit report', dueDate: '2026-07-14' }],
            })
          );
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.timerCommand.action, 'startTimer');
  assert.equal(result.tasks[0].dueDate, '2026-07-14');
});

test('recovers an explicit voice timer action when the model returns none', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'voiceCommand',
    text: 'Start a break timer and add a note to check the garden light',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [{ title: 'Check the garden light' }],
          timerAction: { action: 'none', timerType: null },
        })
      ),
  });

  assert.equal(result.timerCommand.action, 'startTimer');
  assert.equal(result.timerCommand.timerType, 'break');
});

test('defaults recurring AI Tasks without an explicit due date to tomorrow', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Review metrics every two weeks',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [
            {
              title: 'Review metrics',
              recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2',
            },
          ],
          ...confidentExtraction,
        })
      ),
  });

  assert.equal(result.tasks[0].recurrenceRule, 'FREQ=WEEKLY;INTERVAL=2');
  assert.equal(result.tasks[0].dueDate, '2026-07-11');
});

test('reviews uncertain extraction once and uses corrected Tasks', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Prepare invoice every other week due next Friday urgent',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return calls === 1
        ? response(
            JSON.stringify({
              tasks: [{ title: 'Prepare invoice every other week urgent' }],
              reviewRequired: true,
              confidence: {
                title: 'low',
                dueDate: 'low',
                dueTime: 'low',
                recurrence: 'low',
                priority: 'medium',
                intention: 'high',
              },
              unresolvedMetadata: ['due date', 'recurrence'],
            }),
            0.01
          )
        : response(
            JSON.stringify({
              tasks: [
                {
                  title: 'Prepare invoice',
                  dueDate: '2026-07-17',
                  priority: 'urgent',
                  recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2',
                },
              ],
              ...confidentExtraction,
            }),
            0.02
          );
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.costUsd, 0.03);
  assert.equal(result.tasks[0].title, 'Prepare invoice');
  assert.equal(result.tasks[0].dueDate, '2026-07-17');
  assert.equal(result.tasks[0].priority, 'urgent');
  assert.equal(result.tasks[0].recurrenceRule, 'FREQ=WEEKLY;INTERVAL=2');
  assert.equal(typeof result.timings.modelReviewMs, 'number');
});

test('reviews malformed structured Task metadata even when confidence is high', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Review metrics daily',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return calls === 1
        ? response(
            JSON.stringify({
              tasks: [{ title: 'Review metrics', recurrenceRule: 'daily' }],
              ...confidentExtraction,
            })
          )
        : response(
            JSON.stringify({
              tasks: [
                {
                  title: 'Review metrics',
                  recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
                },
              ],
              ...confidentExtraction,
            })
          );
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.tasks[0].recurrenceRule, 'FREQ=DAILY;INTERVAL=1');
  assert.equal(result.tasks[0].dueDate, '2026-07-11');
});

test('typed and voice modes apply the same task normalization policy', async () => {
  const interpreter = new AssistantInputInterpreter();
  const task = {
    title: 'Buy milk',
    dueDate: '2026-07-11',
    dueTime: '09:00',
    priority: 'urgent',
    intentionMention: 'Grocerries',
  };

  const typed = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy milk for Groceries intention tomorrow at 9 urgent',
    today: '2026-07-10',
    intentions,
    requestJson: async () => response(JSON.stringify({ tasks: [task] })),
  });
  const voice = await interpreter.interpret({
    mode: 'voiceCommand',
    text: 'Buy milk for Groceries intention tomorrow at 9 urgent',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [task],
          timerAction: { action: 'none' },
        })
      ),
  });

  assert.deepEqual(typed.tasks, voice.tasks);
  assert.equal(typed.tasks[0].title, 'Buy milk');
  assert.equal(typed.tasks[0].intentionSlug, 'groceries');
});

test('uses the linked Intention type even when the request mentions a break', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy tea for Groceries intention as a break task',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [
            {
              title: 'Buy tea',
              timerType: 'break',
              intentionMention: 'Groceries',
            },
          ],
        })
      ),
  });

  assert.equal(result.tasks[0].timerType, 'work');
  assert.equal(result.tasks[0].intentionSlug, 'groceries');
  assert.equal(result.tasks[0].description, null);
});

test('links a Break Task to a Break Intention', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Make tea for Recovery intention as a break task',
    today: '2026-07-10',
    intentions: [
      ...intentions,
      {
        slug: 'recovery',
        title: 'Recovery',
        type: 'break',
        parentSlug: null,
      },
    ],
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [
            {
              title: 'Make tea',
              timerType: 'break',
              intentionMention: 'Recovery',
            },
          ],
        })
      ),
  });

  assert.equal(result.tasks[0].timerType, 'break');
  assert.equal(result.tasks[0].intentionSlug, 'recovery');
  assert.equal(result.tasks[0].description, null);
});

test('drops malformed optional recurrence rules from model drafts', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy milk',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [{ title: 'Buy milk', recurrenceRule: 'daily' }],
        })
      ),
  });

  assert.equal(result.tasks[0].recurrenceRule, undefined);
});

test('moves title overflow beyond fifteen words into description', async () => {
  const interpreter = new AssistantInputInterpreter();
  const longTitle =
    'Write the detailed release notes covering migration behavior compatibility risks validation steps rollback instructions and support guidance for customers';
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: longTitle,
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(JSON.stringify({ tasks: [{ title: longTitle }] })),
  });

  assert.equal(result.tasks[0].title.split(/\s+/).length, 15);
  assert.match(result.tasks[0].description, /support guidance for customers/);
});

test('uses a natural boundary near ten words before the flexible maximum', async () => {
  const interpreter = new AssistantInputInterpreter();
  const title =
    'Prepare launch checklist with owners risks and deadlines then coordinate final customer communication';
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: title,
    today: '2026-07-10',
    intentions,
    requestJson: async () => response(JSON.stringify({ tasks: [{ title }] })),
  });

  assert.equal(
    result.tasks[0].title,
    'Prepare launch checklist with owners risks and deadlines'
  );
  assert.match(result.tasks[0].description, /coordinate final customer/);
});

test('resolves confident ASR intention matches and rejects ambiguous parent-only links', async () => {
  const interpreter = new AssistantInputInterpreter();
  const fuzzy = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy milk for intention Grocerries',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(JSON.stringify({ tasks: [{ title: 'Buy milk' }] })),
  });
  const parentOnly = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Review backlog for Projects intention',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(JSON.stringify({ tasks: [{ title: 'Review backlog' }] })),
  });

  assert.equal(fuzzy.tasks[0].intentionSlug, 'groceries');
  assert.equal(parentOnly.tasks[0].intentionSlug, null);
  assert.match(parentOnly.resolutionNotes.join(' '), /Sub-intention/);
});

test('does not retain an inherited intention after an explicit unmatched request', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy milk for Errands intention',
    today: '2026-07-10',
    intentions,
    defaults: { intentionSlug: 'groceries' },
    requestJson: async () =>
      response(JSON.stringify({ tasks: [{ title: 'Buy milk' }] })),
  });

  assert.equal(result.tasks[0].intentionSlug, null);
  assert.match(
    result.resolutionNotes.join(' '),
    /No unique existing intention/
  );
});

test('source intention wording outranks a conflicting valid model slug', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Fix task capture for Pomi intention',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [
            {
              title: 'Fix task capture',
              intentionSlug: 'groceries',
            },
          ],
        })
      ),
  });

  assert.equal(result.tasks[0].title, 'Fix task capture');
  assert.equal(result.tasks[0].intentionSlug, 'projects');
  assert.equal(result.tasks[0].subIntentionSlug, 'pomi');
});

test('resolves separate explicit intentions for separate model drafts', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy milk for Groceries intention and fix capture for Pomi intention',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [
            {
              title: 'Buy milk',
              intentionMention: 'Groceries',
              intentionSlug: 'groceries',
            },
            {
              title: 'Fix capture',
              intentionMention: 'Pomi',
              intentionSlug: 'projects',
              subIntentionSlug: 'pomi',
            },
          ],
        })
      ),
  });

  assert.equal(result.tasks[0].title, 'Buy milk');
  assert.equal(result.tasks[0].intentionSlug, 'groceries');
  assert.equal(result.tasks[1].title, 'Fix capture');
  assert.equal(result.tasks[1].intentionSlug, 'projects');
  assert.equal(result.tasks[1].subIntentionSlug, 'pomi');
});

test('explicit intention marker outranks incidental exact intention words', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Review Pomi behavior for Groceries intention',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(JSON.stringify({ tasks: [{ title: 'Review Pomi behavior' }] })),
  });

  assert.equal(result.tasks[0].intentionSlug, 'groceries');
  assert.equal(result.tasks[0].subIntentionSlug, undefined);
});

test('keeps the clean action title returned by AI', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy milk for Groceries on July 11',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(
        JSON.stringify({
          tasks: [
            {
              title: 'Buy milk',
              dueDate: '2026-07-11',
              intentionSlug: 'groceries',
            },
          ],
        })
      ),
  });

  assert.equal(result.tasks[0].title, 'Buy milk');
});

test('links a confidently named sub-intention with its parent', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Fix task capture for Pomi intention',
    today: '2026-07-10',
    intentions,
    requestJson: async () =>
      response(JSON.stringify({ tasks: [{ title: 'Fix task capture' }] })),
  });

  assert.equal(result.tasks[0].intentionSlug, 'projects');
  assert.equal(result.tasks[0].subIntentionSlug, 'pomi');
});

test('repairs invalid JSON once and counts both model calls', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Buy milk',
    today: '2026-07-10',
    intentions,
    requestJson: async () => {
      calls += 1;
      return calls === 1
        ? response('not json', 0.01)
        : response(JSON.stringify({ tasks: [{ title: 'Buy milk' }] }), 0.02);
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.costUsd, 0.03);
  assert.equal(result.usedFallback, false);
  assert.equal(result.invalidParserOutput, 'not json');
  assert.equal(typeof result.timings.modelRepairMs, 'number');
});

test('creates a safe typed fallback but never guesses a voice task', async () => {
  const interpreter = new AssistantInputInterpreter();
  const requestJson = async () => response('still not json');
  const typed = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Create a task to buy milk for Groceries intention',
    today: '2026-07-10',
    intentions,
    requestJson,
  });

  assert.equal(typed.usedFallback, true);
  assert.equal(typed.tasks[0].title, 'Buy milk');
  assert.equal(typed.tasks[0].intentionSlug, 'groceries');
  assert.match(typed.tasks[0].description, /Create a task to buy milk/);
  assert.doesNotMatch(typed.tasks[0].description, /Original request:/);
  await assert.rejects(
    interpreter.interpret({
      mode: 'voiceCommand',
      text: 'Start my timer',
      today: '2026-07-10',
      intentions,
      requestJson,
    }),
    /Assistant response was not JSON/
  );
});

test('prefers the longest complete explicit intention name in fallback', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Create a task to review roadmap for Client Projects intention',
    today: '2026-07-10',
    intentions,
    requestJson: async () => response('still not json'),
  });

  assert.equal(result.usedFallback, true);
  assert.equal(result.tasks[0].title, 'Review roadmap');
  assert.equal(result.tasks[0].intentionSlug, 'client-projects');
});

test('applies defaults before cleaning a fallback title', async () => {
  const interpreter = new AssistantInputInterpreter();
  const result = await interpreter.interpret({
    mode: 'taskCapture',
    text: 'Create a task to buy milk for Groceries on July 11',
    today: '2026-07-10',
    intentions,
    defaults: {
      dueDate: '2026-07-11',
      intentionSlug: 'groceries',
    },
    requestJson: async () => response('invalid'),
  });

  assert.equal(result.tasks[0].title, 'Buy milk');
});

test('rebinds mutable context after provider extraction without another model call', async () => {
  const interpreter = new AssistantInputInterpreter();
  let calls = 0;
  const input = {
    mode: 'voiceCommand' as const,
    text: 'Plan the release and start a timer',
    today: '2026-07-10',
    intentions,
    defaults: { timerType: 'work' as const, intentionSlug: 'projects' },
    requestJson: async () => {
      calls += 1;
      return response(
        JSON.stringify({
          tasks: [
            {
              title: 'Plan the release',
              intentionSlug: 'projects',
            },
          ],
          timerAction: {
            action: 'startTimer',
            timerType: null,
            intentionSlugs: ['projects'],
            subIntentions: {},
          },
          ...confidentExtraction,
        })
      );
    },
  };

  const prepared = JSON.parse(JSON.stringify(await interpreter.prepare(input)));
  const resolved = interpreter.resolve(
    {
      today: input.today,
      defaults: { timerType: 'break' },
      intentions: intentions.filter(intention => intention.slug !== 'projects'),
    },
    prepared
  );

  assert.equal(calls, 1);
  assert.equal(resolved.tasks[0].timerType, 'break');
  assert.equal(resolved.tasks[0].intentionSlug, null);
  assert.deepEqual(resolved.timerCommand.intentionSlugs, []);
});
