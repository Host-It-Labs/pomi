import type { TaskPageViewMode } from '@pomi/shared';
import { useCallback, type Dispatch, type SetStateAction } from 'react';

type UpdatedTaskRevealOptions = {
  resetFilters: () => void;
  setPageViewMode: Dispatch<SetStateAction<TaskPageViewMode>>;
  setDestinationTaskId: Dispatch<SetStateAction<string | null>>;
};

export function useUpdatedTaskReveal({
  resetFilters,
  setPageViewMode,
  setDestinationTaskId,
}: UpdatedTaskRevealOptions) {
  return useCallback(
    (taskId: string) => {
      resetFilters();
      setPageViewMode('list');
      setDestinationTaskId(taskId);
    },
    [resetFilters, setDestinationTaskId, setPageViewMode]
  );
}
