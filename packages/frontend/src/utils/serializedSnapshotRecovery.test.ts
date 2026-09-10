import { describe, expect, it, vi } from 'vitest';
import { createSerializedSnapshotRecovery } from './serializedSnapshotRecovery';

describe('serialized snapshot recovery', () => {
  it('serializes requests and catches up to the latest requested revision', async () => {
    let resolveFirst: ((snapshot: { revision: number }) => void) | undefined;
    let resolveSecond: ((snapshot: { revision: number }) => void) | undefined;
    const load = vi
      .fn<() => Promise<{ revision: number }>>()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecond = resolve;
          })
      );
    const applied: number[] = [];
    const recover = createSerializedSnapshotRecovery({
      load,
      apply: snapshot => applied.push(snapshot.revision),
      onFailure: vi.fn(),
    });

    recover(5);
    recover(6);
    expect(load).toHaveBeenCalledTimes(1);

    resolveFirst?.({ revision: 5 });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    resolveSecond?.({ revision: 6 });
    await vi.waitFor(() => expect(applied).toEqual([5, 6]));
  });
});
