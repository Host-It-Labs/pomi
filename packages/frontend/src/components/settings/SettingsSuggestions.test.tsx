import type { Preferences } from '@pomi/shared';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePreferencesStore } from '../../stores/preferencesStore';
import {
  getSettingSuggestions,
  SettingsSuggestions,
} from './SettingsSuggestions';
const preferences = {
  sessionsExtension: true,
  intentionExtension: true,
  tasksExtension: true,
  dismissedSettingSuggestions: [],
} as unknown as Preferences;
beforeEach(() => usePreferencesStore.setState({ preferences }));
it('offers two relevant tools in stable order without resurfacing dismissals', () => {
  expect(getSettingSuggestions(preferences)).toEqual([
    'sessionShowEta',
    'intentionShowDailyCount',
  ]);
  const dismissed = {
    ...preferences,
    dismissedSettingSuggestions: ['sessionShowEta'],
  };
  expect(getSettingSuggestions(dismissed)).not.toContain('sessionShowEta');
  expect(
    getSettingSuggestions({ ...dismissed, sessionShowEta: true })
  ).not.toContain('sessionShowEta');
  expect(
    getSettingSuggestions({ ...dismissed, sessionShowEta: false })
  ).not.toContain('sessionShowEta');
  expect(
    getSettingSuggestions({ ...preferences, sessionsExtension: false })
  ).not.toContain('sessionShowEta');
});
it('waits for confirmed dismissal without changing the feature value', async () => {
  const update = vi.fn().mockResolvedValue(false);
  usePreferencesStore.setState({ updatePreferenceWithResult: update });
  render(<SettingsSuggestions onFind={vi.fn()} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Not interested' })[0]);
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Not interested',
    })
  );
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith('dismissedSettingSuggestions', [
      'sessionShowEta',
    ])
  );
  expect(
    screen.getAllByRole('button', { name: 'Not interested' })
  ).toHaveLength(3);
  expect(usePreferencesStore.getState().preferences).toEqual(preferences);
});
