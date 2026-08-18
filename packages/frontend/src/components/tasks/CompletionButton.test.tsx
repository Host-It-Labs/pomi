import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompletionButton } from './CompletionButton';

describe('CompletionButton', () => {
  it('advertises Undo while completion is pending', () => {
    render(
      <CompletionButton
        label="Ship release"
        isCompleted={false}
        isCompleting
        disabled
        onClick={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: 'Undo Ship release' });
    expect(button).toHaveAttribute('title', 'Undo');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('bg-emerald-400');
  });
});
