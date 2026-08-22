import { afterEach, describe, expect, it } from 'vitest';
import { isOnboardingPreview } from './useDevAutoLogin';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('development onboarding preview', () => {
  it('skips copyme auto-login only for the explicit preview query', () => {
    window.history.replaceState({}, '', '/?__pomi_onboarding=1');
    expect(isOnboardingPreview()).toBe(true);

    window.history.replaceState({}, '', '/');
    expect(isOnboardingPreview()).toBe(false);
  });
});
