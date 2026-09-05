const INTENTION_REFRESH_EVENT = 'pomi:intention-refresh-requested';
const WORK_TIMER_LOG_REFRESH_EVENT = 'pomi:work-timer-log-refresh-requested';

function request(event: string) {
  window.dispatchEvent(new Event(event));
}

function subscribe(event: string, listener: () => void) {
  window.addEventListener(event, listener);
  return () => window.removeEventListener(event, listener);
}

export const requestIntentionRefresh = () => request(INTENTION_REFRESH_EVENT);
export const subscribeToIntentionRefresh = (listener: () => void) =>
  subscribe(INTENTION_REFRESH_EVENT, listener);
export const requestWorkTimerLogRefresh = () =>
  request(WORK_TIMER_LOG_REFRESH_EVENT);
export const subscribeToWorkTimerLogRefresh = (listener: () => void) =>
  subscribe(WORK_TIMER_LOG_REFRESH_EVENT, listener);
