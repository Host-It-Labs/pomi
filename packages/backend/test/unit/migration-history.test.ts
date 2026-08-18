import { describe, expect, test } from 'vitest';
import { findUnknownAppliedMigrations } from '../../src/development-fixtures/migration-history';

describe('migration history compatibility', () => {
  test('accepts applied migrations that all exist on the branch', () => {
    expect(
      findUnknownAppliedMigrations(
        ['InitialSchema1', 'AddTasks2'],
        ['InitialSchema1', 'AddTasks2', 'AddLists3']
      )
    ).toEqual([]);
  });

  test('returns unique applied migrations missing from the branch', () => {
    expect(
      findUnknownAppliedMigrations(
        ['InitialSchema1', 'FutureFeature4', 'FutureFeature4'],
        ['InitialSchema1', 'AddTasks2']
      )
    ).toEqual(['FutureFeature4']);
  });
});
