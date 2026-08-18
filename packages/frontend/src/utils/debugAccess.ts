import type { User } from '@pomi/shared';
import { environmentVariables } from '../config/environmentVariables';

export function canUseDebugPanel(user: User | null): boolean {
  if (!environmentVariables.DEBUG_PANEL_ENABLED) {
    return false;
  }

  if (environmentVariables.NODE_ENV !== 'production') {
    return true;
  }

  return user?.isAdmin === true;
}
