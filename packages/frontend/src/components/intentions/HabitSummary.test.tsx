import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HabitSummary } from './HabitSummary';

describe('HabitSummary', () => {
  it('shows remaining habits separately for each configured cadence', () => {
    render(
      <HabitSummary
        habits={[
          { habitCadence: 'daily', state: 'pending' },
          { habitCadence: 'daily', state: 'done' },
          { habitCadence: 'weekly', state: 'pending' },
          { habitCadence: 'weekly', state: 'pending' },
        ]}
      />
    );
    expect(screen.getByRole('group', { name: 'Habits left' })).toBeVisible();
    expect(screen.getByLabelText('Habits left today: 1')).toHaveTextContent(
      '1'
    );
    expect(screen.getByLabelText('Habits left this week: 2')).toHaveTextContent(
      '2'
    );
  });

  it('keeps a completed daily cadence visible and hides an unconfigured weekly cadence', () => {
    render(
      <HabitSummary habits={[{ habitCadence: 'daily', state: 'done' }]} />
    );
    expect(screen.getByLabelText('Habits left today: 0')).toBeVisible();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('shows only weekly habits when daily habits are not configured', () => {
    render(
      <HabitSummary habits={[{ habitCadence: 'weekly', state: 'done' }]} />
    );
    expect(screen.getByLabelText('Habits left this week: 0')).toBeVisible();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
  });

  it('renders nothing without enabled habits', () => {
    const { container, rerender } = render(<HabitSummary habits={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<HabitSummary habits={[{ habitCadence: 'off', state: null }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts an existing habit without an explicit cadence as daily', () => {
    render(<HabitSummary habits={[{ state: 'pending' }]} />);
    expect(screen.getByLabelText('Habits left today: 1')).toBeVisible();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });
});
