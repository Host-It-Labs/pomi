import type {
  Intention,
  TaskEventLog,
  TaskStatisticsFilter,
  TaskStatisticsSummary,
  TopIntentionsPeriod,
} from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { FaHistory, FaQuestionCircle, FaUndo } from 'react-icons/fa';
import { BackButton } from '../components/BackButton';
import { CenteredPageHeader } from '../components/CenteredPageHeader';
import {
  IntentionAssignmentPicker,
  type IntentionAssignmentOption,
} from '../components/intentions/IntentionAssignmentPicker';
import { Alert } from '../components/ui/Alert';
import { IconButton } from '../components/ui/IconButton';
import { IntentionEmojiPair } from '../components/ui/IntentionEmojiPair';
import { Modal } from '../components/ui/Modal';
import { PageContainer } from '../components/ui/PageContainer';
import { PageShell } from '../components/ui/PageShell';
import { Spinner } from '../components/ui/Spinner';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useStatisticsStore } from '../stores/statisticsStore';
import { apiClient } from '../utils/apiClient';
import { submitUserMutation } from '../utils/userActionQueue';
import { isDesktop } from '../utils/osUtils';
import { LazyHeatmap } from './statistics/LazyHeatmap';
import { StatCard } from './statistics/StatCard';
import { TopIntentions } from './statistics/TopIntentions';
import { WorkTimerLogsModal } from './statistics/WorkTimerLogsModal';
import { useI18n } from '../i18n';

export function Statistics() {
  const { t } = useI18n();
  const statistics = useStatisticsStore.use.statistics();
  const isLoading = useStatisticsStore.use.isLoading();
  const error = useStatisticsStore.use.error();
  const fetchStatistics = useStatisticsStore.use.fetchStatistics();
  const resetViewFilters = useStatisticsStore.use.resetViewFilters();
  const currentIntention = useStatisticsStore.use.currentIntention();
  const currentSubIntention = useStatisticsStore.use.currentSubIntention();
  const setCurrentIntention = useStatisticsStore.use.setCurrentIntention();
  const setCurrentSubIntention =
    useStatisticsStore.use.setCurrentSubIntention();
  const currentSessionType = useStatisticsStore.use.currentSessionType();
  const setCurrentSessionType = useStatisticsStore.use.setCurrentSessionType();
  const topIntentions = useStatisticsStore.use.topIntentions();
  const topIntentionsPeriod = useStatisticsStore.use.topIntentionsPeriod();
  const isLoadingTopIntentions =
    useStatisticsStore.use.isLoadingTopIntentions();
  const fetchTopIntentions = useStatisticsStore.use.fetchTopIntentions();
  const setTopIntentionsPeriod =
    useStatisticsStore.use.setTopIntentionsPeriod();
  const invalidateHeatmapYears =
    useStatisticsStore.use.invalidateHeatmapYears();
  const metricMode = useStatisticsStore.use.metricMode();
  const setMetricMode = useStatisticsStore.use.setMetricMode();

  const preferences = usePreferencesStore.use.preferences();
  const [isWorkTimerLogsOpen, setIsWorkTimerLogsOpen] = useState(false);
  const [statsMode, setStatsMode] = useState<'timer' | 'tasks'>('timer');
  const [taskStatistics, setTaskStatistics] =
    useState<TaskStatisticsSummary | null>(null);
  const [taskStatsView, setTaskStatsView] = useState<'overview' | 'activity'>(
    'activity'
  );
  const [taskStatsFilter, setTaskStatsFilter] =
    useState<TaskStatisticsFilter>('completed');
  const [taskRankingPeriod, setTaskRankingPeriod] =
    useState<TopIntentionsPeriod>('week');
  const [isTaskLogsOpen, setIsTaskLogsOpen] = useState(false);
  const [isIntentionPickerOpen, setIsIntentionPickerOpen] = useState(false);
  const [subIntentionsByParent, setSubIntentionsByParent] = useState<
    Record<
      string,
      Array<{
        slug: string;
        title: string;
        emoji: string;
        isArchived?: boolean;
      }>
    >
  >({});
  const selectedAvailableIntention = statistics?.availableIntentions?.find(
    intention => intention.value === currentIntention
  );
  const selectedIntentionHasSubs = Boolean(
    preferences?.intentionSubIntentions &&
    currentIntention &&
    currentIntention !== 'none' &&
    (selectedAvailableIntention?.hasSubIntentions ||
      (subIntentionsByParent[currentIntention]?.length ?? 0) > 0)
  );

  useEffect(() => {
    resetViewFilters();
    fetchStatistics('', TIMER_TYPES.WORK, '');
  }, [fetchStatistics, resetViewFilters]);

  useEffect(() => {
    if (statsMode !== 'tasks') {
      return;
    }

    refreshTaskStatistics();
  }, [statsMode, taskRankingPeriod, taskStatsFilter]);

  const refreshTaskStatistics = () => {
    if (statsMode !== 'tasks') {
      return;
    }

    apiClient.tasks
      .statistics({
        query: {
          filter: taskStatsFilter,
          rankingPeriod: taskRankingPeriod,
        },
      })
      .then(response => {
        if (response.status === 200) {
          setTaskStatistics(response.body);
        }
      });
  };

  useEffect(() => {
    if (!preferences?.intentionExtension) {
      return;
    }

    fetchTopIntentions(selectedIntentionHasSubs ? currentIntention : undefined);
  }, [
    currentSessionType,
    currentIntention,
    fetchTopIntentions,
    preferences?.intentionExtension,
    selectedIntentionHasSubs,
    topIntentionsPeriod,
    metricMode,
  ]);

  useEffect(() => {
    let isCancelled = false;

    if (!preferences?.intentionSubIntentions) {
      setSubIntentionsByParent({});
      return;
    }

    apiClient.intentions
      .list({
        query: {
          type: currentSessionType,
          includeSubIntentions: true,
        },
      })
      .then(response => {
        if (isCancelled) return;
        if (response.status !== 200) {
          setSubIntentionsByParent({});
          return;
        }

        const parentsById = new Map(
          response.body
            .filter(intention => !intention.parentIntentionId)
            .map(intention => [intention.id, intention.slug])
        );
        const groupedSubIntentions = response.body.reduce(
          (grouped, intention) => {
            if (!intention.parentIntentionId) return grouped;

            const parentSlug =
              intention.parentIntention?.slug ??
              parentsById.get(intention.parentIntentionId);
            if (!parentSlug) return grouped;

            grouped[parentSlug] = [
              ...(grouped[parentSlug] ?? []),
              {
                slug: intention.slug,
                title: intention.title,
                emoji: intention.emoji,
                isArchived: intention.isArchived,
              },
            ];
            return grouped;
          },
          {} as Record<
            string,
            Array<{
              slug: string;
              title: string;
              emoji: string;
              isArchived?: boolean;
            }>
          >
        );
        setSubIntentionsByParent(groupedSubIntentions);
      })
      .catch(() => {
        if (!isCancelled) {
          setSubIntentionsByParent({});
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [currentSessionType, preferences?.intentionSubIntentions]);

  const statisticsIntentionOptions = useMemo<IntentionAssignmentOption[]>(
    () => [
      {
        value: 'none',
        title: t('statistics.noIntention'),
        emoji: '❓',
      },
      ...(statistics?.availableIntentions ?? []).map(intention => ({
        value: intention.value,
        title: intention.title,
        emoji: intention.emoji,
        group: intention.isArchived ? 'Archived' : undefined,
      })),
    ],
    [statistics?.availableIntentions, t]
  );

  const refreshStatisticsAfterLogMutation = () => {
    invalidateHeatmapYears();
    void fetchStatistics(
      currentIntention,
      currentSessionType,
      currentSubIntention
    );

    if (preferences?.intentionExtension) {
      void fetchTopIntentions(
        selectedIntentionHasSubs ? currentIntention : undefined
      );
    }
  };

  const taskHeatmapYears = useMemo(() => {
    const years: Record<
      number,
      {
        heatmap: { date: string; count: number; duration: number }[];
        heatmapThresholds: {
          low: number;
          medium: number;
          high: number;
          max: number;
        };
      }
    > = {};

    if (!taskStatistics) {
      return years;
    }

    taskStatistics.heatmap.forEach(day => {
      const year = Number(day.date.slice(0, 4));
      if (!Number.isFinite(year)) {
        return;
      }

      years[year] ??= {
        heatmap: [],
        heatmapThresholds: taskStatistics.heatmapThresholds,
      };
      years[year].heatmap.push(day);
    });

    return years;
  }, [taskStatistics]);
  const taskLoadedHeatmapYears = useMemo(
    () => Object.keys(taskHeatmapYears).map(Number),
    [taskHeatmapYears]
  );

  if (isLoading && !statistics) {
    return (
      <PageShell>
        <PageContainer className="p-6">
          <BackButton targetTab="timer" />
          <div className="flex items-center justify-center h-64 text-indigo-500">
            <Spinner size="lg" />
          </div>
        </PageContainer>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <PageContainer className="p-6">
          <BackButton targetTab="timer" />
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        </PageContainer>
      </PageShell>
    );
  }

  if (!statistics) {
    return (
      <PageShell>
        <PageContainer className="p-6 text-white">
          <BackButton targetTab="timer" />
          <p className="mt-4">{t('statistics.none')}</p>
        </PageContainer>
      </PageShell>
    );
  }

  const statPeriods = [
    { title: t('statistics.today'), ...statistics.today },
    { title: t('statistics.week'), ...statistics.week },
    { title: t('statistics.month'), ...statistics.month },
    { title: t('statistics.year'), ...statistics.year },
  ];

  return (
    <PageShell>
      <PageContainer className=" text-white">
        <div
          className={
            isDesktop ? 'pt-6' : 'pt-[calc(env(safe-area-inset-top)+0.25rem)]'
          }
        >
          <div className="mb-3 space-y-2" data-testid="statistics-controls">
            <CenteredPageHeader
              title={t('statistics.title')}
              action={
                (statsMode === 'tasks' ||
                  preferences?.workTimerLogsExtension) && (
                  <IconButton
                    onClick={() =>
                      statsMode === 'tasks'
                        ? setIsTaskLogsOpen(true)
                        : setIsWorkTimerLogsOpen(true)
                    }
                    label={
                      statsMode === 'tasks'
                        ? t('statistics.taskLogs')
                        : t('statistics.workTimerLogs')
                    }
                    title={t('statistics.logs')}
                    variant="secondary"
                    size="sm"
                    className="h-8 w-8 !p-0"
                  >
                    <FaHistory size={12} />
                  </IconButton>
                )
              }
            />

            <div
              className="grid grid-cols-2 rounded-lg border border-slate-800/80 bg-slate-900/55 p-1 text-xs"
              aria-label={t('statistics.category')}
            >
              <button
                type="button"
                aria-pressed={statsMode === 'timer'}
                onClick={() => setStatsMode('timer')}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  statsMode === 'timer'
                    ? 'bg-slate-700/80 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {t('statistics.timers')}
              </button>
              <button
                type="button"
                aria-pressed={statsMode === 'tasks'}
                onClick={() => setStatsMode('tasks')}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  statsMode === 'tasks'
                    ? 'bg-slate-700/80 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {t('statistics.tasks')}
              </button>
            </div>

            <div className="rounded-lg border border-slate-800/80 bg-slate-900/35 p-2">
              {statsMode === 'timer' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="flex rounded-md border border-slate-800 bg-slate-950/45 p-0.5 text-xs"
                      aria-label={t('statistics.timerType')}
                    >
                      <button
                        type="button"
                        aria-pressed={currentSessionType === TIMER_TYPES.WORK}
                        onClick={() => setCurrentSessionType(TIMER_TYPES.WORK)}
                        className={`rounded px-2.5 py-1 transition-colors ${
                          currentSessionType === TIMER_TYPES.WORK
                            ? 'bg-indigo-600/35 text-indigo-100'
                            : 'text-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {t('common.work')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={currentSessionType === TIMER_TYPES.BREAK}
                        onClick={() => setCurrentSessionType(TIMER_TYPES.BREAK)}
                        className={`rounded px-2.5 py-1 transition-colors ${
                          currentSessionType === TIMER_TYPES.BREAK
                            ? 'bg-green-600/35 text-green-100'
                            : 'text-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {t('common.break')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={
                          currentSessionType === TIMER_TYPES.LONG_BREAK
                        }
                        onClick={() =>
                          setCurrentSessionType(TIMER_TYPES.LONG_BREAK)
                        }
                        className={`rounded px-2.5 py-1 transition-colors ${
                          currentSessionType === TIMER_TYPES.LONG_BREAK
                            ? 'bg-purple-600/35 text-purple-100'
                            : 'text-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {t('common.longBreak')}
                      </button>
                    </div>

                    <div
                      className="flex rounded-md border border-slate-800 bg-slate-950/45 p-0.5 text-xs"
                      aria-label={t('statistics.measure')}
                    >
                      <button
                        type="button"
                        aria-pressed={metricMode === 'hours'}
                        onClick={() => setMetricMode('hours')}
                        className={`rounded px-2.5 py-1 transition-colors ${
                          metricMode === 'hours'
                            ? 'bg-slate-700 text-slate-100'
                            : 'text-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {t('statistics.hours')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={metricMode === 'count'}
                        onClick={() => setMetricMode('count')}
                        className={`rounded px-2.5 py-1 transition-colors ${
                          metricMode === 'count'
                            ? 'bg-slate-700 text-slate-100'
                            : 'text-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {t('statistics.count')}
                      </button>
                    </div>
                  </div>

                  {preferences?.intentionExtension &&
                    statistics?.availableIntentions && (
                      <IntentionAssignmentPicker
                        label={t('statistics.intention')}
                        options={statisticsIntentionOptions}
                        subIntentionsByParent={subIntentionsByParent}
                        selectedIntentions={
                          currentIntention ? [currentIntention] : []
                        }
                        selectedSubIntentions={
                          currentSubIntention && currentIntention
                            ? { [currentIntention]: currentSubIntention }
                            : {}
                        }
                        mode="single"
                        isOpen={isIntentionPickerOpen}
                        onOpenChange={setIsIntentionPickerOpen}
                        onChange={change => {
                          const intention = change.intentionSlugs[0] ?? '';
                          setCurrentIntention(intention);
                          setCurrentSubIntention(
                            intention
                              ? (change.subIntentions[intention] ?? '')
                              : ''
                          );
                        }}
                        allowClear
                        clearLabel={t('intention.all')}
                        parentSelectionLabel={t('intention.allSubIntentions')}
                        noSelectionLabel={t('intention.all')}
                        showLabel={false}
                        searchPlaceholder={t('intention.search')}
                        triggerClassName="h-8 text-xs"
                        dropdownClassName="left-0 right-0 w-full"
                      />
                    )}
                </div>
              ) : (
                <TaskStatsSelector
                  view={taskStatsView}
                  filter={taskStatsFilter}
                  onViewChange={setTaskStatsView}
                  onFilterChange={setTaskStatsFilter}
                />
              )}
            </div>
          </div>

          {statsMode === 'tasks' && taskStatsView === 'overview' ? (
            <div
              className="grid grid-cols-5 gap-1.5 rounded-lg border border-slate-800 bg-slate-900 p-2"
              data-testid="task-statistics-overview"
            >
              {[
                [t('statistics.active'), taskStatistics?.overview.active ?? 0],
                [
                  t('statistics.recurring'),
                  taskStatistics?.overview.recurring ?? 0,
                ],
                [
                  t('statistics.overdue'),
                  taskStatistics?.overview.overdue ?? 0,
                ],
                [
                  t('statistics.undated'),
                  taskStatistics?.overview.undated ?? 0,
                ],
                [t('statistics.pinned'), taskStatistics?.overview.pinned ?? 0],
              ].map(([label, count]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-md border border-slate-800 bg-slate-950/35 px-1 py-3 text-center"
                >
                  <div className="text-lg font-semibold text-slate-100">
                    {count}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          ) : statsMode === 'tasks' ? (
            <div className="space-y-2" data-testid="task-statistics-panel">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
                <div className="flex items-stretch rounded-lg border border-slate-800 bg-slate-950/35 px-1 py-1">
                  {[
                    {
                      title: t('statistics.today'),
                      count: taskStatistics?.today.count ?? 0,
                      change: taskStatistics?.today.change ?? null,
                    },
                    {
                      title: t('statistics.week'),
                      count: taskStatistics?.week.count ?? 0,
                      change: taskStatistics?.week.change ?? null,
                    },
                    {
                      title: t('statistics.month'),
                      count: taskStatistics?.month.count ?? 0,
                      change: taskStatistics?.month.change ?? null,
                    },
                    {
                      title: t('statistics.year'),
                      count: taskStatistics?.year.count ?? 0,
                      change: taskStatistics?.year.change ?? null,
                    },
                  ].map((period, index) => (
                    <Fragment key={period.title}>
                      {index > 0 && (
                        <div className="w-px shrink-0 bg-slate-800" />
                      )}
                      <StatCard
                        title={period.title}
                        count={period.count}
                        duration={0}
                        change={period.change}
                        durationChange={null}
                        metricMode="count"
                      />
                    </Fragment>
                  ))}
                </div>
              </div>
              <LazyHeatmap
                firstLogDate={taskStatistics?.firstLogDate ?? null}
                metricMode="count"
                heatmapYears={taskHeatmapYears}
                loadedHeatmapYears={taskLoadedHeatmapYears}
                isLoadingHeatmapYear={taskStatistics === null}
                sessionType={TIMER_TYPES.WORK}
                countLabel={t('statistics.taskCountLabel')}
              />
              <TopIntentions
                topIntentions={taskStatistics?.ranking ?? []}
                period={taskRankingPeriod}
                onPeriodChange={setTaskRankingPeriod}
                isLoading={false}
                sessionType={TIMER_TYPES.WORK}
                metricMode="count"
                showDuration={false}
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {/* Stat strip */}
                <div
                  className={`rounded-lg border border-slate-800 bg-slate-900  px-1 ${isDesktop ? 'py-1' : 'py-2'}`}
                >
                  <div className="flex items-stretch">
                    {statPeriods.map((s, i) => (
                      <Fragment key={s.title}>
                        {i > 0 && (
                          <div className="w-px bg-slate-800 shrink-0" />
                        )}
                        <StatCard
                          title={s.title}
                          count={s.count}
                          duration={s.duration}
                          change={s.change}
                          durationChange={s.durationChange}
                          metricMode={metricMode}
                        />
                      </Fragment>
                    ))}
                  </div>
                </div>

                {/* Activity heatmap */}
                <LazyHeatmap
                  firstLogDate={statistics.firstLogDate}
                  metricMode={metricMode}
                />

                {/* Top Intentions */}
                {preferences?.intentionExtension && (
                  <TopIntentions
                    topIntentions={topIntentions}
                    period={topIntentionsPeriod}
                    onPeriodChange={setTopIntentionsPeriod}
                    isLoading={isLoadingTopIntentions}
                    sessionType={currentSessionType}
                    isSubRanking={selectedIntentionHasSubs}
                    metricMode={metricMode}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <WorkTimerLogsModal
          isOpen={isWorkTimerLogsOpen}
          onClose={() => setIsWorkTimerLogsOpen(false)}
          onLogsMutated={refreshStatisticsAfterLogMutation}
          preferences={preferences}
        />
        <TaskLogsModal
          isOpen={isTaskLogsOpen}
          onClose={() => setIsTaskLogsOpen(false)}
          onLogsMutated={refreshTaskStatistics}
        />
      </PageContainer>
    </PageShell>
  );
}

const TASK_STAT_PRIMARY_FILTERS: Array<{
  value: TaskStatisticsFilter;
  labelKey: string;
}> = [
  { value: 'created', labelKey: 'statistics.created' },
  { value: 'completed', labelKey: 'statistics.completed' },
  { value: 'archived', labelKey: 'statistics.archived' },
];

const TASK_STAT_HELP: Record<TaskStatisticsFilter, string> = {
  created: 'statistics.helpCreated',
  completed: 'statistics.helpCompleted',
  overdue: 'statistics.helpOverdue',
  onTime: 'statistics.helpOnTime',
  archived: 'statistics.helpArchived',
};

function TaskStatsSelector({
  view,
  filter,
  onViewChange,
  onFilterChange,
}: {
  view: 'overview' | 'activity';
  filter: TaskStatisticsFilter;
  onViewChange: (view: 'overview' | 'activity') => void;
  onFilterChange: (filter: TaskStatisticsFilter) => void;
}) {
  const { t } = useI18n();
  const completedFilter = ['completed', 'onTime', 'overdue'].includes(filter);

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_1.75rem] items-start gap-2 text-xs">
      <div className="min-w-0 space-y-1">
        <div
          role="group"
          aria-label={t('statistics.selector')}
          className="flex w-full rounded-md border border-slate-700/55 bg-slate-950/45 p-0.5"
        >
          {TASK_STAT_PRIMARY_FILTERS.map(option => {
            const isActive =
              view === 'activity' &&
              (option.value === 'completed'
                ? completedFilter
                : filter === option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  onViewChange('activity');
                  onFilterChange(option.value);
                }}
                className={`min-w-0 flex-1 rounded px-1 py-1 transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {t(option.labelKey)}
              </button>
            );
          })}
          <div className="mx-0.5 w-px shrink-0 bg-slate-700/70" />
          <button
            type="button"
            aria-pressed={view === 'overview'}
            onClick={() => onViewChange('overview')}
            className={`min-w-0 flex-1 rounded px-1 py-1 transition-colors ${
              view === 'overview'
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {t('statistics.overview')}
          </button>
        </div>
        {view === 'activity' && completedFilter && (
          <div className="flex justify-center gap-1 border-t border-slate-800 pt-1">
            {[
              ['completed', t('common.all')],
              ['onTime', t('statistics.onTime')],
              ['overdue', t('statistics.overdue')],
            ].map(([filterValue, label]) => (
              <button
                key={filterValue}
                type="button"
                onClick={() =>
                  onFilterChange(filterValue as TaskStatisticsFilter)
                }
                className={`rounded px-2 py-0.5 transition-colors ${
                  filter === filterValue
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {view === 'activity' ? (
        <TaskStatsHelp filter={filter} />
      ) : (
        <span aria-hidden="true" className="block h-7 w-7" />
      )}
    </div>
  );
}

function TaskStatsHelp({ filter }: { filter: TaskStatisticsFilter }) {
  const { t } = useI18n();
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={t('statistics.help')}
        title={t('statistics.help')}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700/50 bg-slate-900/80 text-slate-400 transition hover:text-slate-100"
      >
        <FaQuestionCircle size={13} />
      </button>
      <div className="pointer-events-none absolute right-0 top-8 z-20 hidden w-56 rounded-lg border border-slate-700/50 bg-slate-950/95 p-2 text-xs text-slate-300 shadow-lg shadow-slate-950/40 backdrop-blur-sm group-hover:block">
        {t(TASK_STAT_HELP[filter])}
      </div>
    </div>
  );
}

function TaskLogsModal({
  isOpen,
  onClose,
  onLogsMutated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLogsMutated: () => void;
}) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<TaskEventLog[]>([]);
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [isRevertingLogId, setIsRevertingLogId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTaskLogs = useCallback(async () => {
    if (!isOpen) {
      return;
    }

    setErrorMessage(null);
    const [logsResponse, intentionsResponse] = await Promise.all([
      apiClient.tasks.logs({ query: { limit: 50, offset: 0 } }),
      apiClient.intentions.list({ query: { includeSubIntentions: true } }),
    ]);
    if (logsResponse.status === 200) {
      setLogs(logsResponse.body);
    }
    if (intentionsResponse.status === 200) {
      setIntentions(intentionsResponse.body);
    }
  }, [isOpen]);

  useEffect(() => {
    void loadTaskLogs();
  }, [loadTaskLogs]);

  const revertLog = async (log: TaskEventLog) => {
    if (!log.canRevert || isRevertingLogId) {
      return;
    }

    setIsRevertingLogId(log.id);
    setErrorMessage(null);
    try {
      const result = await submitUserMutation({
        kind: 'tasks',
        label: t('statistics.revertTaskChange'),
        payload: { operation: 'revert', eventId: log.id },
        reconcile: async () => {
          await loadTaskLogs();
          onLogsMutated();
        },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: unknown })
          : { status: 200, body: result };

      if (response.status === 200) {
        loadTaskLogs();
        onLogsMutated();
        return;
      }

      setErrorMessage(
        (response.body as { message?: string }).message ??
          t('statistics.revertFailed')
      );
    } catch {
      setErrorMessage(t('statistics.revertFailed'));
    } finally {
      setIsRevertingLogId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('statistics.taskLogs')}
      closeOnBackdropClick
      closeOnEscape
    >
      <div className="max-h-[70vh] space-y-2 overflow-y-auto">
        {errorMessage && (
          <Alert variant="error" className="mb-2">
            {errorMessage}
          </Alert>
        )}
        {logs.length === 0 ? (
          <p className="text-sm text-slate-400">{t('statistics.noTaskLogs')}</p>
        ) : (
          logs.map(log => {
            const { parentEmoji, subEmoji } = getTaskLogEmojis(log, intentions);

            return (
              <div
                key={log.id}
                data-testid="task-log-row"
                data-task-title={log.title}
                className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      {(parentEmoji || subEmoji) && (
                        <IntentionEmojiPair
                          parentEmoji={parentEmoji}
                          subEmoji={subEmoji}
                          size="xs"
                        />
                      )}
                      <div className="truncate text-sm font-semibold text-slate-100">
                        {log.title}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] uppercase text-slate-500">
                      <span>{log.eventType}</span>
                      <span>{t(`common.${log.priority}`)}</span>
                      {log.isOverdue && (
                        <span className="text-red-300">
                          {t('statistics.late')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-400">
                    <div>{log.date}</div>
                    <div>
                      {new Date(log.occurredAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {log.canRevert && (
                      <button
                        type="button"
                        onClick={() => revertLog(log)}
                        disabled={isRevertingLogId !== null}
                        title={t('statistics.revertLatest')}
                        className="mt-2 inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-amber-400/60 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FaUndo size={10} />
                        {t('common.revert')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function getTaskLogEmojis(log: TaskEventLog, intentions: Intention[]) {
  return {
    parentEmoji: intentions.find(
      intention => intention.slug === log.intentionSlug
    )?.emoji,
    subEmoji: intentions.find(
      intention => intention.slug === log.subIntentionSlug
    )?.emoji,
  };
}
