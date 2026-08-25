import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import {
  EMPTY_TASK_PROPERTY_FILTERS,
  TaskPropertyFilterMenu,
} from './TaskPropertyFilterMenu';

describe('Task filters menu', () => {
  it('keeps Timer types and priorities as independent multi-select filters', () => {
    const onChange = vi.fn();

    render(
      <TaskPropertyFilterMenu
        filters={EMPTY_TASK_PROPERTY_FILTERS}
        isOpen
        onOpenChange={vi.fn()}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Break' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_TASK_PROPERTY_FILTERS,
      timerTypes: [TIMER_TYPES.WORK, TIMER_TYPES.LONG_BREAK],
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'High' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_TASK_PROPERTY_FILTERS,
      priorities: ['low', 'normal', 'urgent'],
    });
  });
});
