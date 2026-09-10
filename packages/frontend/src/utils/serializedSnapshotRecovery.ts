type RevisionedSnapshot = { revision: number };

export function createSerializedSnapshotRecovery<T extends RevisionedSnapshot>({
  load,
  apply,
  onFailure,
}: {
  load: () => Promise<T>;
  apply: (snapshot: T) => void;
  onFailure: () => void;
}): (targetRevision: number) => void {
  let targetRevision = 0;
  let recovery: Promise<void> | null = null;

  return requestedRevision => {
    targetRevision = Math.max(targetRevision, requestedRevision);
    if (recovery) return;

    const currentRecovery = (async () => {
      try {
        for (;;) {
          const snapshot = await load();
          apply(snapshot);
          if (snapshot.revision >= targetRevision) return;
        }
      } catch {
        targetRevision = 0;
        onFailure();
      }
    })();
    recovery = currentRecovery.finally(() => {
      recovery = null;
    });
  };
}
