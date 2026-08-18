import type { UserAction } from '@pomi/shared';

const MAX_LIFECYCLE_TEXT_LENGTH = 512;

export function redactUserAction(action: UserAction): UserAction {
  if (action.kind === 'feedback') {
    return { ...action, text: '[redacted]' };
  }
  if (action.kind === 'assistant') {
    if (action.operation === 'createTaskFromText') {
      const payload = action.payload ?? {};
      const text = payload.text;
      return {
        ...action,
        payload: {
          ...payload,
          text:
            typeof text === 'string'
              ? text.slice(0, MAX_LIFECYCLE_TEXT_LENGTH)
              : text,
          ...(typeof text === 'string' &&
          text.length > MAX_LIFECYCLE_TEXT_LENGTH
            ? { textTruncated: true }
            : {}),
        },
      };
    }
  }

  if (action.kind === 'tasks' && action.operation === 'import') {
    return {
      ...action,
      rows: [],
      rowCount: Array.isArray(action.rows) ? action.rows.length : undefined,
    } as UserAction;
  }

  if (action.kind === 'system' && action.operation === 'importUserData') {
    return { ...action, payload: { redacted: true } };
  }

  return action;
}

export function isRedactedLifecycleAction(action: UserAction): boolean {
  if (action.kind === 'feedback') return action.text === '[redacted]';
  if (action.kind === 'tasks' && action.operation === 'import') {
    return (
      Array.isArray(action.rows) &&
      action.rows.length === 0 &&
      'rowCount' in action
    );
  }
  if (action.kind === 'system' && action.operation === 'importUserData') {
    return action.payload?.redacted === true;
  }
  return false;
}
