import { describe, expect, it } from 'vitest';
import { AssistantTaskPolicy } from '../../src/assistant/assistant-task-policy';
import { AssistantInputInterpreter } from '../../src/assistant/assistant-input-interpreter';

describe('AssistantTaskPolicy timer-only voice guard', () => {
  it.each([
    'Démarrer un minuteur',
    'Iniciar un temporizador',
    '开始计时器',
    'टाइमर शुरू करो',
    'ابدأ المؤقت',
    'টাইমার শুরু করুন',
    'Iniciar o temporizador',
    'Mulai timer',
    'ٹائمر شروع کریں',
    'Ajoute cinq minutes au minuteur',
  ])('discards a timer-only task in %s', phrase => {
    const policy = new AssistantTaskPolicy();

    const tasks = policy.normalizeTasks(
      [{ title: phrase, sourceSegments: [phrase] }],
      phrase,
      '2026-08-08',
      [],
      undefined,
      [],
      [],
      true
    );

    expect(tasks).toEqual([]);
  });

  it('keeps a real task from a mixed voice request', () => {
    const policy = new AssistantTaskPolicy();

    const tasks = policy.normalizeTasks(
      [
        {
          title: 'Démarrer un minuteur',
          sourceSegments: ['Démarrer un minuteur'],
        },
        {
          title: 'Préparer le rapport',
          sourceSegments: ['Préparer le rapport'],
        },
      ],
      'Démarrer un minuteur, puis préparer le rapport',
      '2026-08-08',
      [],
      undefined,
      [],
      [],
      true
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('Préparer le rapport');
  });

  it('splits a natural shared-action conjunction into independent Tasks', async () => {
    const interpreter = new AssistantInputInterpreter();
    const result = await interpreter.interpret({
      mode: 'taskCapture',
      text: 'Add milk and add eggs',
      today: '2026-08-08',
      intentions: [],
      requestJson: async () => ({
        content: JSON.stringify({
          tasks: [
            {
              title: 'Add milk and add eggs',
              sourceSegments: ['Add milk and add eggs'],
              essentialDetails: ['milk', 'eggs'],
              outcomeKey: 'groceries',
            },
          ],
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
        }),
        costUsd: 0,
      }),
    });

    expect(result.tasks.map(task => task.title)).toEqual([
      'Add milk',
      'Add eggs',
    ]);
  });

  it('keeps a compound action on one object as one Task', async () => {
    const interpreter = new AssistantInputInterpreter();
    const text = 'Review the PR and merge it';
    const result = await interpreter.interpret({
      mode: 'taskCapture',
      text,
      today: '2026-08-08',
      intentions: [],
      requestJson: async () => ({
        content: JSON.stringify({
          tasks: [
            {
              title: text,
              sourceSegments: [text],
              essentialDetails: ['PR'],
              outcomeKey: 'review-and-merge-pr',
            },
          ],
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
        }),
        costUsd: 0,
      }),
    });

    expect(result.tasks.map(task => task.title)).toEqual([text]);
  });
});
