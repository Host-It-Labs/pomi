import { useCallback, type Dispatch, type SetStateAction } from 'react';

type UpdatedTaskRevealOptions = {
  resetFilters: () => void;
  setDestinationTaskId: Dispatch<SetStateAction<string | null>>;
};

export function useUpdatedTaskReveal({
  resetFilters,
  setDestinationTaskId,
}: UpdatedTaskRevealOptions) {
  return useCallback(
    (taskId: string) => {
      resetFilters();
      setDestinationTaskId(taskId);
    },
    [resetFilters, setDestinationTaskId]
  );
}
