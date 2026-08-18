import { describe, expect, it } from 'vitest';
import { translateNotification } from './notificationLocalization';

describe('frontend notification localization', () => {
  it('delegates common notifications to the shared catalog', () => {
    expect(translateNotification('fr-FR', 'minutesLeft', { minutes: 5 })).toBe(
      'Encore 5 minutes'
    );
  });

  it('keeps platform-specific copy local to the frontend', () => {
    expect(translateNotification('fr', 'desktopWorkComplete', undefined)).toBe(
      'Session de travail terminée !'
    );
  });
});
