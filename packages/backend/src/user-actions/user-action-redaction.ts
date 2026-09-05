import type { UserAction } from '@pomi/shared';

export function redactUserAction(action: UserAction): UserAction {
  return { kind: action.kind, operation: action.operation } as UserAction;
}

export function isRedactedLifecycleAction(action: UserAction): boolean {
  return Object.keys(action).every(
    key => key === 'kind' || key === 'operation'
  );
}
