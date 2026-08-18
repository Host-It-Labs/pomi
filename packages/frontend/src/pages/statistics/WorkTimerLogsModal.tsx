import { Intention, Preferences, WorkTimerLog } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { FaTimes, FaTrash } from 'react-icons/fa';
import { IntentionAssignmentPicker } from '../../components/intentions/IntentionAssignmentPicker';
import { Spinner } from '../../components/ui/Spinner';
import { IntentionEmojiPair } from '../../components/ui/IntentionEmojiPair';
import { UnsavedChangesDialog } from '../../components/ui/UnsavedChangesDialog';
import { MILLISECONDS_PER_MINUTE } from '../../constants/time';
import { useTimerStore } from '../../stores/timerStore';
import { apiClient } from '../../utils/apiClient';
import { submitUserMutation } from '../../utils/userActionQueue';
import { useOpenModalRegistration } from '../../utils/modalRegistry';
import { useI18n } from '../../i18n';

interface WorkTimerLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogsMutated?: () => void;
  preferences?: Pick<
    Preferences,
    'intentionMultiSelect' | 'intentionSubIntentions'
  > | null;
}

type IntentionOption = Pick<
  Intention,
  | 'slug'
  | 'title'
  | 'emoji'
  | 'isArchived'
  | 'parentIntentionId'
  | 'parentIntention'
>;

type LogIntentionDisplay = {
  slug: string;
  title: string;
  emoji: string;
  displayTitle: string;
  subTitle?: string;
  subEmoji?: string;
};

const MAX_LOG_DURATION_MINUTES = 24 * 60;
const MAX_LOG_DURATION_MS = MAX_LOG_DURATION_MINUTES * MILLISECONDS_PER_MINUTE;

export function formatWorkTimerLogTimestamp(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function WorkTimerLogsModal({
  isOpen,
  onClose,
  onLogsMutated,
  preferences,
}: WorkTimerLogsModalProps) {
  const { locale, t } = useI18n();
  const clearTimerHistory = useTimerStore.use.clearTimerHistory();
  const [workTimerLogs, setWorkTimerLogs] = useState<WorkTimerLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selectedLog, setSelectedLog] = useState<WorkTimerLog | null>(null);
  const [availableIntentions, setAvailableIntentions] = useState<
    IntentionOption[]
  >([]);
  const [subIntentionsByParent, setSubIntentionsByParent] = useState<
    Record<string, IntentionOption[]>
  >({});
  const [isLoadingIntentions, setIsLoadingIntentions] = useState(false);
  const [editIntentions, setEditIntentions] = useState<string[]>([]);
  const [editSubIntentions, setEditSubIntentions] = useState<
    Record<string, string>
  >({});
  const [editDurationMinutes, setEditDurationMinutes] = useState('');
  const [isDurationEdited, setIsDurationEdited] = useState(false);
  const [isSavingLog, setIsSavingLog] = useState(false);
  const [isDeletingLog, setIsDeletingLog] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isIntentionDropdownOpen, setIsIntentionDropdownOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const LIMIT = 20;
  const isMultiSelectEnabled = preferences?.intentionMultiSelect === true;

  useOpenModalRegistration(isOpen, () => {
    if (isIntentionDropdownOpen) {
      setIsIntentionDropdownOpen(false);
    } else if (selectedLog) {
      requestCloseLogEditor();
    } else {
      onClose();
    }
  });

  useEffect(() => {
    if (isOpen) {
      setWorkTimerLogs([]);
      setOffset(0);
      setHasMore(true);
      closeLogEditor();
      fetchWorkTimerLogs(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopPropagation();

      if (isIntentionDropdownOpen) {
        setIsIntentionDropdownOpen(false);
        return;
      }

      if (selectedLog) {
        requestCloseLogEditor();
        return;
      }

      onClose();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isIntentionDropdownOpen, isOpen, onClose, selectedLog]);

  const fetchWorkTimerLogs = async (currentOffset: number) => {
    if (currentOffset === 0) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const response = await apiClient.workTimerLogs.list({
        query: {
          offset: currentOffset,
          limit: LIMIT,
        },
      });
      if (response.status === 200) {
        if (response.body.length < LIMIT) {
          setHasMore(false);
        }

        if (currentOffset === 0) {
          setWorkTimerLogs(response.body);
        } else {
          setWorkTimerLogs(prev => [...prev, ...response.body]);
        }

        setOffset(currentOffset + response.body.length);
      }
    } catch (error) {
      console.error('Failed to fetch work timer logs:', error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;

    if (scrollBottom < 100 && !isLoadingMore && hasMore) {
      fetchWorkTimerLogs(offset);
    }
  };

  const formatDuration = (milliseconds: number) => {
    if (milliseconds < MILLISECONDS_PER_MINUTE) {
      const seconds = Math.max(1, Math.round(milliseconds / 1000));
      return `${seconds}s`;
    }

    const minutes = Math.floor(milliseconds / MILLISECONDS_PER_MINUTE);
    return `${minutes}m`;
  };

  const getStartTime = (completedAt: number, duration: number) => {
    return completedAt - duration;
  };

  const formatDurationMinutesInput = (milliseconds: number) => {
    const minutes = Math.min(
      MAX_LOG_DURATION_MINUTES,
      milliseconds / MILLISECONDS_PER_MINUTE
    );
    return Number.isInteger(minutes)
      ? minutes.toString()
      : Number(minutes.toFixed(2)).toString();
  };

  const getLogIntentionSlugs = (log: WorkTimerLog) => {
    return Array.from(
      new Set(log.intentions.map(intention => intention.slug).filter(Boolean))
    );
  };

  const getLogSubIntentions = (log: WorkTimerLog) => {
    return {
      ...Object.fromEntries(
        log.intentions
          .filter(intention => intention.subIntention?.slug)
          .map(intention => [
            intention.slug,
            intention.subIntention?.slug as string,
          ])
      ),
      ...(log.subIntentions ?? {}),
    };
  };

  const getLogIntentionDisplays = (log: WorkTimerLog) => {
    return log.intentions.map(intention => {
      const subSlug = log.subIntentions?.[intention.slug];
      const subIntention = intention.subIntention;
      const subTitle = subIntention?.title ?? subSlug;
      const subEmoji = subIntention?.emoji ?? '';
      const title = intention.title ?? intention.slug;

      return {
        slug: intention.slug,
        title,
        emoji: intention.emoji ?? '',
        displayTitle: subTitle ?? title,
        subTitle,
        subEmoji,
      } satisfies LogIntentionDisplay;
    });
  };

  const getLogTitle = (log: WorkTimerLog) => {
    const hasIntentions = log.intentions.length > 0;
    const isLongBreak = log.type === TIMER_TYPES.LONG_BREAK;
    const isBreak = log.type === TIMER_TYPES.BREAK;

    const intentionDisplays = getLogIntentionDisplays(log);

    if (intentionDisplays.length > 1) {
      return intentionDisplays
        .map(intention => intention.displayTitle)
        .join(' · ');
    }

    if (isLongBreak && !hasIntentions) return t('common.longBreak');
    if (isBreak && !hasIntentions) return t('common.break');

    return intentionDisplays[0]?.displayTitle || t('intention.notSet');
  };

  function closeLogEditor() {
    setSelectedLog(null);
    setAvailableIntentions([]);
    setSubIntentionsByParent({});
    setEditIntentions([]);
    setEditSubIntentions({});
    setEditDurationMinutes('');
    setIsDurationEdited(false);
    setIsSavingLog(false);
    setIsDeletingLog(false);
    setIsConfirmingDelete(false);
    setIsIntentionDropdownOpen(false);
    setShowDiscardConfirm(false);
  }

  const getSelectedLogCurrentIntentions = (log: WorkTimerLog) => {
    return log.intentions.map(intention => ({
      slug: intention.slug,
      title: intention.title ?? intention.slug,
      emoji: intention.emoji ?? '',
      isArchived: true,
      parentIntentionId: null,
      parentIntention: null,
    }));
  };

  const getSelectedLogCurrentSubIntentions = (log: WorkTimerLog) => {
    return log.intentions.reduce(
      (accumulator, intention) => {
        const subIntention = intention.subIntention;
        if (!subIntention) return accumulator;

        accumulator[intention.slug] = [
          {
            slug: subIntention.slug,
            title: subIntention.title ?? subIntention.slug,
            emoji: subIntention.emoji ?? '',
            isArchived: true,
            parentIntentionId: null,
            parentIntention: {
              id: '',
              title: intention.title ?? intention.slug,
              emoji: intention.emoji ?? '',
              slug: intention.slug,
            },
          },
        ];

        return accumulator;
      },
      {} as Record<string, IntentionOption[]>
    );
  };

  const normalizeSubIntentionsForSelection = (
    intentionSlugs: string[],
    subIntentions: Record<string, string>
  ) => {
    const selectedSlugs = new Set(intentionSlugs);
    return Object.fromEntries(
      Object.entries(subIntentions).filter(
        ([parentSlug, subSlug]) =>
          selectedSlugs.has(parentSlug) && Boolean(subSlug)
      )
    );
  };

  const areStringArraysEqual = (first: string[], second: string[]) => {
    return (
      first.length === second.length &&
      first.every((value, index) => value === second[index])
    );
  };

  const areSubIntentionsEqual = (
    first: Record<string, string>,
    second: Record<string, string>
  ) => {
    const firstEntries = Object.entries(first);
    return (
      firstEntries.length === Object.keys(second).length &&
      firstEntries.every(
        ([parentSlug, subSlug]) => second[parentSlug] === subSlug
      )
    );
  };

  const loadIntentionsForLog = async (log: WorkTimerLog) => {
    const currentIntentions = getLogIntentionSlugs(log);
    const currentIntentionOptions = getSelectedLogCurrentIntentions(log);
    const currentSubIntentions = getLogSubIntentions(log);
    const currentSubIntentionOptions = getSelectedLogCurrentSubIntentions(log);
    setIsLoadingIntentions(true);

    try {
      const response = await apiClient.intentions.list({
        query: {
          type: log.type,
          includeSubIntentions: true,
        },
      });

      if (response.status !== 200) {
        setAvailableIntentions(currentIntentionOptions);
        setSubIntentionsByParent(currentSubIntentionOptions);
        setEditIntentions(currentIntentions);
        setEditSubIntentions(currentSubIntentions);
        return;
      }

      const intentions = response.body.filter(intention => {
        return !intention.isArchived;
      });
      const parentIntentions = intentions.filter(
        intention => !intention.parentIntentionId
      );
      const childIntentions = intentions.filter(
        intention => intention.parentIntentionId && intention.parentIntention
      );
      const options = [
        ...currentIntentionOptions.filter(
          current =>
            !parentIntentions.some(intention => intention.slug === current.slug)
        ),
        ...parentIntentions,
      ];
      const childrenByParent = childIntentions.reduce(
        (accumulator, intention) => {
          const parentSlug = intention.parentIntention?.slug;
          if (!parentSlug) return accumulator;

          accumulator[parentSlug] = [
            ...(accumulator[parentSlug] ?? []),
            intention,
          ];
          return accumulator;
        },
        {} as Record<string, IntentionOption[]>
      );

      for (const [parentSlug, currentChildren] of Object.entries(
        currentSubIntentionOptions
      )) {
        const activeChildren = childrenByParent[parentSlug] ?? [];
        const missingChildren = currentChildren.filter(
          current =>
            !activeChildren.some(intention => intention.slug === current.slug)
        );

        if (missingChildren.length > 0) {
          childrenByParent[parentSlug] = [
            ...missingChildren,
            ...activeChildren,
          ];
        }
      }

      setAvailableIntentions(options);
      setSubIntentionsByParent(childrenByParent);
      setEditIntentions(currentIntentions);
      setEditSubIntentions(currentSubIntentions);
    } catch (error) {
      console.error('Failed to fetch intentions for log:', error);
      setAvailableIntentions(currentIntentionOptions);
      setSubIntentionsByParent(currentSubIntentionOptions);
      setEditIntentions(currentIntentions);
      setEditSubIntentions(currentSubIntentions);
    } finally {
      setIsLoadingIntentions(false);
    }
  };

  const openLogEditor = (log: WorkTimerLog) => {
    const currentIntentions = getLogIntentionSlugs(log);
    setSelectedLog(log);
    setIsConfirmingDelete(false);
    setIsIntentionDropdownOpen(false);
    setIsDurationEdited(false);
    setEditIntentions(currentIntentions);
    setEditSubIntentions(getLogSubIntentions(log));
    setEditDurationMinutes(formatDurationMinutesInput(log.duration));
    loadIntentionsForLog(log);
  };

  const handleLogIntentionPickerChange = ({
    intentionSlugs,
    subIntentions,
  }: {
    intentionSlugs: string[];
    subIntentions: Record<string, string>;
  }) => {
    const nextIntentions = isMultiSelectEnabled
      ? intentionSlugs
      : intentionSlugs.slice(0, 1);
    setEditIntentions(nextIntentions);
    setEditSubIntentions(
      normalizeSubIntentionsForSelection(nextIntentions, subIntentions)
    );
  };

  const applyDurationMultiplier = (multiplier: number) => {
    if (!selectedLog) return;

    setIsDurationEdited(true);
    setEditDurationMinutes(
      formatDurationMinutesInput(selectedLog.duration * multiplier)
    );
  };

  const getEditedDuration = () => {
    if (!selectedLog) return null;
    if (!isDurationEdited) return selectedLog.duration;

    const minutes = Number(editDurationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return null;
    }

    return Math.min(
      Math.round(minutes * MILLISECONDS_PER_MINUTE),
      MAX_LOG_DURATION_MS
    );
  };

  const hasUnsavedEditorChanges = (() => {
    if (!selectedLog) {
      return false;
    }

    const currentIntentions = getLogIntentionSlugs(selectedLog);
    const currentSubIntentions = normalizeSubIntentionsForSelection(
      currentIntentions,
      getLogSubIntentions(selectedLog)
    );
    const nextSubIntentions = normalizeSubIntentionsForSelection(
      editIntentions,
      editSubIntentions
    );
    const editedDuration = getEditedDuration();

    return (
      (editedDuration !== null && editedDuration !== selectedLog.duration) ||
      !areStringArraysEqual(editIntentions, currentIntentions) ||
      !areSubIntentionsEqual(nextSubIntentions, currentSubIntentions)
    );
  })();

  const requestCloseLogEditor = () => {
    if (isSavingLog || isDeletingLog) {
      return;
    }
    if (hasUnsavedEditorChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    closeLogEditor();
  };

  const saveSelectedLog = async () => {
    if (!selectedLog) return;

    const duration = getEditedDuration();
    if (!duration) return;

    setIsSavingLog(true);
    try {
      const body: {
        duration: number;
        intention?: string | null;
        intentions?: string[];
        subIntentions?: Record<string, string>;
      } = {
        duration,
      };
      const currentIntentions = getLogIntentionSlugs(selectedLog);
      const currentSubIntentions = normalizeSubIntentionsForSelection(
        currentIntentions,
        getLogSubIntentions(selectedLog)
      );
      const nextSubIntentions = normalizeSubIntentionsForSelection(
        editIntentions,
        editSubIntentions
      );
      const hasIntentionChanges =
        !areStringArraysEqual(editIntentions, currentIntentions) ||
        !areSubIntentionsEqual(nextSubIntentions, currentSubIntentions);

      if (hasIntentionChanges) {
        if (
          !isMultiSelectEnabled &&
          areSubIntentionsEqual(nextSubIntentions, currentSubIntentions)
        ) {
          body.intention = editIntentions[0] ?? null;
        } else {
          body.intentions = editIntentions;
          body.subIntentions = nextSubIntentions;
        }
      }

      const result = await submitUserMutation({
        kind: 'workTimerLog',
        label: t('statistics.updateWorkLog'),
        payload: { operation: 'update', logId: selectedLog.id, payload: body },
        reconcile: async () => {
          await fetchWorkTimerLogs(0);
        },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: WorkTimerLog })
          : { status: 200, body: result as WorkTimerLog };

      if (response.status === 200) {
        setWorkTimerLogs(logs =>
          logs.map(log => (log.id === selectedLog.id ? response.body : log))
        );
        closeLogEditor();
        clearTimerHistory();
        void onLogsMutated?.();
      }
    } catch (error) {
      console.error('Failed to update work timer log:', error);
    } finally {
      setIsSavingLog(false);
    }
  };

  const deleteSelectedLog = async () => {
    if (!selectedLog) return;

    setIsDeletingLog(true);
    try {
      const result = await submitUserMutation({
        kind: 'workTimerLog',
        label: t('statistics.deleteWorkLog'),
        payload: { operation: 'delete', logId: selectedLog.id },
        successStatus: 204,
        reconcile: async () => {
          await fetchWorkTimerLogs(0);
        },
      });
      const response =
        result && typeof result === 'object' && 'status' in result
          ? (result as { status: number })
          : { status: 204 };

      if (response.status === 204) {
        setWorkTimerLogs(logs => logs.filter(log => log.id !== selectedLog.id));
        setOffset(currentOffset => Math.max(0, currentOffset - 1));
        closeLogEditor();
        clearTimerHistory();
        void onLogsMutated?.();
      }
    } catch (error) {
      console.error('Failed to delete work timer log:', error);
    } finally {
      setIsDeletingLog(false);
    }
  };

  const promptDeleteSelectedLog = () => {
    setIsConfirmingDelete(true);
  };

  const getBreakLogIcon = (log: WorkTimerLog) => {
    const hasIntentions = log.intentions.length > 0;
    const isLongBreak = log.type === TIMER_TYPES.LONG_BREAK;
    const isBreak = log.type === TIMER_TYPES.BREAK;

    if (isLongBreak && !hasIntentions) return '\u2615';
    if (isBreak && !hasIntentions) return '\uD83D\uDE0C';

    return '';
  };

  const renderLogIntentionIcons = (log: WorkTimerLog, size: 'xs' | 'sm') => {
    const intentionDisplays = getLogIntentionDisplays(log);
    if (intentionDisplays.length === 0) return null;

    return (
      <span className="flex shrink-0 items-center -space-x-0.5">
        {intentionDisplays.map(intention => (
          <IntentionEmojiPair
            key={intention.slug}
            parentEmoji={intention.emoji}
            subEmoji={intention.subEmoji}
            size={size}
            title={
              intention.subTitle
                ? `${intention.title}: ${intention.subTitle}`
                : intention.title
            }
          />
        ))}
      </span>
    );
  };

  const renderIntentionPicker = () => (
    <IntentionAssignmentPicker
      label={
        isMultiSelectEnabled ? t('intention.intentions') : t('task.intention')
      }
      options={availableIntentions.map(intention => ({
        value: intention.slug,
        title: intention.title,
        emoji: intention.emoji,
      }))}
      subIntentionsByParent={Object.fromEntries(
        Object.entries(subIntentionsByParent).map(([slug, children]) => [
          slug,
          children.map(child => ({
            slug: child.slug,
            title: child.title,
            emoji: child.emoji,
          })),
        ])
      )}
      selectedIntentions={editIntentions}
      selectedSubIntentions={editSubIntentions}
      mode={isMultiSelectEnabled ? 'multi' : 'single'}
      isOpen={isIntentionDropdownOpen}
      onOpenChange={setIsIntentionDropdownOpen}
      onChange={handleLogIntentionPickerChange}
      disabled={isLoadingIntentions || isSavingLog || isDeletingLog}
      listTestId="work-timer-log-intention-list"
      clearTestId="work-timer-log-intention-none"
      optionTestIdPrefix="work-timer-log-intention"
      triggerTestId="work-timer-log-intention-dropdown"
    />
  );

  const renderLogButton = (log: WorkTimerLog, layout: 'row' | 'grid') => {
    const isLongBreak = log.type === TIMER_TYPES.LONG_BREAK;
    const isBreak = log.type === TIMER_TYPES.BREAK;
    const breakIcon = getBreakLogIcon(log);
    const title = getLogTitle(log);
    const durationClass =
      isLongBreak || isBreak ? 'text-green-400' : 'text-indigo-400';

    if (layout === 'grid') {
      return (
        <button
          key={log.id}
          type="button"
          onClick={() => openLogEditor(log)}
          className="flex h-16 w-full flex-col justify-between rounded-md border border-slate-800 bg-slate-800/60 px-3 py-2 text-left transition-colors hover:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/70"
          data-testid="work-timer-log-row"
          aria-label={t('statistics.editLogDuration', {
            duration: formatDuration(log.duration),
          })}
        >
          <div className="flex items-center gap-1">
            {breakIcon ? <span className="text-sm">{breakIcon}</span> : null}
            {renderLogIntentionIcons(log, 'xs')}
            <div className="truncate text-xs text-slate-500">
              {formatWorkTimerLogTimestamp(
                getStartTime(log.completedAt, log.duration),
                locale
              )}
              {' \u2192 '}
              {formatWorkTimerLogTimestamp(log.completedAt, locale)}
            </div>
          </div>
          <div className={`text-base font-semibold ${durationClass}`}>
            {formatDuration(log.duration)}
          </div>
        </button>
      );
    }

    return (
      <button
        key={log.id}
        type="button"
        onClick={() => openLogEditor(log)}
        className="flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-800/60 px-3 py-2 text-left transition-colors hover:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500/70"
        data-testid="work-timer-log-row"
        aria-label={t('statistics.editLog', { title })}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {breakIcon ? (
            <span className="shrink-0 text-lg">{breakIcon}</span>
          ) : null}
          {renderLogIntentionIcons(log, 'sm')}
          <div className="min-w-0 flex-1">
            <div className="truncate whitespace-nowrap text-sm text-slate-200">
              {title}
            </div>
            <div className="text-xs text-slate-500">
              {formatWorkTimerLogTimestamp(
                getStartTime(log.completedAt, log.duration),
                locale
              )}
              {' \u2192 '}
              {formatWorkTimerLogTimestamp(log.completedAt, locale)}
            </div>
          </div>
        </div>
        <div className={`ml-2 shrink-0 text-sm font-semibold ${durationClass}`}>
          {formatDuration(log.duration)}
        </div>
      </button>
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="bg-slate-900 border border-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            {t('statistics.logs')}
          </h2>
          <button
            onClick={onClose}
            className="relative rounded-md p-1.5 transition-colors hover:bg-slate-800"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <FaTimes className="text-slate-400" size={14} />
          </button>
        </div>

        <div
          ref={scrollContainerRef}
          className="overflow-y-auto max-h-[calc(80vh-52px)] p-3"
          onScroll={handleScroll}
        >
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <Spinner size="md" className="text-indigo-500" />
            </div>
          ) : workTimerLogs.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              {t('statistics.noLogsYet')}
            </div>
          ) : (
            (() => {
              const hasAnyIntentions = workTimerLogs.some(
                log => log.intentions.length > 0
              );

              if (hasAnyIntentions) {
                return (
                  <div className="space-y-1.5">
                    {workTimerLogs.map(log => renderLogButton(log, 'row'))}
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-2 gap-1.5">
                  {workTimerLogs.map(log => renderLogButton(log, 'grid'))}
                </div>
              );
            })()
          )}

          {isLoadingMore && (
            <div className="flex justify-center items-center py-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500"></div>
            </div>
          )}

          {!hasMore && workTimerLogs.length > 0 && (
            <div className="text-center py-3 text-slate-600 text-xs">
              {t('statistics.noMoreLogs')}
            </div>
          )}
        </div>
      </motion.div>
      {selectedLog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2"
          onClick={event => {
            event.stopPropagation();
            requestCloseLogEditor();
          }}
        >
          <div
            className="w-full max-w-[424px] rounded-lg border border-slate-800 bg-slate-900 shadow-xl"
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('statistics.editLog')}
            data-testid="work-timer-log-editor"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                {t('statistics.editLogTitle')}
              </h3>
              <button
                type="button"
                onClick={requestCloseLogEditor}
                className="relative rounded-md p-1.5 transition-colors hover:bg-slate-800"
                aria-label={t('statistics.closeLogEditor')}
                title={t('statistics.closeLogEditor')}
              >
                <FaTimes className="text-slate-400" size={14} />
              </button>
            </div>

            <div className="space-y-3 p-3">
              <div className="flex items-center gap-2.5 rounded-md bg-slate-800/60 px-3 py-2">
                {getBreakLogIcon(selectedLog) ? (
                  <span className="shrink-0 text-lg">
                    {getBreakLogIcon(selectedLog)}
                  </span>
                ) : null}
                {renderLogIntentionIcons(selectedLog, 'sm')}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">
                    {getLogTitle(selectedLog)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatWorkTimerLogTimestamp(
                      getStartTime(
                        selectedLog.completedAt,
                        selectedLog.duration
                      ),
                      locale
                    )}
                    {' \u2192 '}
                    {formatWorkTimerLogTimestamp(
                      selectedLog.completedAt,
                      locale
                    )}
                  </div>
                </div>
              </div>

              {renderIntentionPicker()}

              <div className="space-y-1.5">
                <label
                  htmlFor="work-timer-log-duration"
                  className="text-xs font-medium uppercase tracking-wider text-slate-400"
                >
                  {t('statistics.length')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="work-timer-log-duration"
                    type="number"
                    min={0.01}
                    max={MAX_LOG_DURATION_MINUTES}
                    step={0.01}
                    value={editDurationMinutes}
                    onChange={event => {
                      setIsDurationEdited(true);
                      setEditDurationMinutes(event.target.value);
                    }}
                    disabled={isSavingLog || isDeletingLog}
                    className="w-20 rounded-md border border-slate-700/50 bg-slate-800 px-2 py-2 text-center text-sm text-slate-100 outline-none transition-colors focus:border-indigo-500/70 disabled:opacity-60"
                    data-testid="work-timer-log-duration"
                  />
                  <span className="text-xs text-slate-400">
                    {t('common.min')}
                  </span>
                  <button
                    type="button"
                    onClick={() => applyDurationMultiplier(2)}
                    disabled={isSavingLog || isDeletingLog}
                    className="ml-auto rounded-md border border-slate-700/50 bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-60"
                  >
                    2x
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDurationMultiplier(3)}
                    disabled={isSavingLog || isDeletingLog}
                    className="rounded-md border border-slate-700/50 bg-slate-800 px-2.5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-60"
                  >
                    3x
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900 px-4 py-3">
              {isConfirmingDelete ? (
                <>
                  <span
                    className="min-w-0 flex-1 text-sm text-red-100"
                    data-testid="work-timer-log-delete-confirm"
                  >
                    {t('statistics.deleteLogQuestion')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDelete(false)}
                    disabled={isDeletingLog}
                    className="rounded-md border border-slate-700/40 bg-slate-800/50 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700/50 disabled:opacity-60"
                  >
                    {t('common.keep')}
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedLog}
                    disabled={isDeletingLog}
                    className="rounded-md border border-red-500/30 bg-red-600/40 px-3 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-600/55 disabled:opacity-60"
                    data-testid="work-timer-log-confirm-delete"
                  >
                    {isDeletingLog ? t('common.deleting') : t('common.confirm')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={promptDeleteSelectedLog}
                    disabled={isSavingLog || isDeletingLog}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-500/25 bg-red-600/30 px-3 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-600/45 disabled:opacity-60"
                    data-testid="work-timer-log-delete"
                  >
                    <FaTrash size={12} />
                    <span>{t('common.delete')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={closeLogEditor}
                    disabled={isSavingLog || isDeletingLog}
                    className="ml-auto rounded-md border border-slate-700/40 bg-slate-800/50 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700/50 disabled:opacity-60"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={saveSelectedLog}
                    disabled={
                      isSavingLog ||
                      isDeletingLog ||
                      isLoadingIntentions ||
                      !getEditedDuration()
                    }
                    className="rounded-md border border-indigo-500/25 bg-indigo-600/40 px-3 py-2 text-sm font-medium text-indigo-100 transition-colors hover:bg-indigo-600/55 disabled:opacity-60"
                    data-testid="work-timer-log-save"
                  >
                    {isSavingLog ? t('common.saving') : t('common.save')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <UnsavedChangesDialog
        isOpen={showDiscardConfirm}
        title={t('statistics.discardLogChanges')}
        message={t('statistics.discardLogMessage')}
        stayLabel={t('common.stay')}
        discardLabel={t('common.discard')}
        onStay={() => setShowDiscardConfirm(false)}
        onDiscard={closeLogEditor}
      />
    </div>
  );
}
