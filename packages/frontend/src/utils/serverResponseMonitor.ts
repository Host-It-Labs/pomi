const SERVER_RESPONSE_SLOW_MS = 1000;

type ServerResponseListener = () => void;

const listeners = new Set<ServerResponseListener>();
let slowResponseCount = 0;

const notifyListeners = () => {
  listeners.forEach(listener => listener());
};

export const subscribeToServerResponseState = (
  listener: ServerResponseListener
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getServerResponseState = () => ({
  isWaitingForServer: slowResponseCount > 0,
});

export const startServerResponseWatch = () => {
  let completed = false;
  let markedSlow = false;

  const timeout = setTimeout(() => {
    if (completed) {
      return;
    }

    markedSlow = true;
    slowResponseCount += 1;
    notifyListeners();
  }, SERVER_RESPONSE_SLOW_MS);

  return () => {
    if (completed) {
      return;
    }

    completed = true;
    clearTimeout(timeout);

    if (markedSlow) {
      slowResponseCount = Math.max(0, slowResponseCount - 1);
      notifyListeners();
    }
  };
};
