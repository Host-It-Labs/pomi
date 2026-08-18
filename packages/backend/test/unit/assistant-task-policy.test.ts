import { describe, expect, it } from 'vitest';
import { AssistantTaskPolicy } from '../../src/assistant/assistant-task-policy';

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
});
