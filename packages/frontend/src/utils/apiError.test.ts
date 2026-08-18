import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from './apiError';

describe('getApiErrorMessage', () => {
  it('keeps a server-provided string message', () => {
    expect(
      getApiErrorMessage({ message: 'Title is too long' }, 'Fallback')
    ).toBe('Title is too long');
  });

  it('joins field validation messages without exposing submitted values', () => {
    expect(
      getApiErrorMessage(
        { message: ['title is too long', 'description is too long'] },
        'Fallback'
      )
    ).toBe('title is too long; description is too long');
  });

  it('uses a fallback for an unusable response body', () => {
    expect(getApiErrorMessage({ message: [] }, 'Try again')).toBe('Try again');
  });
});
