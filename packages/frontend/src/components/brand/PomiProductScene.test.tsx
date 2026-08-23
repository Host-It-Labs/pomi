import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PomiProductScene } from './PomiProductScene';

describe('PomiProductScene', () => {
  it('uses one bold timer with three intention satellites', () => {
    const { container } = render(<PomiProductScene scene="timer" />);

    expect(screen.getByText('25:00')).toBeVisible();
    expect(screen.getByText('Debug')).toBeVisible();
    expect(screen.getByText('Focus')).toBeVisible();
    expect(screen.getByText('Read')).toBeVisible();
    expect(
      container.querySelectorAll('[data-product-motif="timer"]')
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-product-motif="intention"]')
    ).toHaveLength(3);
    expect(container.querySelector('[data-product-motif="task"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('turns two real Pomi tasks into a sparse visual runway', () => {
    const { container } = render(<PomiProductScene scene="tasks" />);

    expect(screen.getByText('Clear inbox backlog')).toBeVisible();
    expect(screen.getByText('Fix urgent production bug')).toBeVisible();
    expect(
      container.querySelectorAll('[data-product-motif="task"]')
    ).toHaveLength(2);
    expect(container.querySelector('button')).toBeNull();
  });

  it('gives desktop, phone, and watch distinct silhouettes and one time', () => {
    const { container } = render(<PomiProductScene scene="sync" />);

    expect(container.querySelector('[data-device="desktop"]')).toBeTruthy();
    expect(container.querySelector('[data-device="phone"]')).toBeTruthy();
    expect(container.querySelector('[data-device="watch"]')).toBeTruthy();
    expect(screen.getAllByText('25:00')).toHaveLength(3);
    expect(
      container.querySelector(
        '[data-device="watch"] [data-product-motif="timer"]'
      )?.className
    ).toContain('h-16');
    expect(screen.queryByText(/live|synced/i)).toBeNull();
  });

  it('keeps the welcome scene cinematic and product-specific', () => {
    const { container } = render(<PomiProductScene scene="welcome" />);

    expect(
      container.querySelector('[data-product-scene="welcome"]')
    ).toBeTruthy();
    expect(
      container.querySelectorAll('[data-product-motif="timer"]')
    ).toHaveLength(3);
    expect(
      container.querySelectorAll('[data-product-motif="intention"]')
    ).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
  });
});
