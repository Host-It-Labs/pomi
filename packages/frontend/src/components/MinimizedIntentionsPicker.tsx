import { Intention, IntentionType, TimerTypes } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FaCheck, FaPlus } from 'react-icons/fa';
import {
  getTypedCountKey,
  useTodayIntentionsCount,
} from '../hooks/useTodayIntentionsCount';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../utils/apiClient';
import {
  getBreakIntentionQueryTypes,
  getMixedBreakButtonClasses,
  shouldMixBreakIntentionTypes,
  sortMixedBreakIntentionsByTypeAndCount,
} from '../utils/breakIntentionPreview';
import { orderIntentionsForHabits } from '../utils/habits';
import { hasOpenModal } from '../utils/modalRegistry';
import { isMac } from '../utils/osUtils';
import { getSelectedTimerIntentions } from '../utils/timerIntentions';
import {
  getCompactGridColumnClass,
  getCompactPickerMinWidth,
} from '../utils/minimizedIntentionsLayout';
import { IntentionEmojiPair } from './ui/IntentionEmojiPair';
import { KeyboardShortcut } from './ui/KeyboardShortcut';
import { PaginationControls } from './PaginationControls';
import { useI18n } from '../i18n';

const MINIMIZED_INTENTIONS_PAGE_SIZE = 4;
const COMPACT_TASKS_INTENTIONS_PAGE_SIZE = 3;

type PickerIntention = Intention & {
  sourceType: IntentionType;
};

type SubPickerState = {
  parent: PickerIntention;
  intentions: string[];
  subIntentions: Record<string, string>;
  timerType: TimerTypes;
  returnStartIndex: number;
};

type PickerSlot = PickerIntention | null | 'add';

type MinimizedIntentionsPickerProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  compactForTasks?: boolean;
};

const getParentKey = (type: IntentionType, slug: string) => `${type}:${slug}`;

const getGridColumnClass = (slotCount: number) => {
  if (slotCount <= 1) {
    return 'grid-cols-1';
  }
  if (slotCount === 2) {
    return 'grid-cols-2';
  }
  if (slotCount === 3) {
    return 'grid-cols-3';
  }
  if (slotCount === 4) {
    return 'grid-cols-4';
  }
  return 'grid-cols-5';
};

export function MinimizedIntentionsPicker({
  isOpen,
  onOpenChange,
  compactForTasks = false,
}: MinimizedIntentionsPickerProps) {
  const { t } = useI18n();
  const [intentions, setIntentions] = useState<PickerIntention[]>([]);
  const [subIntentionsByParent, setSubIntentionsByParent] = useState<
    Record<string, PickerIntention[]>
  >({});
  const [subPickerState, setSubPickerState] = useState<SubPickerState | null>(
    null
  );
  const [currentStartIndex, setCurrentStartIndex] = useState(0);
  const [isLoadingIntentions, setIsLoadingIntentions] = useState(false);
  const timer = useTimerStore.use.timer();
  const createOrResumeTimer = useTimerStore.use.createOrResumeTimer();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const advancedSkipModalOpen = useUiStore.use.advancedSkipModalOpen();
  const setActiveTab = useUiStore.use.setActiveTab();
  const setExpanded = useUiStore.use.setExpanded();
  const requestIntentionCreate = useUiStore.use.requestIntentionCreate();
  const preferences = usePreferencesStore.use.preferences();
  const latestRequestIdRef = useRef(0);
  const selectedIntentions = getSelectedTimerIntentions(timer);
  const selectedSubIntentions = useMemo(
    () => timer?.subIntentions ?? {},
    [timer?.subIntentions]
  );

  const isConnected =
    connectionStatus.isConnected && !connectionStatus.isReconnecting;

  const getIntentionType = (): IntentionType => {
    if (timer?.type === TIMER_TYPES.LONG_BREAK) {
      return TIMER_TYPES.LONG_BREAK;
    }
    if (
      timer?.type === TIMER_TYPES.BREAK &&
      preferences?.intentionBreakIntentions
    ) {
      return TIMER_TYPES.BREAK;
    }
    return TIMER_TYPES.WORK;
  };

  const intentionType = getIntentionType();
  const {
    countBySlug,
    subCountBySlug,
    countByTypedSlug,
    subCountByTypedSlug,
    isLoading: isCountLoading,
    refetch: refetchTodayCount,
  } = useTodayIntentionsCount(intentionType);
  const habitsEnabled = preferences?.intentionHabits === true;

  const showMixedBreakIntentions = shouldMixBreakIntentionTypes(
    timer?.type,
    preferences?.intentionShowBreakIntentionsInLongBreak
  );
  const minimizedIntentionsPageSize = compactForTasks
    ? COMPACT_TASKS_INTENTIONS_PAGE_SIZE
    : MINIMIZED_INTENTIONS_PAGE_SIZE;
  const subIntentionsPageSize = minimizedIntentionsPageSize;
  const isChoosingSubIntention = isOpen && subPickerState !== null;
  const subPickerIntentions = subPickerState
    ? (subIntentionsByParent[
        getParentKey(
          subPickerState.parent.sourceType,
          subPickerState.parent.slug
        )
      ] ?? [])
    : [];
  const getAggregateDisplayCount = (intention: PickerIntention) => {
    const childCount = (
      subIntentionsByParent[
        getParentKey(intention.sourceType, intention.slug)
      ] ?? []
    ).reduce(
      (total, subIntention) =>
        total +
        (subCountByTypedSlug[
          getTypedCountKey(subIntention.sourceType, subIntention.slug)
        ] ??
          subCountBySlug[subIntention.slug] ??
          0),
      0
    );

    return (
      (countByTypedSlug[
        getTypedCountKey(intention.sourceType, intention.slug)
      ] ??
        countBySlug[intention.slug] ??
        0) + childCount
    );
  };
  const getSubIntentionDisplayCount = (intention: PickerIntention) => {
    return (
      (subCountByTypedSlug[
        getTypedCountKey(intention.sourceType, intention.slug)
      ] ??
        subCountBySlug[intention.slug] ??
        0) +
      (countByTypedSlug[
        getTypedCountKey(intention.sourceType, intention.slug)
      ] ??
        countBySlug[intention.slug] ??
        0)
    );
  };
  const getHabitState = (intention: PickerIntention) => {
    if (!habitsEnabled) {
      return null;
    }

    const childHabits = (
      subIntentionsByParent[
        getParentKey(intention.sourceType, intention.slug)
      ] ?? []
    ).filter(subIntention => subIntention.isHabit);

    if (childHabits.length > 0) {
      return childHabits.every(
        subIntention => getSubIntentionDisplayCount(subIntention) > 0
      )
        ? 'done'
        : 'pending';
    }

    if (!intention.isHabit) {
      return null;
    }

    const doneCount = intention.parentIntentionId
      ? getSubIntentionDisplayCount(intention)
      : getAggregateDisplayCount(intention);
    return doneCount > 0 ? 'done' : 'pending';
  };

  const mixedDisplayIntentions = showMixedBreakIntentions
    ? sortMixedBreakIntentionsByTypeAndCount(
        intentions,
        intention => intention.usageCount ?? getAggregateDisplayCount(intention)
      )
    : intentions;
  const displayIntentions = habitsEnabled
    ? orderIntentionsForHabits(mixedDisplayIntentions, getHabitState)
    : mixedDisplayIntentions;
  const activeIntentions = subPickerState
    ? habitsEnabled
      ? orderIntentionsForHabits(subPickerIntentions, getHabitState)
      : subPickerIntentions
    : displayIntentions;
  const activePageSize = subPickerState
    ? subIntentionsPageSize
    : minimizedIntentionsPageSize;
  const getMaxStartIndex = (length: number, pageSize: number) =>
    Math.max(0, Math.ceil(length / pageSize) - 1) * pageSize;
  const shouldRenderPicker = isOpen || timer?.status !== TIMER_STATUSES.RUNNING;
  const addSlotIndex =
    shouldRenderPicker && !subPickerState && !isLoadingIntentions
      ? activeIntentions.length
      : -1;
  const activeSlotCount = activeIntentions.length + (addSlotIndex >= 0 ? 1 : 0);
  const maxStartIndex = getMaxStartIndex(activeSlotCount, activePageSize);
  const activePagedIntentions = activeIntentions.slice(
    currentStartIndex,
    currentStartIndex + activePageSize
  );
  const activePageEndIndex = currentStartIndex + activePageSize;
  const activePagedSlots: PickerSlot[] = [
    ...activePagedIntentions,
    ...(addSlotIndex >= currentStartIndex && addSlotIndex < activePageEndIndex
      ? (['add'] as const)
      : []),
  ];
  const pickerSlots: PickerSlot[] = isLoadingIntentions
    ? Array.from(
        { length: activePageSize },
        (_, index) => activePagedIntentions[index] ?? null
      )
    : activePagedSlots;
  const pickerGridColumnClass = getGridColumnClass(pickerSlots.length);
  const parentStartIndex = subPickerState
    ? subPickerState.returnStartIndex
    : currentStartIndex;
  const parentPickerSlots: PickerSlot[] = displayIntentions.slice(
    parentStartIndex,
    parentStartIndex + minimizedIntentionsPageSize
  );
  const visiblePickerSlots = isChoosingSubIntention
    ? parentPickerSlots
    : pickerSlots;
  const visiblePickerGridColumnClass = getGridColumnClass(
    visiblePickerSlots.length
  );
  const visibleCompactGridColumnClass = getCompactGridColumnClass(
    visiblePickerSlots.length
  );

  const openPicker = useCallback(() => {
    setSubPickerState(null);
    setCurrentStartIndex(startIndex => Math.min(startIndex, maxStartIndex));
    onOpenChange(true);
  }, [maxStartIndex, onOpenChange]);

  const closePicker = useCallback(() => {
    setSubPickerState(null);
    setCurrentStartIndex(0);
    onOpenChange(false);
  }, [onOpenChange]);

  const returnToParentPicker = useCallback(() => {
    const returnStartIndex = subPickerState?.returnStartIndex ?? 0;
    setSubPickerState(null);
    setCurrentStartIndex(returnStartIndex);
  }, [subPickerState?.returnStartIndex]);

  const nextPage = useCallback(() => {
    setCurrentStartIndex(startIndex => {
      const alignedStartIndex =
        Math.floor(startIndex / activePageSize) * activePageSize;
      return Math.min(alignedStartIndex + activePageSize, maxStartIndex);
    });
  }, [activePageSize, maxStartIndex]);

  const prevPage = useCallback(() => {
    setCurrentStartIndex(startIndex => {
      const alignedStartIndex =
        Math.floor(startIndex / activePageSize) * activePageSize;
      return Math.max(alignedStartIndex - activePageSize, 0);
    });
  }, [activePageSize]);

  useEffect(() => {
    setCurrentStartIndex(startIndex => {
      const alignedStartIndex =
        Math.floor(startIndex / activePageSize) * activePageSize;
      return Math.min(alignedStartIndex, maxStartIndex);
    });
  }, [activePageSize, maxStartIndex]);

  useEffect(() => {
    const isMatchingCompletedType =
      (intentionType === TIMER_TYPES.WORK &&
        timer?.type === TIMER_TYPES.WORK) ||
      (intentionType === TIMER_TYPES.BREAK &&
        timer?.type === TIMER_TYPES.BREAK) ||
      (intentionType === TIMER_TYPES.LONG_BREAK &&
        timer?.type === TIMER_TYPES.LONG_BREAK);

    if (timer?.status === TIMER_STATUSES.COMPLETED && isMatchingCompletedType) {
      refetchTodayCount();
    }
  }, [intentionType, timer?.type, timer?.status, refetchTodayCount]);

  const loadIntentions = useCallback(
    async (type: IntentionType) => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      setIsLoadingIntentions(true);
      setIntentions([]);
      setSubIntentionsByParent({});

      try {
        const requests = getBreakIntentionQueryTypes(
          type,
          preferences?.intentionShowBreakIntentionsInLongBreak
        );
        const responses = await Promise.all(
          requests.map(requestType =>
            apiClient.intentions.list({
              query: {
                type: requestType,
                includeSubIntentions: true,
              },
            })
          )
        );

        if (latestRequestIdRef.current !== requestId) return;

        const nextIntentions = responses.flatMap((response, index) => {
          if (response.status !== 200) {
            return [];
          }

          return response.body
            .filter(intention => !intention.isArchived)
            .map(intention => ({
              ...intention,
              sourceType: requests[index],
            }));
        });

        const parents = nextIntentions.filter(
          intention => !intention.parentIntentionId
        );
        const childrenByParent = nextIntentions.reduce(
          (accumulator, intention) => {
            if (!intention.parentIntentionId || !intention.parentIntention) {
              return accumulator;
            }

            const key = getParentKey(
              intention.sourceType,
              intention.parentIntention.slug
            );
            accumulator[key] = [...(accumulator[key] ?? []), intention];
            return accumulator;
          },
          {} as Record<string, PickerIntention[]>
        );

        setIntentions(parents);
        setSubIntentionsByParent(childrenByParent);
      } catch (error) {
        console.error('Failed to load intentions:', error);
      } finally {
        if (latestRequestIdRef.current === requestId) {
          setIsLoadingIntentions(false);
        }
      }
    },
    [preferences?.intentionShowBreakIntentionsInLongBreak]
  );

  useEffect(() => {
    loadIntentions(intentionType);
  }, [intentionType, loadIntentions]);

  useEffect(() => {
    if (!isOpen) {
      setSubPickerState(null);
      setCurrentStartIndex(0);
      return;
    }

    setCurrentStartIndex(startIndex => Math.min(startIndex, maxStartIndex));
  }, [isOpen, maxStartIndex]);

  useEffect(() => {
    if (!isOpen && timer?.status === TIMER_STATUSES.RUNNING) {
      setCurrentStartIndex(0);
    }
  }, [isOpen, timer?.status]);

  const buildNextIntentions = useCallback(
    (slug: string, currentIntentions: string[], canClearLast: boolean) => {
      if (preferences?.intentionMultiSelect) {
        if (currentIntentions.includes(slug)) {
          if (!canClearLast && currentIntentions.length === 1) {
            return currentIntentions;
          }

          return currentIntentions.filter(value => value !== slug);
        }

        return [...currentIntentions, slug];
      }

      if (currentIntentions.length === 1 && currentIntentions[0] === slug) {
        return canClearLast ? [] : currentIntentions;
      }

      return [slug];
    },
    [preferences?.intentionMultiSelect]
  );

  const completeSelection = useCallback(
    (returnStartIndex?: number) => {
      if (preferences?.intentionMultiSelect) {
        onOpenChange(true);
        setSubPickerState(null);
        if (returnStartIndex !== undefined) {
          setCurrentStartIndex(returnStartIndex);
        }
        return;
      }

      closePicker();
    },
    [closePicker, onOpenChange, preferences?.intentionMultiSelect]
  );

  const handleIntentionClick = useCallback(
    (intention: PickerIntention) => {
      if (!isConnected) {
        return;
      }

      const slug = intention.slug;
      let nextTimerType: TimerTypes;
      let nextIntentions: string[];

      if (
        intentionType === TIMER_TYPES.BREAK ||
        intentionType === TIMER_TYPES.LONG_BREAK
      ) {
        nextTimerType = intentionType;
        nextIntentions = buildNextIntentions(slug, selectedIntentions, true);
      } else if (
        timer?.type === TIMER_TYPES.BREAK ||
        timer?.type === TIMER_TYPES.LONG_BREAK
      ) {
        nextTimerType = TIMER_TYPES.WORK;
        nextIntentions = [slug];
      } else {
        const canClearWorkIntention =
          !preferences?.intentionRequireSelection ||
          selectedIntentions.length > 1;
        nextTimerType = TIMER_TYPES.WORK;
        nextIntentions = buildNextIntentions(
          slug,
          selectedIntentions,
          canClearWorkIntention
        );
      }

      const nextSubIntentions = Object.fromEntries(
        Object.entries(selectedSubIntentions).filter(([parentSlug]) =>
          nextIntentions.includes(parentSlug)
        )
      );
      const resetOnFirstIntention =
        nextTimerType === TIMER_TYPES.WORK
          ? preferences?.resetWorkOnFirstIntention === true
          : nextTimerType === TIMER_TYPES.BREAK
            ? preferences?.resetBreakOnFirstIntention === true
            : preferences?.resetLongBreakOnFirstIntention === true;

      const parentKey = getParentKey(intention.sourceType, slug);
      const subIntentions = subIntentionsByParent[parentKey] ?? [];
      if (nextIntentions.includes(slug) && subIntentions.length > 0) {
        setSubPickerState({
          parent: intention,
          intentions: nextIntentions,
          subIntentions: nextSubIntentions,
          timerType: nextTimerType,
          returnStartIndex: currentStartIndex,
        });
        setCurrentStartIndex(0);
        onOpenChange(true);
        return;
      }

      createOrResumeTimer(
        nextTimerType,
        nextIntentions[0],
        nextIntentions,
        nextSubIntentions,
        undefined,
        resetOnFirstIntention
      );

      if (isOpen) {
        completeSelection();
      }
    },
    [
      buildNextIntentions,
      completeSelection,
      currentStartIndex,
      createOrResumeTimer,
      intentionType,
      isConnected,
      isOpen,
      onOpenChange,
      preferences?.intentionRequireSelection,
      preferences?.resetWorkOnFirstIntention,
      preferences?.resetBreakOnFirstIntention,
      preferences?.resetLongBreakOnFirstIntention,
      selectedIntentions,
      selectedSubIntentions,
      subIntentionsByParent,
      timer?.type,
    ]
  );

  const handleSubIntentionSelect = useCallback(
    (subSlug: string) => {
      if (!subPickerState || !isConnected) return;

      const nextSubIntentions = {
        ...subPickerState.subIntentions,
        [subPickerState.parent.slug]: subSlug,
      };
      const resetOnFirstIntention =
        subPickerState.timerType === TIMER_TYPES.WORK
          ? preferences?.resetWorkOnFirstIntention === true
          : subPickerState.timerType === TIMER_TYPES.BREAK
            ? preferences?.resetBreakOnFirstIntention === true
            : preferences?.resetLongBreakOnFirstIntention === true;
      createOrResumeTimer(
        subPickerState.timerType,
        subPickerState.intentions[0],
        subPickerState.intentions,
        nextSubIntentions,
        undefined,
        resetOnFirstIntention
      );
      completeSelection(subPickerState.returnStartIndex);
    },
    [
      completeSelection,
      createOrResumeTimer,
      isConnected,
      preferences?.resetWorkOnFirstIntention,
      preferences?.resetBreakOnFirstIntention,
      preferences?.resetLongBreakOnFirstIntention,
      subPickerState,
    ]
  );

  const getSelectedSubIntention = (intention: PickerIntention) => {
    const selectedSubSlug = selectedSubIntentions[intention.slug];
    if (!selectedSubSlug) {
      return undefined;
    }

    return subIntentionsByParent[
      getParentKey(intention.sourceType, intention.slug)
    ]?.find(subIntention => subIntention.slug === selectedSubSlug);
  };

  const getVisibleDisplayCount = (
    intention: PickerIntention,
    selectedSubIntention?: PickerIntention
  ) => {
    if (selectedSubIntention) {
      return getSubIntentionDisplayCount(selectedSubIntention);
    }

    return getAggregateDisplayCount(intention);
  };
  const showDailyCounts = preferences?.intentionShowDailyCount === true;

  const addIntention = useCallback(() => {
    requestIntentionCreate();
    setExpanded(true);
    setActiveTab('intentions');
  }, [requestIntentionCreate, setActiveTab, setExpanded]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (advancedSkipModalOpen || hasOpenModal()) {
        return;
      }

      const shortcutsEnabled = preferences?.keyboardShortcuts === true;
      const isModPressed = e.metaKey || e.ctrlKey;
      const hasModifier = isModPressed || e.altKey || e.shiftKey;
      const hasOnlyOptionalMod = !e.altKey && !e.shiftKey;

      if (isOpen && !hasModifier && e.key === 'Escape') {
        e.preventDefault();
        if (subPickerState) {
          returnToParentPicker();
        } else {
          closePicker();
        }
        return;
      }

      if (!shortcutsEnabled) {
        return;
      }

      if (subPickerState) {
        if (hasOnlyOptionalMod) {
          if (e.key === 'Escape' && !isModPressed) {
            e.preventDefault();
            returnToParentPicker();
            return;
          }

          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prevPage();
            return;
          }

          if (e.key === 'ArrowRight') {
            e.preventDefault();
            nextPage();
            return;
          }

          if (e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            const subIntention = activePagedIntentions[parseInt(e.key, 10) - 1];
            if (subIntention) {
              handleSubIntentionSelect(subIntention.slug);
            }
            return;
          }
        }

        if (
          isModPressed &&
          !e.shiftKey &&
          ((e.key >= '1' && e.key <= '9') ||
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight')
        ) {
          e.preventDefault();
        }
        return;
      }

      if (shouldRenderPicker && !subPickerState) {
        if (!hasOnlyOptionalMod) return;

        if (isModPressed && e.key === '0') {
          e.preventDefault();
          addIntention();
          return;
        }

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          prevPage();
          return;
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          nextPage();
          return;
        }

        if (!isModPressed) return;

        if (e.key >= '1' && e.key <= '4') {
          e.preventDefault();
          const intention = activePagedIntentions[parseInt(e.key, 10) - 1];
          if (intention) {
            handleIntentionClick(intention);
          }
        }
        return;
      }

      if (e.key >= '1' && e.key <= '4') {
        if (!isModPressed || e.shiftKey) return;

        e.preventDefault();
        const intention = activePagedIntentions[parseInt(e.key, 10) - 1];
        if (intention) {
          handleIntentionClick(intention);
        }
        return;
      }

      if (hasOnlyOptionalMod && e.key === 'ArrowLeft') {
        e.preventDefault();
        prevPage();
        return;
      }

      if (hasOnlyOptionalMod && e.key === 'ArrowRight') {
        e.preventDefault();
        if (timer?.status === TIMER_STATUSES.RUNNING && !isOpen) {
          openPicker();
        } else {
          nextPage();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    activePagedIntentions,
    addIntention,
    advancedSkipModalOpen,
    closePicker,
    handleIntentionClick,
    handleSubIntentionSelect,
    isOpen,
    nextPage,
    openPicker,
    prevPage,
    preferences?.keyboardShortcuts,
    returnToParentPicker,
    shouldRenderPicker,
    subPickerState,
    timer?.status,
  ]);

  const getSelectedCount = (
    list: PickerIntention[],
    selectedSlugs: string[],
    startIndex: number,
    endIndex: number
  ) => {
    if (startIndex >= endIndex) {
      return 0;
    }

    const selectedSet = new Set(selectedSlugs);
    return list
      .slice(startIndex, endIndex)
      .filter(intention => selectedSet.has(intention.slug)).length;
  };

  const getPageSelectionCounts = () => {
    const visibleEndIndex = currentStartIndex + activePageSize;

    if (!subPickerState) {
      return {
        previous: getSelectedCount(
          displayIntentions,
          selectedIntentions,
          0,
          currentStartIndex
        ),
        next: getSelectedCount(
          displayIntentions,
          selectedIntentions,
          visibleEndIndex,
          displayIntentions.length
        ),
      };
    }

    const selectedSubSlug = selectedSubIntentions[subPickerState.parent.slug];
    const selectedSubSlugs = selectedSubSlug ? [selectedSubSlug] : [];

    return {
      previous: getSelectedCount(
        subPickerIntentions,
        selectedSubSlugs,
        0,
        currentStartIndex
      ),
      next: getSelectedCount(
        subPickerIntentions,
        selectedSubSlugs,
        visibleEndIndex,
        subPickerIntentions.length
      ),
    };
  };

  const pageSelectionCounts = getPageSelectionCounts();
  const showPreviousPageButton = currentStartIndex > 0;
  const showNextPageButton = currentStartIndex < maxStartIndex;
  const showPickerControls = showPreviousPageButton || showNextPageButton;
  const currentPageIndex = Math.floor(currentStartIndex / activePageSize);
  const pageCount = Math.floor(maxStartIndex / activePageSize) + 1;
  const compactPickerMinWidth = compactForTasks
    ? getCompactPickerMinWidth(
        visiblePickerSlots.length,
        showPickerControls && !isChoosingSubIntention
      )
    : undefined;

  const renderPageSelectionBadge = (count: number) => {
    if (count <= 0) {
      return null;
    }

    return (
      <span className="absolute bottom-0 right-0 flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-blue-500 px-0.5 text-[7px] font-bold leading-none text-white">
        {count}
      </span>
    );
  };

  const handleButtonKeyDown = (e: KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  const renderIntentionButton = (
    intention: PickerIntention,
    index: number,
    size: 'compact' | 'tiny'
  ) => {
    const selectedSubIntention = getSelectedSubIntention(intention);
    const isSelected = selectedIntentions.includes(intention.slug);
    const previewClasses = getMixedBreakButtonClasses(
      intention.sourceType,
      isSelected,
      showMixedBreakIntentions
    );
    const title = selectedSubIntention?.title ?? intention.title;
    const count = getVisibleDisplayCount(intention, selectedSubIntention);
    const habitState = getHabitState(intention);
    const habitDone = habitState === 'done';
    const isPendingHabit = habitState === 'pending';
    const shortcutPrefix = isMac ? '⌘' : 'Ctrl+';

    return (
      <button
        key={intention.slug}
        type="button"
        onClick={() => handleIntentionClick(intention)}
        onKeyDown={e =>
          handleButtonKeyDown(e, () => handleIntentionClick(intention))
        }
        className={clsx(
          'flex items-center justify-center rounded-md transition-all relative select-none',
          compactForTasks
            ? 'h-7 w-7 text-[11px]'
            : size === 'compact'
              ? 'h-8 w-8'
              : 'h-8 w-8 text-xs',
          previewClasses.buttonClass,
          compactForTasks && 'border-slate-700/60 bg-slate-950/40',
          isSelected && 'scale-105'
        )}
        title={`${title} (${shortcutPrefix}${index + 1})`}
      >
        {isPendingHabit && (
          <span
            className="absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
            aria-label={t('intention.habitPendingToday')}
          />
        )}
        {habitDone && (
          <span
            className="absolute left-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-white"
            aria-label={t('intention.habitDoneToday')}
          >
            <FaCheck size={7} />
          </span>
        )}
        {selectedSubIntention ? (
          <IntentionEmojiPair
            parentEmoji={intention.emoji}
            subEmoji={selectedSubIntention.emoji}
            size="xs"
          />
        ) : (
          <span className="leading-none">{intention.emoji}</span>
        )}
        {showMixedBreakIntentions && (
          <span
            className={`absolute bottom-0 left-0 right-0 h-0.5 ${previewClasses.markerClass}`}
          />
        )}
        <KeyboardShortcut text={`${index + 1}`} position="topRight" />
        {!isCountLoading && showDailyCounts && count > 0 && (
          <motion.span
            data-testid="intention-count-badge"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className={clsx(
              'absolute text-[9px] font-bold bg-indigo-600 text-white rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5',
              selectedSubIntention
                ? 'top-[1.35rem] -right-1'
                : '-bottom-1 -right-1'
            )}
          >
            {count}
          </motion.span>
        )}
      </button>
    );
  };

  const renderSubIntentionButton = (
    subIntention: PickerIntention,
    index: number
  ) => {
    if (!subPickerState) return null;

    const isSelected =
      selectedSubIntentions[subPickerState.parent.slug] === subIntention.slug;
    const count = getSubIntentionDisplayCount(subIntention);
    const habitState = getHabitState(subIntention);
    const habitDone = habitState === 'done';
    const isPendingHabit = habitState === 'pending';

    return (
      <button
        key={subIntention.slug}
        type="button"
        onClick={() => handleSubIntentionSelect(subIntention.slug)}
        onKeyDown={e =>
          handleButtonKeyDown(e, () =>
            handleSubIntentionSelect(subIntention.slug)
          )
        }
        className={clsx(
          'relative flex items-center justify-center rounded-md border transition-all select-none',
          compactForTasks ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-xs',
          isSelected
            ? 'border-cyan-300/70 bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-300/70'
            : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-500/20',
          compactForTasks && 'border-slate-700/60 bg-slate-950/40'
        )}
        title={`${subIntention.title} (${index + 1})`}
      >
        {isPendingHabit && (
          <span
            className="absolute left-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
            aria-label={t('intention.habitPendingToday')}
          />
        )}
        {habitDone && (
          <span
            className="absolute left-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-white"
            aria-label={t('intention.habitDoneToday')}
          >
            <FaCheck size={7} />
          </span>
        )}
        <span className="leading-none">{subIntention.emoji}</span>
        <KeyboardShortcut
          text={`${index + 1}`}
          position="topRight"
          alwaysShow
          showModIcon={false}
        />
        {!isCountLoading && showDailyCounts && count > 0 && (
          <motion.span
            data-testid="intention-count-badge"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute top-[1.35rem] -right-1 text-[9px] font-bold bg-cyan-600 text-white rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5"
          >
            {count}
          </motion.span>
        )}
      </button>
    );
  };

  const renderAddIntentionButton = () => (
    <button
      key="add-minimized-intention"
      type="button"
      onClick={addIntention}
      onKeyDown={e => handleButtonKeyDown(e, addIntention)}
      className={clsx(
        'relative flex items-center justify-center rounded-md border border-indigo-400/55 bg-indigo-500/20 text-indigo-100 transition-all hover:border-indigo-300/70 hover:bg-indigo-500/30 select-none',
        compactForTasks ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-xs'
      )}
      title={`${t('intention.addNew')} (${isMac ? '⌘' : 'Ctrl+'}0)`}
      aria-label={t('intention.addNew')}
    >
      <FaPlus size={compactForTasks ? 9 : 10} />
      {preferences?.keyboardShortcuts && (
        <KeyboardShortcut text="0" position="topRight" />
      )}
    </button>
  );

  const renderPickerSlot = (
    intention: PickerSlot,
    index: number,
    mode: 'intention' | 'sub' = isChoosingSubIntention ? 'sub' : 'intention'
  ) => {
    if (intention === 'add') {
      return mode === 'intention' ? renderAddIntentionButton() : null;
    }

    if (!intention) {
      if (!isLoadingIntentions) {
        return null;
      }

      return (
        <div
          key={`empty-minimized-intention-${index}`}
          data-testid={
            isLoadingIntentions ? 'intention-loading-placeholder' : undefined
          }
          className={clsx(
            compactForTasks ? 'h-7 w-7 rounded-md' : 'h-8 w-8 rounded-md',
            isLoadingIntentions && 'animate-pulse',
            isLoadingIntentions &&
              (isChoosingSubIntention ? 'bg-cyan-500/5' : 'bg-slate-800/30')
          )}
        />
      );
    }

    return mode === 'sub'
      ? renderSubIntentionButton(intention, index)
      : renderIntentionButton(intention, index, 'tiny');
  };

  return (
    <AnimatePresence mode="wait">
      {shouldRenderPicker && (
        <motion.div
          key="minimized-intentions"
          data-testid={isOpen ? 'minimized-intentions-picker' : undefined}
          className={clsx(
            'pointer-events-auto relative z-20 flex items-center',
            compactForTasks
              ? 'h-8 min-h-8 max-h-8 shrink-0 overflow-visible'
              : 'mt-5',
            !isConnected && 'opacity-50'
          )}
          style={
            compactPickerMinWidth !== undefined
              ? { minWidth: compactPickerMinWidth }
              : undefined
          }
          initial={{ opacity: 0, scale: compactForTasks ? 1 : 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: compactForTasks ? 1 : 0.96 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div
            className={clsx(
              'flex items-center',
              compactForTasks
                ? 'h-8 min-h-8 max-h-8 shrink-0 gap-1 overflow-visible'
                : 'flex-col gap-0.5'
            )}
          >
            {compactForTasks &&
            showPickerControls &&
            !isChoosingSubIntention ? (
              <PaginationControls
                pageIndex={currentPageIndex}
                pageCount={pageCount}
                onPrevious={prevPage}
                onNext={nextPage}
                previousLabel={t('navigation.previousIntentionsPage')}
                nextLabel={t('navigation.nextIntentionsPage')}
                showShortcuts={false}
                className="contents"
                buttonSizeClassName="h-5 w-5"
                buttonClassName="rounded-sm bg-transparent hover:bg-transparent"
                countClassName="hidden"
                iconSize={10}
                previousBadge={renderPageSelectionBadge(
                  pageSelectionCounts.previous
                )}
                nextBadge={renderPageSelectionBadge(pageSelectionCounts.next)}
              >
                <div
                  data-testid="minimized-intentions-grid"
                  className={clsx(
                    'grid h-8 min-h-8 max-h-8 shrink-0 items-center gap-2 overflow-visible',
                    visibleCompactGridColumnClass
                  )}
                >
                  {visiblePickerSlots.map((slot, index) =>
                    renderPickerSlot(slot, index, 'intention')
                  )}
                </div>
              </PaginationControls>
            ) : (
              <div
                data-testid="minimized-intentions-grid"
                className={clsx(
                  compactForTasks
                    ? 'grid h-8 min-h-8 max-h-8 shrink-0 items-center gap-2 overflow-visible'
                    : 'grid gap-2',
                  compactForTasks
                    ? visibleCompactGridColumnClass
                    : visiblePickerGridColumnClass
                )}
              >
                {visiblePickerSlots.map((slot, index) =>
                  renderPickerSlot(
                    slot,
                    index,
                    isChoosingSubIntention ? 'intention' : undefined
                  )
                )}
              </div>
            )}

            {isChoosingSubIntention && (
              <div
                data-testid="minimized-sub-intentions-picker"
                className={clsx(
                  'absolute left-1/2 z-30 flex -translate-x-1/2 items-center rounded-md bg-slate-950/95 shadow-lg ring-1 ring-cyan-400/25',
                  compactForTasks
                    ? 'top-[calc(100%+0.25rem)] h-8 min-h-8 max-h-8 min-w-[8rem] justify-center px-1 py-0.5'
                    : 'top-[calc(100%+0.375rem)] h-9 min-h-9 max-h-9 p-0.5'
                )}
              >
                {showPickerControls ? (
                  <PaginationControls
                    pageIndex={currentPageIndex}
                    pageCount={pageCount}
                    onPrevious={prevPage}
                    onNext={nextPage}
                    previousLabel={t('navigation.previousSubIntentionsPage')}
                    nextLabel={t('navigation.nextSubIntentionsPage')}
                    showShortcuts={false}
                    className={compactForTasks ? 'gap-2' : 'gap-1'}
                    buttonSizeClassName="h-5 w-5"
                    buttonClassName="rounded-sm bg-transparent hover:bg-transparent"
                    countClassName="hidden"
                    iconSize={compactForTasks ? 10 : 12}
                  >
                    <div
                      className={clsx(
                        compactForTasks
                          ? 'grid h-7 min-h-7 max-h-7 w-[7.5rem] shrink-0 items-center justify-items-center gap-0 overflow-visible'
                          : 'grid h-8 min-h-8 max-h-8 items-center gap-2 overflow-visible',
                        pickerGridColumnClass
                      )}
                    >
                      {pickerSlots.map((slot, index) =>
                        renderPickerSlot(slot, index, 'sub')
                      )}
                    </div>
                  </PaginationControls>
                ) : (
                  <div
                    className={clsx(
                      compactForTasks
                        ? 'grid h-7 min-h-7 max-h-7 w-[7.5rem] shrink-0 items-center justify-items-center gap-0 overflow-visible'
                        : 'grid h-8 min-h-8 max-h-8 items-center gap-2 overflow-visible',
                      pickerGridColumnClass
                    )}
                  >
                    {pickerSlots.map((slot, index) =>
                      renderPickerSlot(slot, index, 'sub')
                    )}
                  </div>
                )}
              </div>
            )}

            {!compactForTasks &&
              showPickerControls &&
              !isChoosingSubIntention && (
                <div className="relative mt-0.5 flex h-5 w-full items-center justify-center px-1">
                  <PaginationControls
                    pageIndex={currentPageIndex}
                    pageCount={pageCount}
                    onPrevious={prevPage}
                    onNext={nextPage}
                    previousLabel={t('navigation.previousIntentionsPage')}
                    nextLabel={t('navigation.nextIntentionsPage')}
                    showShortcuts={false}
                    className="absolute inset-x-1 justify-between gap-0"
                    buttonSizeClassName="h-4 w-5"
                    buttonClassName="rounded-sm bg-transparent hover:bg-transparent"
                    countClassName="hidden"
                    iconSize={8}
                    previousBadge={renderPageSelectionBadge(
                      pageSelectionCounts.previous
                    )}
                    nextBadge={renderPageSelectionBadge(
                      pageSelectionCounts.next
                    )}
                  />
                </div>
              )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
