import type { Preferences } from '@pomi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntentionSettings } from '../pages/IntentionSettings';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('IntentionSettings', () => {
  it('keeps habit prioritization searchable while habits are disabled', () => {
    const updatePreference = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <IntentionSettings
        preferences={
          {
            intentionHabits: false,
            intentionPrioritizeUnfinishedHabits: false,
          } as Preferences
        }
        updatePreference={updatePreference}
      />
    );

    const setting = container.querySelector(
      '[data-setting-id="intentionPrioritizeUnfinishedHabits"]'
    );
    expect(setting).not.toBeNull();
    expect(
      screen.getByRole('checkbox', {
        name: 'intention.prioritizeUnfinishedHabits',
      })
    ).toBeDisabled();

    fireEvent.click(setting!);
    expect(updatePreference).toHaveBeenCalledWith('intentionHabits', true);
  });
});
