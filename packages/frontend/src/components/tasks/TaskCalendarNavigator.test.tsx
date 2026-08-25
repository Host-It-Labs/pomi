import type { Task } from '@pomi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE } from '../../i18n/languages';
import { setLanguage } from '../../i18n/runtime';
import type { MixedTaskItem } from '../../utils/mixedTaskItems';
import { TaskCalendarNavigator } from './TaskCalendarNavigator';

function taskEntry(
  id: string,
  dueDate: string | null
): Extract<MixedTaskItem, { kind: 'task' }> {
  return {
    kind: 'task',
    task: { id, dueDate, priority: 'normal' } as Task,
  };
}

function CalendarHarness() {
  const [anchorDate, setAnchorDate] = useState('2026-08-12');
  const [selectedDate, setSelectedDate] = useState<string | null>('2026-08-12');
  return (
    <>
      <TaskCalendarNavigator
        entries={[taskEntry('dated', '2026-08-12'), taskEntry('undated', null)]}
        anchorDate={anchorDate}
        selectedDate={selectedDate}
        onAnchorDateChange={setAnchorDate}
        onSelectedDateChange={setSelectedDate}
      />
      <output aria-label="Calendar state">
        {anchorDate}:{selectedDate ?? 'undated'}
      </output>
    </>
  );
}

describe('TaskCalendarNavigator', () => {
  afterEach(() => {
    setLanguage(DEFAULT_LANGUAGE, { persist: false });
  });

  it('renders a fixed week view and moves by one week', () => {
    render(<CalendarHarness />);
    expect(
      screen.getByRole('button', { name: /August 12, 2026: 1 item/i })
    ).toHaveAttribute('aria-pressed', 'true');

    expect(
      screen.queryByRole('button', { name: 'month' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByLabelText('Calendar state')).toHaveTextContent(
      '2026-08-19:2026-08-19'
    );
  });

  it('keeps undated Tasks reachable from the week view', () => {
    render(<CalendarHarness />);
    const undatedButton = screen.getByRole('button', { name: /Undated 1/i });
    expect(screen.getByTestId('task-calendar-header')).toContainElement(
      undatedButton
    );
    fireEvent.click(undatedButton);
    expect(screen.getByLabelText('Calendar state')).toHaveTextContent(
      '2026-08-12:undated'
    );
  });

  it('formats and labels calendar dates with the selected app locale', () => {
    setLanguage('fr', { persist: false });
    render(<CalendarHarness />);

    expect(
      screen.getByRole('button', { name: /12 août 2026: 1 élément/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sans date 1/i })).toBeVisible();
  });
});
