const LIST_REFRESH_REQUESTED_EVENT = 'pomi:list-refresh-requested';

export function requestListRefresh() {
  window.dispatchEvent(new Event(LIST_REFRESH_REQUESTED_EVENT));
}

export function subscribeToListRefresh(listener: () => void) {
  window.addEventListener(LIST_REFRESH_REQUESTED_EVENT, listener);
  return () =>
    window.removeEventListener(LIST_REFRESH_REQUESTED_EVENT, listener);
}
