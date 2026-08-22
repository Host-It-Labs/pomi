let reconnect: (() => void) | null = null;

export const registerBackendConnectionRecovery = (
  handler: () => void
): void => {
  reconnect = handler;
};

export const requestBackendConnectionRecovery = (): void => {
  reconnect?.();
};
