import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskModeToggle } from './TaskModeToggle';

describe('TaskModeToggle', () => {
  it('marks All tasks selected immediately in general mode', () => {
    render(<TaskModeToggle mode="general" onModeChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'All tasks' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen.getByRole('button', { name: 'Current intentions' })
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
