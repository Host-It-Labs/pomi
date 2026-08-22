import type { TaskPageViewMode } from '@pomi/shared';
import { TASK_PAGE_VIEW_MODES } from '@pomi/shared/src/constants';
import { useEffect, useRef } from 'react';

type DefaultTaskViewOptions = {
  userId: string | null | undefined;
  configuredMode: TaskPageViewMode | undefined;
  preferencesLoaded: boolean;
  onApply: (mode: TaskPageViewMode) => void;
};

export function useDefaultTaskView({
  userId,
  configuredMode,
  preferencesLoaded,
  onApply,
}: DefaultTaskViewOptions) {
  const appliedUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      appliedUserRef.current = null;
      return;
    }
    if (!preferencesLoaded || appliedUserRef.current === userId) return;
    appliedUserRef.current = userId;
    onApply(
      configuredMode === TASK_PAGE_VIEW_MODES.CALENDAR
        ? TASK_PAGE_VIEW_MODES.CALENDAR
        : TASK_PAGE_VIEW_MODES.LIST
    );
  }, [configuredMode, onApply, preferencesLoaded, userId]);
}
