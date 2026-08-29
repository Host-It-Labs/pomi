import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useUpdatedTaskReveal } from './taskUpdatedReveal';

function UpdatedTaskRevealHarness() {
  const [filtersActive, setFiltersActive] = useState(true);
  const [destinationTaskId, setDestinationTaskId] = useState<string | null>(
    null
  );
  const resetFilters = useCallback(() => setFiltersActive(false), []);
  const revealUpdatedTask = useUpdatedTaskReveal({
    resetFilters,
    setDestinationTaskId,
  });

  return (
    <>
      <output aria-label="Filters active">{String(filtersActive)}</output>
      <output aria-label="Destination task">{destinationTaskId}</output>
      <button
        type="button"
        onClick={() => revealUpdatedTask('task-on-another-day')}
      >
        View updated task
      </button>
    </>
  );
}

describe('updated Task reveal', () => {
  it('clears filters so an updated Task can be revealed', async () => {
    const user = userEvent.setup();
    render(<UpdatedTaskRevealHarness />);

    await user.click(screen.getByRole('button', { name: 'View updated task' }));

    expect(screen.getByLabelText('Filters active')).toHaveTextContent('false');
    expect(screen.getByLabelText('Destination task')).toHaveTextContent(
      'task-on-another-day'
    );
  });
});
