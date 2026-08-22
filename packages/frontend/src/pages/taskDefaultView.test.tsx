import type { TaskPageViewMode } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useDefaultTaskView } from './taskDefaultView';

function DefaultViewHarness({
  userId,
  configuredMode,
}: {
  userId: string;
  configuredMode: TaskPageViewMode | null;
}) {
  const [mode, setMode] = useState<TaskPageViewMode>('list');
  useDefaultTaskView({
    userId,
    configuredMode: configuredMode ?? undefined,
    preferencesLoaded: configuredMode !== null,
    onApply: setMode,
  });
  return (
    <>
      <output aria-label="Task page view">{mode}</output>
      <button type="button" onClick={() => setMode('list')}>
        Choose list
      </button>
    </>
  );
}

describe('useDefaultTaskView', () => {
  it('applies async preferences once per visit and preserves visit overrides', async () => {
    const view = render(
      <DefaultViewHarness userId="user-1" configuredMode={null} />
    );
    view.rerender(
      <DefaultViewHarness userId="user-1" configuredMode="calendar" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task page view')).toHaveTextContent(
        'calendar'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose list' }));
    view.rerender(
      <DefaultViewHarness userId="user-1" configuredMode="calendar" />
    );
    expect(screen.getByLabelText('Task page view')).toHaveTextContent('list');
  });

  it('falls back to list for a new user without a calendar default', async () => {
    const view = render(
      <DefaultViewHarness userId="user-1" configuredMode="calendar" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task page view')).toHaveTextContent(
        'calendar'
      )
    );
    view.rerender(<DefaultViewHarness userId="user-2" configuredMode="list" />);
    await waitFor(() =>
      expect(screen.getByLabelText('Task page view')).toHaveTextContent('list')
    );
  });
});
