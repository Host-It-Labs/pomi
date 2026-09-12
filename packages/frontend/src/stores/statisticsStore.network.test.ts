import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  topIntentions: vi.fn(),
  authListener: undefined as
    | undefined
    | ((
        state: { token: string | null; user: { id: string } | null },
        previous: { token: string | null; user: { id: string } | null }
      ) => void),
  auth: {
    token: 'session-a' as string | null,
    user: { id: 'account-a' } as { id: string } | null,
  },
}));

vi.mock('../utils/apiClient', () => ({
  apiClient: {
    statistics: {
      summary: mocks.summary,
      topIntentions: mocks.topIntentions,
      heatmap: vi.fn(),
    },
  },
}));

vi.mock('../utils/backendUrl', () => ({
  getBackendOrigin: () => 'https://pomi.test',
}));

vi.mock('./authStore', () => ({
  useAuthStoreBase: {
    getState: () => mocks.auth,
    subscribe: vi.fn(listener => {
      mocks.authListener = listener;
    }),
  },
}));

const summaryBody = {
  availableIntentions: [],
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolver => {
    resolve = resolver;
  });
  return { promise, resolve };
};

beforeEach(async () => {
  mocks.summary.mockReset();
  mocks.topIntentions.mockReset();
  mocks.auth = { token: 'session-a', user: { id: 'account-a' } };
  const { useStatisticsStoreBase } = await import('./statisticsStore');
  useStatisticsStoreBase.getState().invalidateStatisticsRequests();
  useStatisticsStoreBase.setState({
    statistics: null,
    error: null,
    currentIntention: '',
    currentSubIntention: '',
    currentSessionType: 'work',
    topIntentions: [],
    topIntentionsPeriod: 'week',
    metricMode: 'hours',
  });
});

describe('Statistics store request coordination', () => {
  it('shares a concurrent identical summary request within one generation', async () => {
    const response = deferred<{ status: 200; body: typeof summaryBody }>();
    mocks.summary.mockReturnValue(response.promise);
    const { useStatisticsStoreBase } = await import('./statisticsStore');

    const first = useStatisticsStoreBase
      .getState()
      .fetchStatistics('', 'work', '');
    const second = useStatisticsStoreBase
      .getState()
      .fetchStatistics('', 'work', '');

    expect(mocks.summary).toHaveBeenCalledOnce();
    response.resolve({ status: 200, body: summaryBody });
    await Promise.all([first, second]);
  });

  it('starts a fresh request after mutation invalidation and ignores the older result', async () => {
    const older = deferred<{
      status: 200;
      body: typeof summaryBody & { marker: string };
    }>();
    const fresh = deferred<{
      status: 200;
      body: typeof summaryBody & { marker: string };
    }>();
    mocks.summary
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(fresh.promise);
    const { useStatisticsStoreBase } = await import('./statisticsStore');

    const oldRequest = useStatisticsStoreBase
      .getState()
      .fetchStatistics('', 'work', '');
    useStatisticsStoreBase.getState().invalidateStatisticsRequests();
    const freshRequest = useStatisticsStoreBase
      .getState()
      .fetchStatistics('', 'work', '');

    expect(mocks.summary).toHaveBeenCalledTimes(2);
    fresh.resolve({ status: 200, body: { ...summaryBody, marker: 'fresh' } });
    await freshRequest;
    older.resolve({ status: 200, body: { ...summaryBody, marker: 'older' } });
    await oldRequest;
    expect(useStatisticsStoreBase.getState().statistics).toMatchObject({
      marker: 'fresh',
    });
  });

  it('keeps A-B-A response ownership distinct', async () => {
    const firstA = deferred<{
      status: 200;
      body: typeof summaryBody & { marker: string };
    }>();
    const responseB = deferred<{
      status: 200;
      body: typeof summaryBody & { marker: string };
    }>();
    const secondA = deferred<{
      status: 200;
      body: typeof summaryBody & { marker: string };
    }>();
    mocks.summary
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(responseB.promise)
      .mockReturnValueOnce(secondA.promise);
    const { useStatisticsStoreBase } = await import('./statisticsStore');

    const requestA = useStatisticsStoreBase
      .getState()
      .fetchStatistics('a', 'work', '');
    const requestB = useStatisticsStoreBase
      .getState()
      .fetchStatistics('b', 'work', '');
    useStatisticsStoreBase.getState().invalidateStatisticsRequests();
    const freshRequestA = useStatisticsStoreBase
      .getState()
      .fetchStatistics('a', 'work', '');

    secondA.resolve({
      status: 200,
      body: { ...summaryBody, marker: 'fresh-a' },
    });
    await freshRequestA;
    responseB.resolve({ status: 200, body: { ...summaryBody, marker: 'b' } });
    firstA.resolve({ status: 200, body: { ...summaryBody, marker: 'old-a' } });
    await Promise.all([requestA, requestB]);
    expect(useStatisticsStoreBase.getState().statistics).toMatchObject({
      marker: 'fresh-a',
    });
  });

  it('does not reuse a request after an account replacement', async () => {
    const older = deferred<{ status: 200; body: typeof summaryBody }>();
    mocks.summary
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ status: 200, body: summaryBody });
    const { useStatisticsStoreBase } = await import('./statisticsStore');

    const oldRequest = useStatisticsStoreBase
      .getState()
      .fetchStatistics('', 'work', '');
    const previous = { ...mocks.auth };
    mocks.auth = { token: 'session-b', user: { id: 'account-b' } };
    mocks.authListener?.(mocks.auth, previous);
    await useStatisticsStoreBase.getState().fetchStatistics('', 'work', '');

    expect(mocks.summary).toHaveBeenCalledTimes(2);
    older.resolve({ status: 200, body: summaryBody });
    await oldRequest;
  });

  it('removes failed requests so the same key can be retried', async () => {
    mocks.summary
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ status: 200, body: summaryBody });
    const { useStatisticsStoreBase } = await import('./statisticsStore');

    await useStatisticsStoreBase.getState().fetchStatistics('', 'work', '');
    await useStatisticsStoreBase.getState().fetchStatistics('', 'work', '');

    expect(mocks.summary).toHaveBeenCalledTimes(2);
    expect(useStatisticsStoreBase.getState().isLoading).toBe(false);
  });

  it('shares identical ranking reads and keeps distinct metrics separate', async () => {
    const response = deferred<{ status: 200; body: never[] }>();
    mocks.topIntentions
      .mockReturnValueOnce(response.promise)
      .mockResolvedValue({
        status: 200,
        body: [],
      });
    const { useStatisticsStoreBase } = await import('./statisticsStore');

    const first = useStatisticsStoreBase.getState().fetchTopIntentions();
    const second = useStatisticsStoreBase.getState().fetchTopIntentions();
    expect(mocks.topIntentions).toHaveBeenCalledOnce();
    response.resolve({ status: 200, body: [] });
    await Promise.all([first, second]);

    useStatisticsStoreBase.setState({ metricMode: 'count' });
    await useStatisticsStoreBase.getState().fetchTopIntentions();
    expect(mocks.topIntentions).toHaveBeenCalledTimes(2);
  });
});
