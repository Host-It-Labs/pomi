import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HeatmapYearData, MetricMode } from '../../stores/statisticsStore';
import { useStatisticsStore } from '../../stores/statisticsStore';
import { MILLISECONDS_PER_MINUTE } from '../../constants/time';
import { useI18n } from '../../i18n';

function getCellClass(
  value: number,
  thresholds: { low: number; medium: number; high: number; max: number },
  sessionType: string
) {
  if (value === 0) return 'bg-slate-700/50';
  if (sessionType === TIMER_TYPES.WORK) {
    if (value < thresholds.medium) return 'bg-blue-900';
    if (value < thresholds.high) return 'bg-blue-700';
    if (value < thresholds.max) return 'bg-blue-500';
    return 'bg-cyan-300';
  }
  if (sessionType === TIMER_TYPES.LONG_BREAK) {
    if (value < thresholds.medium) return 'bg-purple-900';
    if (value < thresholds.high) return 'bg-purple-700';
    if (value < thresholds.max) return 'bg-purple-500';
    return 'bg-purple-300';
  }
  if (value < thresholds.medium) return 'bg-green-900';
  if (value < thresholds.high) return 'bg-green-700';
  if (value < thresholds.max) return 'bg-green-500';
  return 'bg-emerald-300';
}

function formatLegendRange(start: number, end: number) {
  if (end <= start) {
    return `${start}`;
  }

  return `${start}-${end}`;
}

function formatDurationCompact(ms: number): string {
  const minutes = Math.round(ms / MILLISECONDS_PER_MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function calculateThresholdsFromValues(values: number[]): {
  low: number;
  medium: number;
  high: number;
  max: number;
} {
  const nonZero = values.filter(v => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return { low: 1, medium: 2, high: 3, max: 4 };

  const q1 = Math.floor(nonZero.length * 0.25);
  const q2 = Math.floor(nonZero.length * 0.5);
  const q3 = Math.floor(nonZero.length * 0.75);

  return {
    low: nonZero[0],
    medium: nonZero[q1] || nonZero[0],
    high: nonZero[q2] || nonZero[q1] || nonZero[0],
    max: nonZero[q3] || nonZero[q2] || nonZero[0],
  };
}

export function LazyHeatmap({
  firstLogDate,
  metricMode,
  heatmapYears: staticHeatmapYears,
  loadedHeatmapYears: staticLoadedHeatmapYears,
  isLoadingHeatmapYear: staticIsLoadingHeatmapYear,
  sessionType,
  countLabel,
}: {
  firstLogDate: string | null;
  metricMode: MetricMode;
  heatmapYears?: Record<number, HeatmapYearData>;
  loadedHeatmapYears?: number[];
  isLoadingHeatmapYear?: boolean;
  sessionType?: string;
  countLabel?: string;
}) {
  const { locale, t } = useI18n();
  const resolvedCountLabel = countLabel ?? t('statistics.sessionCountLabel');
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        new Intl.DateTimeFormat(locale, { month: 'short' }).format(
          new Date(2024, month, 1)
        )
      ),
    [locale]
  );
  const weekdayNames = useMemo(
    () =>
      Array.from({ length: 7 }, (_, day) =>
        new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(
          new Date(2024, 8, day + 1)
        )
      ),
    [locale]
  );
  const cellDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale]
  );
  const storeHeatmapYears = useStatisticsStore.use.heatmapYears();
  const storeLoadedHeatmapYears = useStatisticsStore.use.loadedHeatmapYears();
  const storeIsLoadingHeatmapYear =
    useStatisticsStore.use.isLoadingHeatmapYear();
  const fetchHeatmapYear = useStatisticsStore.use.fetchHeatmapYear();
  const storeCurrentSessionType = useStatisticsStore.use.currentSessionType();
  const currentIntention = useStatisticsStore.use.currentIntention();
  const currentSubIntention = useStatisticsStore.use.currentSubIntention();
  const isStaticHeatmap = staticHeatmapYears !== undefined;
  const heatmapYears = staticHeatmapYears ?? storeHeatmapYears;
  const loadedHeatmapYears =
    staticLoadedHeatmapYears ?? storeLoadedHeatmapYears;
  const isLoadingHeatmapYear =
    staticIsLoadingHeatmapYear ?? storeIsLoadingHeatmapYear;
  const currentSessionType = sessionType ?? storeCurrentSessionType;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentHeightRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(188);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const firstYear = firstLogDate
    ? parseInt(firstLogDate.split('-')[0])
    : currentYear;
  const firstMonth = firstLogDate
    ? parseInt(firstLogDate.split('-')[1])
    : currentMonth;

  useEffect(() => {
    if (isStaticHeatmap) {
      return;
    }

    if (isLoadingHeatmapYear) {
      return;
    }

    const initialYears = [currentYear];
    if (currentYear - 1 >= firstYear) {
      initialYears.push(currentYear - 1);
    }

    const nextYear = initialYears.find(
      year => !loadedHeatmapYears.includes(year)
    );

    if (nextYear !== undefined) {
      void fetchHeatmapYear(nextYear);
    }
  }, [
    currentYear,
    currentIntention,
    currentSubIntention,
    currentSessionType,
    fetchHeatmapYear,
    firstYear,
    isStaticHeatmap,
    isLoadingHeatmapYear,
    loadedHeatmapYears,
  ]);

  const handleScroll = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element || isLoadingHeatmapYear || loadedHeatmapYears.length === 0) {
      return;
    }

    if (element.scrollLeft + element.clientWidth >= element.scrollWidth - 200) {
      const oldestLoadedYear = Math.min(...loadedHeatmapYears);
      const nextYear = oldestLoadedYear - 1;
      if (nextYear >= firstYear) {
        fetchHeatmapYear(nextYear);
      }
    }
  }, [fetchHeatmapYear, firstYear, isLoadingHeatmapYear, loadedHeatmapYears]);

  const allMonths = useMemo(() => {
    const sortedYears = Object.keys(heatmapYears)
      .map(Number)
      .sort((a, b) => a - b);

    if (sortedYears.length === 0) {
      return [] as Array<{ year: number; month: number }>;
    }

    const months: Array<{ year: number; month: number }> = [];
    const oldestYear = sortedYears[0];
    const oldestMonth = oldestYear === firstYear ? firstMonth : 1;

    for (let year = oldestYear; year <= currentYear; year += 1) {
      const monthStart = year === oldestYear ? oldestMonth : 1;
      const monthEnd = year === currentYear ? currentMonth : 12;

      for (let month = monthStart; month <= monthEnd; month += 1) {
        months.push({ year, month });
      }
    }

    months.reverse();
    return months;
  }, [currentMonth, currentYear, firstMonth, firstYear, heatmapYears]);

  useEffect(() => {
    if (allMonths.length === 0 || !contentHeightRef.current) {
      return;
    }

    setContentHeight(contentHeightRef.current.offsetHeight);
  }, [
    allMonths.length,
    currentIntention,
    currentSessionType,
    currentSubIntention,
    heatmapYears,
  ]);

  const dataMap = useMemo(() => {
    const map = new Map<string, number>();
    const isHours = metricMode === 'hours';
    for (const yearData of Object.values(heatmapYears)) {
      for (const day of yearData.heatmap) {
        map.set(day.date, isHours ? day.duration : day.count);
      }
    }
    return map;
  }, [heatmapYears, metricMode]);

  const mergedThresholds = useMemo(() => {
    if (metricMode === 'hours') {
      const allValues = Array.from(dataMap.values());
      return calculateThresholdsFromValues(allValues);
    }

    const thresholds = Object.values(heatmapYears).map(
      yearData => yearData.heatmapThresholds
    );

    if (thresholds.length === 0) {
      return { low: 1, medium: 2, high: 4, max: 6 };
    }

    return {
      low: Math.min(...thresholds.map(threshold => threshold.low)),
      medium: Math.max(...thresholds.map(threshold => threshold.medium)),
      high: Math.max(...thresholds.map(threshold => threshold.high)),
      max: Math.max(...thresholds.map(threshold => threshold.max)),
    };
  }, [dataMap, heatmapYears, metricMode]);

  const legendColors =
    currentSessionType === TIMER_TYPES.WORK
      ? [
          'bg-slate-700/50',
          'bg-blue-900',
          'bg-blue-700',
          'bg-blue-500',
          'bg-cyan-300',
        ]
      : currentSessionType === TIMER_TYPES.LONG_BREAK
        ? [
            'bg-slate-700/50',
            'bg-purple-900',
            'bg-purple-700',
            'bg-purple-500',
            'bg-purple-300',
          ]
        : [
            'bg-slate-700/50',
            'bg-green-900',
            'bg-green-700',
            'bg-green-500',
            'bg-emerald-300',
          ];

  const legendLabels =
    metricMode === 'hours'
      ? [
          '0',
          formatDurationCompact(mergedThresholds.low),
          formatDurationCompact(mergedThresholds.medium),
          formatDurationCompact(mergedThresholds.high),
          `${formatDurationCompact(mergedThresholds.max)}+`,
        ]
      : [
          '0',
          formatLegendRange(1, Math.max(1, mergedThresholds.medium - 1)),
          formatLegendRange(
            mergedThresholds.medium,
            Math.max(mergedThresholds.medium, mergedThresholds.high - 1)
          ),
          formatLegendRange(
            mergedThresholds.high,
            Math.max(mergedThresholds.high, mergedThresholds.max - 1)
          ),
          `${mergedThresholds.max}+`,
        ];

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }

    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) {
      return;
    }

    event.preventDefault();
    element.scrollLeft += event.deltaY;
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 pb-3 pt-4">
      {allMonths.length === 0 ? (
        <div
          className="flex items-center justify-center text-sm text-slate-500"
          style={{ minHeight: `${contentHeight}px` }}
        >
          {isLoadingHeatmapYear
            ? t('statistics.loadingActivity')
            : t('statistics.noActivity')}
        </div>
      ) : (
        <div ref={contentHeightRef} className="relative">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            onWheel={handleWheel}
            className="app-scrollbar overflow-x-auto overflow-y-hidden  pr-3 scroll-smooth"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="flex w-max flex-nowrap gap-3">
              {allMonths.map(({ year, month }) => {
                const daysInMonth = new Date(year, month, 0).getDate();
                const firstDay = new Date(year, month - 1, 1).getDay();

                return (
                  <div key={`${year}-${month}`} className="shrink-0">
                    <div className="mb-1 text-center text-xs text-slate-500">
                      {monthNames[month - 1]} {year}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                      {weekdayNames.map((label, index) => (
                        <div
                          key={index}
                          className="h-3 w-3 text-center text-[9px] leading-3 text-slate-600"
                        >
                          {label}
                        </div>
                      ))}
                      {Array.from({ length: firstDay }).map((_, index) => (
                        <div key={`e-${index}`} className="h-3 w-3" />
                      ))}
                      {Array.from({ length: daysInMonth }).map((_, index) => {
                        const day = (index + 1).toString().padStart(2, '0');
                        const monthString = month.toString().padStart(2, '0');
                        const dateString = `${year}-${monthString}-${day}`;
                        const localizedDate = cellDateFormatter.format(
                          new Date(year, month - 1, index + 1)
                        );
                        const value = dataMap.get(dateString) || 0;
                        const tooltip =
                          metricMode === 'hours'
                            ? t('statistics.activityDuration', {
                                date: localizedDate,
                                duration: formatDurationCompact(value),
                              })
                            : t('statistics.activityCount', {
                                date: localizedDate,
                                count: value,
                                label: resolvedCountLabel,
                              });

                        return (
                          <div
                            key={dateString}
                            className={`h-3 w-3 rounded-sm ${getCellClass(value, mergedThresholds, currentSessionType)}`}
                            title={tooltip}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div className="mt-2 flex items-start justify-center gap-0.5 text-[10px] text-slate-500">
        {legendColors.map((className, index) => (
          <div
            key={index}
            className="flex min-w-5 flex-col items-center gap-0.5"
          >
            <div className={`h-3 w-3 rounded-sm ${className}`} />
            <span>{legendLabels[index]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
