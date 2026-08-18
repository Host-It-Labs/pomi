import { describe, expect, it } from 'vitest';
import { getWheelPageDirection } from './pagedGesture';

describe('paged desktop gestures', () => {
  it('accepts vertical mouse wheels and horizontal trackpad gestures', () => {
    expect(getWheelPageDirection(0, 24, 18)).toBe(1);
    expect(getWheelPageDirection(-28, 4, 18)).toBe(-1);
  });

  it('ignores movement below the paging threshold', () => {
    expect(getWheelPageDirection(4, 12, 18)).toBeNull();
  });
});
