import type { Intention } from '@pomi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskIntentionFilterDropdown } from './TaskWorkspace';

describe('Tasks Intention filter', () => {
  it('clears the selected Intention when it is clicked again', () => {
    const onSelect = vi.fn();
    const intention = {
      id: 'focus-id',
      slug: 'focus',
      title: 'Focus',
      emoji: '🎯',
      type: 'work',
      isArchived: false,
      isFavorite: false,
      parentIntentionId: null,
    } as Intention;

    render(
      <TaskIntentionFilterDropdown
        options={[
          {
            value: 'focus',
            title: 'Focus',
            emoji: '🎯',
            intention,
            parent: null,
            subIntention: null,
          },
        ]}
        lists={[]}
        selectedValue="focus"
        onSelect={onSelect}
        onSelectList={vi.fn()}
        onToggleFavorite={vi.fn()}
        onToggleFavoriteList={vi.fn()}
        openRequest={0}
      />
    );

    fireEvent.click(screen.getByTestId('task-intention-filter-trigger'));
    fireEvent.click(screen.getByRole('option', { name: /Focus/ }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
