import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('provides a green success action', () => {
    render(
      <IconButton label="Switch break" variant="success">
        S
      </IconButton>
    );

    expect(screen.getByRole('button', { name: 'Switch break' })).toHaveClass(
      'bg-emerald-500'
    );
  });
});
