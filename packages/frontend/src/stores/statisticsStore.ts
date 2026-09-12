import {
  StatisticsSummary,
  TopIntentionStat,
  TopIntentionsPeriod,
} from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from '../utils/apiClient';
import { translateCurrent } from '../i18n';
import { getBackendOrigin } from '../utils/backendUrl';
import { createSelectors } from './createSelectors';
import { useAuthStoreBase } from './authStore';

interface IntentionOption {
  value: string;
  label: string;
  title: string;
  emoji: string;
  isArchived: boolean;
  hasSubIntentions?: boolean;
}

export type MetricMode = 'count' | 'hours';

export interface HeatmapYearData {
  heatmap: { date: string; count: number; duration: number }[];
  heatmapThresholds: { low: number; medium: number; high: number; max: number };
}

interface StatisticsState {
  statistics: StatisticsSummary | null;
  isLoading: boolean;
  error: string | null;
  currentIntention: string;
  currentSubIntention: string;
  currentSessionType: SessionType;
  metricMode: MetricMode;
  allAvailableIntentions: IntentionOption[];
  topIntentions: TopIntentionStat[];
  topIntentionsPeriod: TopIntentionsPeriod;
  isLoadingTopIntentions: boolean;
  heatmapYears: Record<number, HeatmapYearData>;
  loadedHeatmapYears: number[];
  isLoadingHeatmapYear: boolean;
  activeHeatmapRequestKey: string | null;
  activeSummaryRequestKey: string | null;
  activeTopIntentionsRequestKey: string | null;
  fetchStatistics: (
    intention?: string,
    sessionType?: SessionType,
    subIntention?: string
  ) => Promise<void>;
  resetViewFilters: () => void;
  setCurrentIntention: (intention: string) => void;
  setCurrentSubIntention: (subIntention: string) => void;
  setCurrentSessionType: (sessionType: SessionType) => void;
  setMetricMode: (mode: MetricMode) => void;
  fetchTopIntentions: (parentIntention?: string) => Promise<void>;
  setTopIntentionsPeriod: (period: TopIntentionsPeriod) => void;
  fetchHeatmapYear: (year: number) => Promise<void>;
  invalidateHeatmapYears: () => void;
  invalidateStatisticsRequests: () => void;
}

type SessionType =
  | typeof TIMER_TYPES.WORK
  | typeof TIMER_TYPES.BREAK
  | typeof TIMER_TYPES.LONG_BREAK;

const resetHeatmapState = {
  heatmapYears: {},
  loadedHeatmapYears: [],
  isLoadingHeatmapYear: false,
  activeHeatmapRequestKey: null,
};

let requestGeneration = 0;
let requestSequence = 0;
type CoordinatedRequest = { owner: string; promise: Promise<void> };
const summaryRequests = new Map<string, CoordinatedRequest>();
const topIntentionRequests = new Map<string, CoordinatedRequest>();

const advanceRequestGeneration = () => {
  requestGeneration += 1;
  summaryRequests.clear();
  topIntentionRequests.clear();
};

const requestAccountKey = () => {
  const auth = useAuthStoreBase.getState();
  return `${getBackendOrigin()}:${auth.user?.id ?? 'anonymous'}:${auth.token ?? 'no-session'}`;
};

const useStatisticsStoreBase = create<StatisticsState>()(
  persist(
    (set, get) => ({
      statistics: null,
      isLoading: false,
      error: null,
      currentIntention: '',
      currentSubIntention: '',
      currentSessionType: TIMER_TYPES.WORK,
      metricMode: 'hours' as MetricMode,
      allAvailableIntentions: [],
      topIntentions: [],
      topIntentionsPeriod: 'week',
      isLoadingTopIntentions: false,
      heatmapYears: {},
      loadedHeatmapYears: [],
      isLoadingHeatmapYear: false,
      activeHeatmapRequestKey: null,
      activeSummaryRequestKey: null,
      activeTopIntentionsRequestKey: null,

      fetchStatistics: async (
        intention?: string,
        sessionType?: SessionType,
        subIntention?: string
      ) => {
        const intentionToUse =
          intention !== undefined ? intention : get().currentIntention;
        const sessionTypeToUse =
          sessionType !== undefined ? sessionType : get().currentSessionType;
        const subIntentionToUse =
          subIntention !== undefined ? subIntention : get().currentSubIntention;
        const generation = requestGeneration;
        const requestKey = `${requestAccountKey()}:${generation}:${sessionTypeToUse}:${intentionToUse || '__all__'}:${subIntentionToUse || '__all__'}`;
        const existingRequest = summaryRequests.get(requestKey);
        if (
          existingRequest &&
          get().activeSummaryRequestKey === existingRequest.owner
        ) {
          return existingRequest.promise;
        }

        const owner = `summary:${++requestSequence}`;
        set({
          isLoading: true,
          error: null,
          activeSummaryRequestKey: owner,
        });

        const request = (async () => {
          try {
            const response = await apiClient.statistics.summary({
              query: {
                intention: intentionToUse,
                subIntention: subIntentionToUse || undefined,
                type: sessionTypeToUse,
              },
            });

            if (response.status === 204) {
              if (
                requestGeneration === generation &&
                get().activeSummaryRequestKey === owner
              ) {
                set({
                  statistics: null,
                  isLoading: false,
                  error: null,
                  activeSummaryRequestKey: null,
                });
              }
              return;
            }

            if (response.status !== 200) {
              if (
                requestGeneration !== generation ||
                get().activeSummaryRequestKey !== owner
              ) {
                return;
              }

              const errorBody = response.body as { message?: string } | null;
              const errorMessage =
                errorBody?.message || translateCurrent('statistics.loadFailed');
              set({
                error: errorMessage,
                isLoading: false,
                statistics: null,
                activeSummaryRequestKey: null,
              });
              return;
            }

            if (
              requestGeneration !== generation ||
              get().activeSummaryRequestKey !== owner
            ) {
              return;
            }

            const summary = response.body as StatisticsSummary | null;
            if (!summary) {
              set({
                statistics: null,
                isLoading: false,
                activeSummaryRequestKey: null,
              });
              return;
            }

            const { allAvailableIntentions } = get();
            let updatedIntentions = allAvailableIntentions;

            if (
              (!intentionToUse || allAvailableIntentions.length === 0) &&
              summary.availableIntentions?.length
            ) {
              updatedIntentions = summary.availableIntentions;
            }

            set({
              statistics: {
                ...summary,
                availableIntentions: updatedIntentions,
              },
              allAvailableIntentions: updatedIntentions,
              isLoading: false,
              currentIntention: intentionToUse,
              currentSubIntention: subIntentionToUse,
              currentSessionType: sessionTypeToUse,
              activeSummaryRequestKey: null,
            });
          } catch (err) {
            if (
              requestGeneration !== generation ||
              get().activeSummaryRequestKey !== owner
            ) {
              return;
            }

            console.error('Failed to fetch statistics:', err);
            set({
              error:
                err instanceof Error
                  ? err.message
                  : translateCurrent('statistics.loadFailed'),
              isLoading: false,
              activeSummaryRequestKey: null,
            });
          }
        })();
        summaryRequests.set(requestKey, { owner, promise: request });
        try {
          await request;
        } finally {
          if (summaryRequests.get(requestKey)?.promise === request) {
            summaryRequests.delete(requestKey);
          }
        }
      },

      resetViewFilters: () => {
        advanceRequestGeneration();
        set({
          currentIntention: '',
          currentSubIntention: '',
          currentSessionType: TIMER_TYPES.WORK,
          allAvailableIntentions: [],
          topIntentions: [],
          topIntentionsPeriod: 'week',
          isLoadingTopIntentions: false,
          activeTopIntentionsRequestKey: null,
          ...resetHeatmapState,
        });
      },

      setCurrentIntention: (intention: string) => {
        set({
          currentIntention: intention,
          currentSubIntention: '',
          ...resetHeatmapState,
        });
        get().fetchStatistics(intention, get().currentSessionType, '');
      },

      setCurrentSubIntention: (subIntention: string) => {
        set({
          currentSubIntention: subIntention,
          ...resetHeatmapState,
        });
        get().fetchStatistics(
          get().currentIntention,
          get().currentSessionType,
          subIntention
        );
      },

      setCurrentSessionType: (sessionType: SessionType) => {
        if (get().currentSessionType === sessionType) {
          return;
        }

        set({
          currentSessionType: sessionType,
          currentIntention: '',
          currentSubIntention: '',
          allAvailableIntentions: [],
          ...resetHeatmapState,
        });
        get().fetchStatistics('', sessionType);
      },

      setMetricMode: (mode: MetricMode) => {
        set({ metricMode: mode });
      },

      invalidateHeatmapYears: () => {
        set({ ...resetHeatmapState });
      },

      invalidateStatisticsRequests: () => {
        advanceRequestGeneration();
        set({
          activeSummaryRequestKey: null,
          activeTopIntentionsRequestKey: null,
          isLoading: false,
          isLoadingTopIntentions: false,
        });
      },

      fetchTopIntentions: async (parentIntention?: string) => {
        const periodToUse = get().topIntentionsPeriod;
        const sessionType = get().currentSessionType;
        const metricMode = get().metricMode;
        const generation = requestGeneration;
        const requestKey = `${requestAccountKey()}:${generation}:${sessionType}:${periodToUse}:${parentIntention || '__global__'}:${metricMode}`;
        const existingRequest = topIntentionRequests.get(requestKey);
        if (
          existingRequest &&
          get().activeTopIntentionsRequestKey === existingRequest.owner
        ) {
          return existingRequest.promise;
        }

        const owner = `top-intentions:${++requestSequence}`;
        set({
          isLoadingTopIntentions: true,
          activeTopIntentionsRequestKey: owner,
        });

        const request = (async () => {
          try {
            const response = await apiClient.statistics.topIntentions({
              query: {
                period: periodToUse,
                type: sessionType,
                parentIntention,
                metric: metricMode,
              },
            });

            if (
              requestGeneration !== generation ||
              get().activeTopIntentionsRequestKey !== owner
            ) {
              return;
            }

            if (response.status === 200) {
              set({
                topIntentions: response.body as TopIntentionStat[],
                topIntentionsPeriod: periodToUse,
                isLoadingTopIntentions: false,
                activeTopIntentionsRequestKey: null,
              });
            } else {
              set({
                isLoadingTopIntentions: false,
                activeTopIntentionsRequestKey: null,
              });
            }
          } catch (err) {
            if (
              requestGeneration !== generation ||
              get().activeTopIntentionsRequestKey !== owner
            ) {
              return;
            }
            console.error('Failed to fetch top intentions:', err);
            set({
              isLoadingTopIntentions: false,
              activeTopIntentionsRequestKey: null,
            });
          }
        })();
        topIntentionRequests.set(requestKey, { owner, promise: request });
        try {
          await request;
        } finally {
          if (topIntentionRequests.get(requestKey)?.promise === request) {
            topIntentionRequests.delete(requestKey);
          }
        }
      },

      setTopIntentionsPeriod: (period: TopIntentionsPeriod) => {
        set({ topIntentionsPeriod: period });
      },

      fetchHeatmapYear: async (year: number) => {
        const {
          loadedHeatmapYears,
          isLoadingHeatmapYear,
          currentIntention,
          currentSubIntention,
          currentSessionType,
        } = get();

        if (loadedHeatmapYears.includes(year) || isLoadingHeatmapYear) return;

        const requestKey = `${currentSessionType}:${currentIntention || '__all__'}:${currentSubIntention || '__all__'}:${year}`;

        set({
          isLoadingHeatmapYear: true,
          activeHeatmapRequestKey: requestKey,
        });

        try {
          const response = await apiClient.statistics.heatmap({
            query: {
              year,
              type: currentSessionType,
              intention: currentIntention || undefined,
              subIntention: currentSubIntention || undefined,
            },
          });

          if (get().activeHeatmapRequestKey !== requestKey) {
            return;
          }

          if (response.status === 200) {
            const data = response.body as HeatmapYearData;
            set(state => ({
              heatmapYears: { ...state.heatmapYears, [year]: data },
              loadedHeatmapYears: [...state.loadedHeatmapYears, year].sort(
                (a, b) => b - a
              ),
              isLoadingHeatmapYear: false,
              activeHeatmapRequestKey: null,
            }));
          } else {
            set({ isLoadingHeatmapYear: false, activeHeatmapRequestKey: null });
          }
        } catch (err) {
          console.error('Failed to fetch heatmap year:', err);

          if (get().activeHeatmapRequestKey === requestKey) {
            set({ isLoadingHeatmapYear: false, activeHeatmapRequestKey: null });
          }
        }
      },
    }),
    {
      name: 'pomi-statistics-view',
      partialize: state => ({ metricMode: state.metricMode }),
    }
  )
);

export const useStatisticsStore = createSelectors(useStatisticsStoreBase);
export { useStatisticsStoreBase };

useAuthStoreBase.subscribe((state, previousState) => {
  if (
    state.token === previousState.token &&
    state.user?.id === previousState.user?.id
  ) {
    return;
  }

  advanceRequestGeneration();
  if (state.user?.id === previousState.user?.id) {
    useStatisticsStoreBase.setState({
      isLoading: false,
      isLoadingTopIntentions: false,
      activeSummaryRequestKey: null,
      activeTopIntentionsRequestKey: null,
    });
    return;
  }

  useStatisticsStoreBase.setState({
    statistics: null,
    isLoading: false,
    error: null,
    allAvailableIntentions: [],
    topIntentions: [],
    isLoadingTopIntentions: false,
    activeSummaryRequestKey: null,
    activeTopIntentionsRequestKey: null,
    ...resetHeatmapState,
  });
});
