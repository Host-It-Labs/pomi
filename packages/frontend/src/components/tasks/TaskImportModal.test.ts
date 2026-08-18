import type { Intention } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { getTaskEligibleImportIntentions } from './TaskImportModal';

describe('Task import Intention filtering', () => {
  it('removes a disabled Parent and every child in its tree', () => {
    const enabled = {
      id: 'enabled',
      slug: 'enabled',
      title: 'Enabled',
      parentIntentionId: null,
      isArchived: false,
      allowsTasks: true,
    } as Intention;
    const disabled = {
      ...enabled,
      id: 'disabled',
      slug: 'disabled',
      title: 'Disabled',
      allowsTasks: false,
    } as Intention;
    const disabledChild = {
      ...enabled,
      id: 'disabled-child',
      slug: 'disabled-child',
      title: 'Disabled child',
      parentIntentionId: disabled.id,
    } as Intention;

    expect(
      getTaskEligibleImportIntentions([enabled, disabled, disabledChild]).map(
        intention => intention.id
      )
    ).toEqual(['enabled']);
  });
});
