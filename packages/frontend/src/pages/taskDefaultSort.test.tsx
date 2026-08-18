import type { TaskSortMode } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useDefaultTaskSort } from './taskDefaultSort';

function DefaultSortHarness({
  userId,
  configuredMode,
}: {
  userId: string;
  configuredMode: TaskSortMode | null;
}) {
  const [mode, setMode] = useState<TaskSortMode>('default');
  useDefaultTaskSort({
    userId,
    configuredMode: configuredMode ?? undefined,
    preferencesLoaded: configuredMode !== null,
    onApply: setMode,
  });
  return (
    <>
      <output aria-label="Task sort mode">{mode}</output>
      <button type="button" onClick={() => setMode('created-asc')}>
        Choose oldest
      </button>
    </>
  );
}

describe('useDefaultTaskSort', () => {
  it('applies async preferences once per visit and preserves visit overrides', async () => {
    const view = render(
      <DefaultSortHarness userId="user-1" configuredMode={null} />
    );
    expect(screen.getByLabelText('Task sort mode')).toHaveTextContent(
      'default'
    );

    view.rerender(
      <DefaultSortHarness userId="user-1" configuredMode="created-desc" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task sort mode')).toHaveTextContent(
        'created-desc'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose oldest' }));
    view.rerender(
      <DefaultSortHarness userId="user-1" configuredMode="default" />
    );
    expect(screen.getByLabelText('Task sort mode')).toHaveTextContent(
      'created-asc'
    );

    view.unmount();
    render(
      <DefaultSortHarness userId="user-1" configuredMode="created-desc" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task sort mode')).toHaveTextContent(
        'created-desc'
      )
    );
  });

  it('applies the next signed-in user preference and falls back safely', async () => {
    const view = render(
      <DefaultSortHarness userId="user-1" configuredMode="created-desc" />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task sort mode')).toHaveTextContent(
        'created-desc'
      )
    );

    view.rerender(
      <DefaultSortHarness
        userId="user-2"
        configuredMode={'invalid' as TaskSortMode}
      />
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Task sort mode')).toHaveTextContent(
        'default'
      )
    );
  });
});
