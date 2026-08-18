import type { TimerTypes } from '@pomi/shared';

export function isTaskInTimerTypeSearchScope(
  taskType: TimerTypes,
  selectedType: TimerTypes | 'all',
  searchActive: boolean
) {
  return searchActive || selectedType === 'all' || taskType === selectedType;
}
