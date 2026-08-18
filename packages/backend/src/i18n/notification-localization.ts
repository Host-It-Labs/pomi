import {
  translateNotificationCatalog,
  type NotificationKey,
} from '@pomi/shared';

export function translateNotification(
  language: string | null | undefined,
  key: NotificationKey,
  minutes?: number,
  total?: number
): string {
  return translateNotificationCatalog(language, key, {
    minutes,
    position: minutes,
    total,
  });
}

export type { NotificationKey };
