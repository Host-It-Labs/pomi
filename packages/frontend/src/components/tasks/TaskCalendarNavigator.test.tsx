import type { Task } from '@pomi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE } from '../../i18n/languages';
import { setLanguage } from '../../i18n/runtime';
import type { MixedTaskItem } from '../../utils/mixedTaskItems';
import type { TaskCalendarScale } from '../../utils/taskCalendar';
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
  const [scale, setScale] = useState<TaskCalendarScale>('month');
  const [anchorDate, setAnchorDate] = useState('2026-08-12');
  const [selectedDate, setSelectedDate] = useState<string | null>('2026-08-12');
  return (
    <>
      <TaskCalendarNavigator
        entries={[taskEntry('dated', '2026-08-12'), taskEntry('undated', null)]}
        scale={scale}
        anchorDate={anchorDate}
        selectedDate={selectedDate}
        onScaleChange={setScale}
        onAnchorDateChange={setAnchorDate}
        onSelectedDateChange={setSelectedDate}
      />
      <output aria-label="Calendar state">
        {scale}:{anchorDate}:{selectedDate ?? 'undated'}
      </output>
    </>
  );
}

describe('TaskCalendarNavigator', () => {
  afterEach(() => {
    setLanguage(DEFAULT_LANGUAGE, { persist: false });
  });

  it('switches scales and drills from year into a selected month', () => {
    render(<CalendarHarness />);
    expect(
      screen.getByRole('button', { name: /August 12, 2026: 1 item/i })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'year' }));
    expect(screen.getByLabelText('Calendar state')).toHaveTextContent(
      'year:2026-08-12:2026-08-12'
    );
    fireEvent.click(screen.getByRole('button', { name: /Aug 1 item/i }));
    expect(screen.getByLabelText('Calendar state')).toHaveTextContent(
      'month:2026-08-01:2026-08-01'
    );
  });

  it('keeps undated Tasks reachable from every calendar scale', () => {
    render(<CalendarHarness />);
    fireEvent.click(screen.getByRole('button', { name: /Undated 1/i }));
    expect(screen.getByLabelText('Calendar state')).toHaveTextContent(
      'month:2026-08-12:undated'
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
