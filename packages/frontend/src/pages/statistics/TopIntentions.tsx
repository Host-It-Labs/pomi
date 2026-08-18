import { TopIntentionStat, TopIntentionsPeriod } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { useLayoutEffect, useRef, useState, type WheelEvent } from 'react';
import type { MetricMode } from '../../stores/statisticsStore';
import { isDesktop } from '../../utils/osUtils';
import { formatTimeWithUnit } from '../../utils/timeUtils';
import { useI18n } from '../../i18n';

const PERIODS = [
  'today',
  'week',
  'month',
  'year',
] as const satisfies TopIntentionsPeriod[];

type SessionType =
  | typeof TIMER_TYPES.WORK
  | typeof TIMER_TYPES.BREAK
  | typeof TIMER_TYPES.LONG_BREAK;

function PeriodTabs({
  period,
  onPeriodChange,
  sessionType,
}: {
  period: TopIntentionsPeriod;
  onPeriodChange: (p: TopIntentionsPeriod) => void;
  sessionType: SessionType;
}) {
  const { t } = useI18n();
  const activeTabClass =
    sessionType === TIMER_TYPES.WORK
      ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/25'
      : sessionType === TIMER_TYPES.LONG_BREAK
        ? 'bg-purple-600/40 text-purple-200 border border-purple-500/25'
        : 'bg-green-600/40 text-green-200 border border-green-500/25';

  return (
    <div className="flex bg-slate-800/30 border border-slate-700/20 rounded-lg p-0.5 gap-0.5">
      {PERIODS.map(p => (
        <button
          key={p}
          type="button"
          onClick={() => onPeriodChange(p)}
          className={`px-2 py-0.5 text-sm rounded-md transition-all capitalize ${
            period === p
              ? activeTabClass
              : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
          }`}
        >
          {t(`statistics.${p}`)}
        </button>
      ))}
    </div>
  );
}

export function TopIntentions({
  topIntentions,
  period,
  onPeriodChange,
  isLoading,
  sessionType,
  isSubRanking,
  metricMode,
  showDuration = true,
}: {
  topIntentions: TopIntentionStat[];
  period: TopIntentionsPeriod;
  onPeriodChange: (period: TopIntentionsPeriod) => void;
  isLoading: boolean;
  sessionType: SessionType;
  isSubRanking?: boolean;
  metricMode: MetricMode;
  showDuration?: boolean;
}) {
  const { t } = useI18n();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const firstMobileColumnRef = useRef<HTMLDivElement>(null);
  const [mobilePageSize, setMobilePageSize] = useState(7);
  const mobileBottomPadding = 14;
  const maxValue =
    topIntentions.length > 0
      ? Math.max(
          ...topIntentions.map(item =>
            metricMode === 'count' ? item.count : item.duration
          )
        )
      : 0;
  const desktopRowCount = 4;
  const desktopVisibleColumns = 2;
  const desktopColumnWidth = 180;
  const desktopColumnCount = Math.max(
    desktopVisibleColumns,
    Math.ceil(topIntentions.length / desktopRowCount)
  );
  const hasDesktopHorizontalOverflow =
    isDesktop && desktopColumnCount > desktopVisibleColumns;
  const hasHorizontalPages = isDesktop
    ? hasDesktopHorizontalOverflow
    : topIntentions.length > mobilePageSize;
  const overflowClass = hasHorizontalPages
    ? isDesktop
      ? 'overflow-x-auto pb-2 -mb-2'
      : 'overflow-x-auto pb-3 -mb-3'
    : 'overflow-x-hidden';
  const mobileColumns = [] as TopIntentionStat[][];

  if (!isDesktop) {
    for (let index = 0; index < topIntentions.length; index += mobilePageSize) {
      mobileColumns.push(topIntentions.slice(index, index + mobilePageSize));
    }
  }

  useLayoutEffect(() => {
    if (isDesktop || topIntentions.length === 0) {
      return;
    }

    const scrollElement = scrollContainerRef.current;
    const columnElement = firstMobileColumnRef.current;
    if (!scrollElement || !columnElement) {
      return;
    }

    let animationFrame = 0;
    const measure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = window.requestAnimationFrame(() => {
          const rows = Array.from(
            columnElement.querySelectorAll<HTMLElement>(
              '[data-testid="top-intentions-row"]'
            )
          );
          const firstRow = rows[0];
          if (!firstRow) return;

          const rowHeight = firstRow.getBoundingClientRect().height;
          if (rowHeight <= 0) return;

          const secondRowTop = rows[1]?.getBoundingClientRect().top;
          const rowPitch = secondRowTop
            ? secondRowTop - firstRow.getBoundingClientRect().top
            : rowHeight;
          const top = scrollElement.getBoundingClientRect().top;
          const availableHeight = Math.max(
            rowHeight,
            window.innerHeight - top - mobileBottomPadding
          );
          const nextPageSize = Math.max(
            1,
            Math.min(
              topIntentions.length,
              Math.floor((availableHeight - rowHeight) / rowPitch) + 1
            )
          );

          setMobilePageSize(current =>
            current === nextPageSize ? current : nextPageSize
          );
        });
      });
    };

    measure();
    window.addEventListener('resize', measure);

    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    observer.observe(columnElement);
    if (scrollElement.parentElement) {
      observer.observe(scrollElement.parentElement);
    }
    observer.observe(document.body);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [mobileBottomPadding, topIntentions.length]);

  const barColorClass =
    sessionType === TIMER_TYPES.WORK
      ? 'bg-indigo-500'
      : sessionType === TIMER_TYPES.LONG_BREAK
        ? 'bg-purple-500'
        : 'bg-green-500';
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
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
  const getPercent = (item: TopIntentionStat) => {
    const value = metricMode === 'count' ? item.count : item.duration;
    return maxValue > 0 ? (value / maxValue) * 100 : 0;
  };
  const formatMetricPair = (item: TopIntentionStat) => {
    if (!showDuration) {
      return `${item.count}`;
    }

    const duration = formatTimeWithUnit(item.duration);
    return metricMode === 'count'
      ? `${item.count} · ${duration}`
      : `${duration} · ${item.count}`;
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          {isSubRanking ? t('statistics.subRanking') : t('statistics.ranking')}
        </h3>
        <PeriodTabs
          period={period}
          onPeriodChange={onPeriodChange}
          sessionType={sessionType}
        />
      </div>
      <div
        className={`transition-opacity ${isLoading && topIntentions.length > 0 ? 'opacity-50' : ''}`}
      >
        {isLoading && topIntentions.length === 0 ? (
          <div className="text-sm text-slate-500 py-2">
            {t('common.loading')}
          </div>
        ) : topIntentions.length === 0 ? (
          <div className="text-sm text-slate-500 py-2">
            {t('statistics.noIntentionsPeriod')}
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            className={`app-scrollbar overflow-y-hidden ${overflowClass}`}
            onWheel={handleWheel}
            style={{ WebkitOverflowScrolling: 'touch' }}
            data-testid="top-intentions-scroll"
          >
            {!isDesktop ? (
              <div className="flex w-max gap-4">
                {mobileColumns.map((columnItems, columnIndex) => (
                  <div
                    key={columnIndex}
                    ref={columnIndex === 0 ? firstMobileColumnRef : undefined}
                    className="w-[calc(100vw-4.25rem)] shrink-0 space-y-2.5 pb-1"
                    data-testid="top-intentions-column"
                  >
                    {columnItems.map(item => {
                      const itemIndex = topIntentions.findIndex(
                        intention => intention.slug === item.slug
                      );
                      const pct = getPercent(item);

                      return (
                        <div
                          key={item.slug}
                          className="flex items-center gap-3 text-sm"
                          data-testid="top-intentions-row"
                        >
                          <span
                            className={`w-4 text-right shrink-0 font-semibold ${itemIndex === 0 ? 'text-yellow-400' : itemIndex === 1 ? 'text-slate-300' : itemIndex === 2 ? 'text-amber-600' : 'text-slate-500'}`}
                          >
                            {itemIndex + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <span className="text-slate-200 truncate text-sm">
                                {item.label}
                              </span>
                              <span className="text-slate-400 whitespace-nowrap text-xs">
                                {formatMetricPair(item)}
                              </span>
                            </div>
                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${barColorClass} rounded-full transition-all`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="grid gap-x-4 gap-y-1.5 pb-1"
                style={{
                  gridTemplateColumns:
                    desktopColumnCount <= desktopVisibleColumns
                      ? `repeat(${desktopColumnCount}, minmax(0, 1fr))`
                      : `repeat(${desktopColumnCount}, minmax(${desktopColumnWidth}px, ${desktopColumnWidth}px))`,
                  width:
                    desktopColumnCount > desktopVisibleColumns
                      ? 'max-content'
                      : undefined,
                  gridTemplateRows: `repeat(${desktopRowCount}, auto)`,
                  gridAutoFlow: 'column',
                }}
              >
                {topIntentions.map((item, i) => {
                  const pct = getPercent(item);
                  return (
                    <div
                      key={item.slug}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span
                        className={`w-3 text-right shrink-0 font-semibold ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-500'}`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-slate-200 truncate text-sm">
                            {item.label}
                          </span>
                          <span className="text-slate-400 whitespace-nowrap ml-2 text-xs">
                            {formatMetricPair(item)}
                          </span>
                        </div>
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColorClass} rounded-full transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
