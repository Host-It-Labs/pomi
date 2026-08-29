import { describe, expect, it } from 'vitest';
import {
  areMinimizedPickerInsetsEqual,
  getCompactGridColumnClass,
  getCompactPickerMinWidth,
} from './minimizedIntentionsLayout';

describe('minimized intentions layout', () => {
  it('keeps compact intention tracks at the 28px button size', () => {
    expect(getCompactGridColumnClass(3)).toBe('grid-cols-[repeat(3,1.75rem)]');
    expect(getCompactPickerMinWidth(3, false)).toBe(100);
  });

  it('reserves the pagination rail without reducing intention spacing', () => {
    expect(getCompactPickerMinWidth(3, true)).toBe(148);
    expect(getCompactPickerMinWidth(0, false)).toBe(28);
    expect(getCompactPickerMinWidth(8, false)).toBe(172);
  });

  it('treats repeated measurements as stable', () => {
    const first = { left: 126, right: 74 };
    expect(areMinimizedPickerInsetsEqual(first, { left: 126, right: 74 })).toBe(
      true
    );
    expect(areMinimizedPickerInsetsEqual(first, { left: 127, right: 74 })).toBe(
      false
    );
  });
});
