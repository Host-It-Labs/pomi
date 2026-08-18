import { describe, expect, it } from 'vitest';
import { PreferencesService } from '../../src/preferences/preferences.service';

describe('PreferencesService', () => {
  it('does not write a stale snapshot while reading existing preferences', async () => {
    const saved: unknown[] = [];
    const existingPreferences = {
      userId: 'user-1',
      sessionsExtension: true,
      intentionExtension: true,
      tasksExtension: true,
    };
    const service = new PreferencesService({
      findOne: async () => existingPreferences,
      create: (entity: unknown) => entity,
      save: async (entity: unknown) => {
        saved.push(entity);
        return entity;
      },
    } as never);

    await expect(service.getPreferences('user-1')).resolves.toBe(
      existingPreferences
    );
    expect(saved).toEqual([]);
  });

  it('creates defaults with a conflict-safe insert when preferences are missing', async () => {
    const inserted: Record<string, unknown>[] = [];
    let stored: Record<string, unknown> | null = null;
    const builder = {
      insert: () => builder,
      into: () => builder,
      values: (entity: Record<string, unknown>) => {
        inserted.push(entity);
        stored ??= entity;
        return builder;
      },
      orIgnore: () => builder,
      execute: async () => undefined,
    };
    const service = new PreferencesService({
      findOne: async () => stored,
      create: (entity: Record<string, unknown>) => entity,
      createQueryBuilder: () => builder,
    } as never);

    await expect(service.getPreferences('user-2', 'fr')).resolves.toMatchObject(
      {
        userId: 'user-2',
        language: 'fr',
        assistantTaskTranscriptsEnabled: false,
        assistantTaskTranscriptMinWords: 15,
      }
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ userId: 'user-2' });
  });

  it('adopts a detected language only for an account without one', async () => {
    const existingPreferences = {
      userId: 'user-3',
      language: null,
    };
    const saved: unknown[] = [];
    const service = new PreferencesService({
      findOne: async () => existingPreferences,
      save: async (entity: unknown) => {
        saved.push(entity);
        return entity;
      },
    } as never);

    await expect(service.getPreferences('user-3', 'ar')).resolves.toMatchObject(
      {
        userId: 'user-3',
        language: 'ar',
      }
    );
    expect(saved).toHaveLength(1);
  });
});
