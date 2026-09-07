import { useCallback, type Dispatch, type SetStateAction } from 'react';

type UpdatedTaskRevealOptions = {
  canRevealTask: (taskId: string) => boolean;
  resetFilters: () => void;
  setDestinationTaskId: Dispatch<SetStateAction<string | null>>;
};

export function useUpdatedTaskReveal({
  canRevealTask,
  resetFilters,
  setDestinationTaskId,
}: UpdatedTaskRevealOptions) {
  return useCallback(
    (taskId: string) => {
      if (!canRevealTask(taskId)) {
        setDestinationTaskId(null);
        return;
      }
      resetFilters();
      setDestinationTaskId(taskId);
    },
    [canRevealTask, resetFilters, setDestinationTaskId]
  );
}
