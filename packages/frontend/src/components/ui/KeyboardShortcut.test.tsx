import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardShortcut } from './KeyboardShortcut';

vi.mock('../../utils/osUtils', () => ({
  isDesktop: true,
  isMac: true,
}));

vi.mock('../../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () => ({ keyboardShortcuts: true }),
    },
  },
}));

describe('KeyboardShortcut', () => {
  it('keeps shortcut text readable on colored buttons', () => {
    render(<KeyboardShortcut text="L" alwaysShow />);

    expect(screen.getByText('L').parentElement).toHaveClass('text-gray-100');
  });
});
