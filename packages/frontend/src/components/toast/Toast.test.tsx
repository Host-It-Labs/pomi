import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

describe('Toast action', () => {
  it('runs the recovery action and closes the toast', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <Toast
        id="task-updated"
        message="Task updated"
        type="success"
        duration={10_000}
        action={{ label: 'View', onClick }}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
