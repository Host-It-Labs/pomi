import type { TaskSortMode } from '@pomi/shared';
import { TASK_SORT_MODES } from '@pomi/shared/src/constants';
import { useEffect, useRef } from 'react';

type DefaultTaskSortOptions = {
  userId: string | null | undefined;
  configuredMode: TaskSortMode | undefined;
  preferencesLoaded: boolean;
  onApply: (mode: TaskSortMode) => void;
};

export function useDefaultTaskSort({
  userId,
  configuredMode,
  preferencesLoaded,
  onApply,
}: DefaultTaskSortOptions) {
  const appliedUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      appliedUserRef.current = null;
      return;
    }
    if (!preferencesLoaded || appliedUserRef.current === userId) return;
    appliedUserRef.current = userId;
    onApply(
      configuredMode === TASK_SORT_MODES.CREATED_DESC ||
        configuredMode === TASK_SORT_MODES.CREATED_ASC
        ? configuredMode
        : TASK_SORT_MODES.DEFAULT
    );
  }, [configuredMode, onApply, preferencesLoaded, userId]);
}
