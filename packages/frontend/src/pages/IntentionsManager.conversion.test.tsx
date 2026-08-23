import type { Intention } from '@pomi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntentionConversionModal } from './IntentionsManager';

const intention = {
  id: 'parent-1',
  title: 'Projects',
  slug: 'projects',
  type: 'work',
} as Intention;

describe('Intention conversion modal', () => {
  it('explains the direct-Task prerequisite for a Parent with active children', () => {
    render(
      <IntentionConversionModal
        intention={intention}
        childCount={2}
        onClose={vi.fn()}
        onConvert={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'First move Tasks linked directly to this Intention into a Sub-intention.'
      )
    ).toBeVisible();
  });

  it('does not show the Parent prerequisite for a leaf Intention', () => {
    render(
      <IntentionConversionModal
        intention={intention}
        childCount={0}
        onClose={vi.fn()}
        onConvert={vi.fn()}
      />
    );

    expect(
      screen.queryByText(
        'First move Tasks linked directly to this Intention into a Sub-intention.'
      )
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Projects and its linked Tasks will move to a List.')
    ).toBeVisible();
  });
});
