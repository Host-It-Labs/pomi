import { Intention, IntentionType } from '@pomi/shared';
import { TIMER_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import { motion } from 'framer-motion';
import {
  type TouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  FaChevronLeft,
  FaChevronRight,
  FaCheck,
  FaListUl,
  FaPlus,
} from 'react-icons/fa';
import { PaginationControls } from '../../components/PaginationControls';
import { Button } from '../../components/ui/Button';
import { IntentionEmojiPair } from '../../components/ui/IntentionEmojiPair';
import { KeyboardShortcut } from '../../components/ui/KeyboardShortcut';
import {
  getTypedCountKey,
  useTodayIntentionsCount,
} from '../../hooks/useTodayIntentionsCount';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useTimerStore } from '../../stores/timerStore';
import { useUiStore } from '../../stores/uiStore';
import { apiClient } from '../../utils/apiClient';
import {
  getBreakIntentionQueryTypes,
  getMixedBreakButtonClasses,
  shouldMixBreakIntentionTypes,
  sortMixedBreakIntentionsByTypeAndCount,
} from '../../utils/breakIntentionPreview';
import { orderIntentionsForHabits } from '../../utils/habits';
import { hasOpenModal } from '../../utils/modalRegistry';
import { isIos, isMac, isMobile } from '../../utils/osUtils';
import { getSelectedTimerIntentions } from '../../utils/timerIntentions';
import { useI18n } from '../../i18n';

interface ExpandedIntentionsPickerProps {
  useTallSafeAreaFallback: boolean;
  placement?: 'top' | 'bottom';
}

type PickerIntention = Intention & {
  sourceType: IntentionType;
};

type SubPickerState = {
  parent: PickerIntention;
  intentions: string[];
  subIntentions: Record<string, string>;
  timerType: IntentionType;
} | null;

const EXPANDED_SUB_INTENTIONS_PAGE_SIZE = 6;
const EXPANDED_PICKER_GESTURE_THRESHOLD = 36;
const getParentKey = (type: IntentionType, slug: string) => `${type}:${slug}`;
const getShortcutNumber = (event: globalThis.KeyboardEvent) => {
  if (event.code.startsWith('Digit')) {
    const digit = Number(event.code.replace('Digit', ''));
    return Number.isInteger(digit) ? digit : null;
  }

  if (/^\d$/.test(event.key)) {
    return Number(event.key);
  }

  return null;
};

export function ExpandedIntentionsPicker({
  useTallSafeAreaFallback,
  placement = 'bottom',
}: ExpandedIntentionsPickerProps) {
  const { t } = useI18n();
  const [intentions, setIntentions] = useState<PickerIntention[]>([]);
  const [subIntentionsByParent, setSubIntentionsByParent] = useState<
    Record<string, PickerIntention[]>
  >({});
  const [subPickerState, setSubPickerState] = useState<SubPickerState>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [subCurrentPage, setSubCurrentPage] = useState(0);
  const [isLoadingIntentions, setIsLoadingIntentions] = useState(false);
  const [iosSafeAreaInset, setIosSafeAreaInset] = useState(0);
  const [hasMeasuredIosSafeArea, setHasMeasuredIosSafeArea] = useState(false);
  const [isShortViewport, setIsShortViewport] = useState(false);
  const timer = useTimerStore.use.timer();
  const createOrResumeTimer = useTimerStore.use.createOrResumeTimer();
  const connectionStatus = useTimerStore.use.connectionStatus();
  const advancedSkipModalOpen = useUiStore.use.advancedSkipModalOpen();
  const setActiveTab = useUiStore.use.setActiveTab();
  const requestIntentionCreate = useUiStore.use.requestIntentionCreate();
  const preferences = usePreferencesStore.use.preferences();
  const latestRequestIdRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectedIntentions = getSelectedTimerIntentions(timer);
  const selectedSubIntentions = timer?.subIntentions ?? {};

  const isDisconnected =
    !connectionStatus.isConnected || connectionStatus.isReconnecting;

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
            .filter(i => !i.isArchived)
            .map(intention => ({
              ...intention,
              sourceType: requests[index],
            }));
        });

        const parentIntentions = nextIntentions.filter(
          intention => !intention.parentIntentionId
        );
        const nextSubIntentionsByParent = nextIntentions.reduce(
          (accumulator, intention) => {
            const parentSlug = intention.parentIntention?.slug;
            if (!intention.parentIntentionId || !parentSlug) {
              return accumulator;
            }

            const key = getParentKey(intention.sourceType, parentSlug);
            accumulator[key] = [...(accumulator[key] ?? []), intention];
            return accumulator;
          },
          {} as Record<string, PickerIntention[]>
        );
        setIntentions(parentIntentions);
        setSubIntentionsByParent(nextSubIntentionsByParent);
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
    if (!isIos) {
      return;
    }

    const measureSafeAreaInset = () => {
      const probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      probe.style.paddingBottom = 'env(safe-area-inset-bottom)';

      document.body.appendChild(probe);
      const measuredInset = parseFloat(getComputedStyle(probe).paddingBottom);
      document.body.removeChild(probe);

      if (!Number.isNaN(measuredInset) && measuredInset >= 0) {
        setIosSafeAreaInset(measuredInset);
        setHasMeasuredIosSafeArea(true);
      }
    };

    measureSafeAreaInset();
    const timeout = window.setTimeout(measureSafeAreaInset, 60);
    window.addEventListener('resize', measureSafeAreaInset);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('resize', measureSafeAreaInset);
    };
  }, []);

  useEffect(() => {
    const measureViewport = () => {
      setIsShortViewport(window.innerHeight < 700);
    };

    measureViewport();
    window.addEventListener('resize', measureViewport);
    return () => window.removeEventListener('resize', measureViewport);
  }, []);

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

  const handleIntentionClick = useCallback(
    (intention: PickerIntention) => {
      if (isDisconnected) return;

      const slug = intention.slug;
      let nextTimerType: IntentionType;
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

      if (!nextIntentions.includes(slug)) {
        createOrResumeTimer(
          nextTimerType,
          nextIntentions[0],
          nextIntentions,
          nextSubIntentions,
          undefined,
          resetOnFirstIntention
        );
        return;
      }

      const parentKey = getParentKey(intention.sourceType, slug);
      const subIntentions = subIntentionsByParent[parentKey] ?? [];
      if (subIntentions.length > 0) {
        setSubPickerState({
          parent: intention,
          intentions: nextIntentions,
          subIntentions: nextSubIntentions,
          timerType: nextTimerType,
        });
        setSubCurrentPage(0);
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
    },
    [
      buildNextIntentions,
      createOrResumeTimer,
      intentionType,
      isDisconnected,
      preferences?.intentionRequireSelection,
      preferences?.resetWorkOnFirstIntention,
      preferences?.resetBreakOnFirstIntention,
      preferences?.resetLongBreakOnFirstIntention,
      selectedSubIntentions,
      subIntentionsByParent,
      timer?.type,
      selectedIntentions,
    ]
  );

  const handleSubIntentionSelect = useCallback(
    (subSlug: string) => {
      if (!subPickerState || isDisconnected) return;
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
      setSubPickerState(null);
    },
    [
      createOrResumeTimer,
      isDisconnected,
      preferences?.resetWorkOnFirstIntention,
      preferences?.resetBreakOnFirstIntention,
      preferences?.resetLongBreakOnFirstIntention,
      subPickerState,
    ]
  );

  const handleAddIntention = useCallback(() => {
    requestIntentionCreate();
    setActiveTab('intentions');
  }, [requestIntentionCreate, setActiveTab]);

  const handleOpenIntentions = useCallback(() => {
    setActiveTab('intentions');
  }, [setActiveTab]);

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

  const getVisibleDisplayCount = (
    intention: PickerIntention,
    selectedSubIntention?: PickerIntention
  ) => {
    if (selectedSubIntention) {
      return getSubIntentionDisplayCount(selectedSubIntention);
    }

    return getAggregateDisplayCount(intention);
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
  const showDailyCounts = preferences?.intentionShowDailyCount === true;
  const isTopPlacement = placement === 'top';
  const compressPicker = isShortViewport;
  const itemsPerRow = 3;
  const itemsPerPage = 9;
  const safeAreaBasePadding = isIos ? 0 : compressPicker ? 4 : 8;
  const iosFallbackInset = 34;
  const effectiveIosInset = hasMeasuredIosSafeArea
    ? iosSafeAreaInset > 0
      ? Math.min(iosSafeAreaInset, iosFallbackInset)
      : iosFallbackInset
    : iosSafeAreaInset;
  const safeAreaPaddingBottom = isIos
    ? useTallSafeAreaFallback
      ? `${effectiveIosInset + safeAreaBasePadding}px`
      : '40px'
    : `calc(env(safe-area-inset-bottom) + ${safeAreaBasePadding}px)`;

  const maxPage = Math.max(
    0,
    Math.ceil(displayIntentions.length / itemsPerPage) - 1
  );
  const selectedIntentionIndex = selectedIntentions[0]
    ? displayIntentions.findIndex(
        intention => intention.slug === selectedIntentions[0]
      )
    : -1;
  const selectedIntentionPage =
    selectedIntentionIndex >= 0
      ? Math.floor(selectedIntentionIndex / itemsPerPage)
      : null;

  useEffect(() => {
    setCurrentPage(page => {
      const clampedPage = Math.min(page, maxPage);
      if (selectedIntentionPage === null) {
        return clampedPage;
      }

      return page === 0 || page > maxPage ? selectedIntentionPage : clampedPage;
    });
  }, [maxPage, selectedIntentionPage]);

  const nextPage = () => {
    if (currentPage < maxPage) setCurrentPage(currentPage + 1);
  };

  const prevPage = () => {
    if (currentPage > 0) setCurrentPage(currentPage - 1);
  };

  const currentIntentions = displayIntentions.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );
  const currentSubPickerIntentions = subPickerState
    ? habitsEnabled
      ? orderIntentionsForHabits(
          subIntentionsByParent[
            getParentKey(
              subPickerState.parent.sourceType,
              subPickerState.parent.slug
            )
          ] ?? [],
          getHabitState
        )
      : (subIntentionsByParent[
          getParentKey(
            subPickerState.parent.sourceType,
            subPickerState.parent.slug
          )
        ] ?? [])
    : [];
  const subMaxPage = Math.max(
    0,
    Math.ceil(
      currentSubPickerIntentions.length / EXPANDED_SUB_INTENTIONS_PAGE_SIZE
    ) - 1
  );
  const currentSubIntentions = currentSubPickerIntentions.slice(
    subCurrentPage * EXPANDED_SUB_INTENTIONS_PAGE_SIZE,
    (subCurrentPage + 1) * EXPANDED_SUB_INTENTIONS_PAGE_SIZE
  );
  const subIntentionSlots = Array.from(
    { length: EXPANDED_SUB_INTENTIONS_PAGE_SIZE },
    (_, index) => currentSubIntentions[index] ?? null
  ) as Array<PickerIntention | null>;

  const firstRow = currentIntentions.slice(0, itemsPerRow);
  const secondRow = currentIntentions.slice(itemsPerRow, itemsPerRow * 2);
  const thirdRow = currentIntentions.slice(6, 9);

  useEffect(() => {
    if (!subPickerState) {
      setSubCurrentPage(0);
      return;
    }

    setSubCurrentPage(page => Math.min(page, subMaxPage));
  }, [subPickerState, subMaxPage]);

  const nextSubPage = () => {
    if (subCurrentPage < subMaxPage) setSubCurrentPage(subCurrentPage + 1);
  };

  const prevSubPage = () => {
    if (subCurrentPage > 0) setSubCurrentPage(subCurrentPage - 1);
  };

  const changeHorizontalPage = useCallback(
    (direction: -1 | 1) => {
      if (subPickerState) {
        setSubCurrentPage(page =>
          Math.min(subMaxPage, Math.max(0, page + direction))
        );
        return;
      }

      setCurrentPage(page => Math.min(maxPage, Math.max(0, page + direction)));
    },
    [maxPage, subMaxPage, subPickerState]
  );

  const handlePickerTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const activeMaxPage = subPickerState ? subMaxPage : maxPage;
      if (!isMobile || activeMaxPage <= 0) {
        touchStartRef.current = null;
        return;
      }

      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    },
    [maxPage, subMaxPage, subPickerState]
  );

  const handlePickerTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const activePage = subPickerState ? subCurrentPage : currentPage;
      const activeMaxPage = subPickerState ? subMaxPage : maxPage;
      if (!start || !isMobile || activeMaxPage <= 0) {
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (
        Math.abs(deltaX) <= Math.abs(deltaY) ||
        Math.abs(deltaX) < EXPANDED_PICKER_GESTURE_THRESHOLD
      ) {
        return;
      }

      const direction = deltaX < 0 ? 1 : -1;
      const canMove =
        direction > 0 ? activePage < activeMaxPage : activePage > 0;
      if (canMove) {
        changeHorizontalPage(direction);
      }
    },
    [
      changeHorizontalPage,
      currentPage,
      maxPage,
      subCurrentPage,
      subMaxPage,
      subPickerState,
    ]
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (advancedSkipModalOpen) {
        return;
      }

      if (hasOpenModal()) {
        return;
      }

      const isModPressed = e.metaKey || e.ctrlKey;
      const hasOnlyOptionalMod = !e.altKey && !e.shiftKey;
      const shortcutsEnabled = preferences?.keyboardShortcuts === true;
      const shortcutNumber = getShortcutNumber(e);

      if (subPickerState) {
        if (hasOnlyOptionalMod) {
          if (e.key === 'Escape' && !isModPressed) {
            e.preventDefault();
            setSubPickerState(null);
            return;
          }
        }

        if (!shortcutsEnabled) {
          return;
        }

        if (hasOnlyOptionalMod) {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prevSubPage();
            return;
          }

          if (e.key === 'ArrowRight') {
            e.preventDefault();
            nextSubPage();
            return;
          }

          if (
            shortcutNumber !== null &&
            shortcutNumber >= 1 &&
            shortcutNumber <= 6
          ) {
            e.preventDefault();
            const subIntention = currentSubIntentions[shortcutNumber - 1];
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

      if (!shortcutsEnabled) {
        return;
      }

      if (!hasOnlyOptionalMod) return;

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

      if (shortcutNumber === 0) {
        e.preventDefault();
        handleAddIntention();
        return;
      }

      if (
        shortcutNumber !== null &&
        shortcutNumber >= 1 &&
        shortcutNumber <= 9
      ) {
        e.preventDefault();
        const index = shortcutNumber - 1;
        const intention = currentIntentions[index];
        if (index >= 0 && intention) {
          handleIntentionClick(intention);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    advancedSkipModalOpen,
    currentPage,
    currentIntentions,
    currentSubIntentions,
    handleAddIntention,
    handleIntentionClick,
    handleSubIntentionSelect,
    nextPage,
    nextSubPage,
    prevPage,
    prevSubPage,
    preferences?.keyboardShortcuts,
    subPickerState,
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

  const parentPreviousSelectionCount = getSelectedCount(
    displayIntentions,
    selectedIntentions,
    0,
    currentPage * itemsPerPage
  );
  const parentNextSelectionCount = getSelectedCount(
    displayIntentions,
    selectedIntentions,
    (currentPage + 1) * itemsPerPage,
    displayIntentions.length
  );
  const selectedSubSlug = subPickerState
    ? selectedSubIntentions[subPickerState.parent.slug]
    : undefined;
  const selectedSubSlugs = selectedSubSlug ? [selectedSubSlug] : [];
  const subPreviousSelectionCount = getSelectedCount(
    currentSubPickerIntentions,
    selectedSubSlugs,
    0,
    subCurrentPage * EXPANDED_SUB_INTENTIONS_PAGE_SIZE
  );
  const subNextSelectionCount = getSelectedCount(
    currentSubPickerIntentions,
    selectedSubSlugs,
    (subCurrentPage + 1) * EXPANDED_SUB_INTENTIONS_PAGE_SIZE,
    currentSubPickerIntentions.length
  );

  const renderIntentionButton = (
    intention: PickerIntention,
    pageIndex: number
  ) => {
    const shortcutPrefix = isMac ? '⌘' : 'Ctrl+';
    const isSelected = selectedIntentions.includes(intention.slug);
    const previewClasses = getMixedBreakButtonClasses(
      intention.sourceType,
      isSelected,
      showMixedBreakIntentions
    );
    const selectedSubSlug = selectedSubIntentions[intention.slug];
    const selectedSubIntention = selectedSubSlug
      ? subIntentionsByParent[
          getParentKey(intention.sourceType, intention.slug)
        ]?.find(subIntention => subIntention.slug === selectedSubSlug)
      : undefined;
    const displayTitle = selectedSubIntention?.title ?? intention.title;
    const displayTooltip = selectedSubIntention
      ? `${selectedSubIntention.title} (${shortcutPrefix}${pageIndex + 1})`
      : `${intention.title} (${shortcutPrefix}${pageIndex + 1})`;
    const displayCount = getVisibleDisplayCount(
      intention,
      selectedSubIntention
    );
    const habitState = getHabitState(intention);
    const habitDone = habitState === 'done';
    const isPendingHabit = habitState === 'pending';

    return (
      <button
        key={intention.slug}
        onClick={() => handleIntentionClick(intention)}
        className={`flex items-center rounded-md transition-all relative
          ${isMobile ? 'w-full max-w-none' : 'w-[30%] max-w-40'} overflow-hidden select-none ${
            isTopPlacement
              ? isMobile
                ? 'h-10 p-2'
                : 'h-8 p-1.5'
              : compressPicker
                ? 'h-9 p-1.5'
                : isMobile
                  ? 'h-12 p-2.5'
                  : 'h-11 p-2'
          } ${previewClasses.buttonClass}`}
        title={displayTooltip}
      >
        <div
          className={`mr-2 flex items-center justify-center relative ${isTopPlacement && !isMobile ? 'min-w-7' : 'min-w-8'}`}
        >
          {isPendingHabit && (
            <span
              className="absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-amber-400"
              aria-label={t('intention.habitPendingToday')}
            />
          )}
          {habitDone && (
            <span
              className="absolute left-0 top-0 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-white"
              aria-label={t('intention.habitDoneToday')}
            >
              <FaCheck size={7} />
            </span>
          )}
          {selectedSubIntention ? (
            <IntentionEmojiPair
              parentEmoji={intention.emoji}
              subEmoji={selectedSubIntention.emoji}
              size={isTopPlacement && !isMobile ? 'sm' : 'md'}
            />
          ) : (
            <span
              className={
                isTopPlacement && !isMobile
                  ? 'text-base leading-none'
                  : 'text-xl leading-none'
              }
            >
              {intention.emoji}
            </span>
          )}
          {!isCountLoading && showDailyCounts && displayCount > 0 && (
            <motion.span
              data-testid="intention-count-badge"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className={`absolute text-[9px] font-bold bg-indigo-600 text-white rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5 ${
                selectedSubIntention ? 'top-5 -right-1' : '-top-1 -right-1'
              }`}
            >
              {displayCount}
            </motion.span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={
              isTopPlacement
                ? 'truncate text-[11px] font-medium'
                : 'text-sm font-medium truncate'
            }
          >
            {displayTitle}
          </div>
        </div>
        {showMixedBreakIntentions && (
          <span
            className={`absolute bottom-0 left-0 right-0 h-0.5 ${previewClasses.markerClass}`}
          />
        )}
        {pageIndex < 9 && preferences?.keyboardShortcuts && (
          <KeyboardShortcut text={`${pageIndex + 1}`} position="topRight" />
        )}
      </button>
    );
  };

  const renderRow = (
    row: PickerIntention[],
    rowOffset: number,
    emptyRowKey: string
  ) => {
    return (
      <div
        className={`flex justify-center ${isTopPlacement ? 'gap-1.5' : compressPicker ? 'gap-1' : 'gap-2'}`}
      >
        {row.map((intention, index) => {
          return renderIntentionButton(intention, rowOffset + index);
        })}

        {row.length < itemsPerRow &&
          Array.from({ length: itemsPerRow - row.length }).map((_, index) => (
            <div
              key={`${emptyRowKey}-${index}`}
              data-testid={
                isLoadingIntentions
                  ? 'intention-loading-placeholder'
                  : undefined
              }
              className={`w-[30%] max-w-40 ${
                isTopPlacement
                  ? isMobile
                    ? 'h-10'
                    : 'h-8'
                  : compressPicker
                    ? 'h-9'
                    : isMobile
                      ? 'h-12'
                      : 'h-11'
              } rounded-md ${
                isLoadingIntentions ? 'animate-pulse bg-slate-800/30' : ''
              }`}
            />
          ))}
      </div>
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
        className={`relative flex ${isMobile ? 'h-8 w-11' : 'h-7 w-10'} items-center justify-center rounded-md border transition-all ${
          isSelected
            ? 'border-cyan-300/70 bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-300/70'
            : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-500/20'
        }`}
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
        <span className="text-base leading-none">{subIntention.emoji}</span>
        {preferences?.keyboardShortcuts && (
          <KeyboardShortcut
            text={`${index + 1}`}
            position="topRight"
            alwaysShow
            showModIcon={false}
          />
        )}
        {!isCountLoading && showDailyCounts && count > 0 && (
          <motion.span
            data-testid="intention-count-badge"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute top-5 -right-1 text-[9px] font-bold bg-cyan-600 text-white rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5"
          >
            {count}
          </motion.span>
        )}
      </button>
    );
  };

  const renderSubIntentionsBand = () => {
    if (!subPickerState) {
      return null;
    }

    if (isMobile) {
      return (
        <div
          data-testid="expanded-sub-intentions-picker"
          className="app-scrollbar w-full overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(to_right,black_0,black_calc(100%-10px),transparent_100%)]"
        >
          <div className="flex min-w-max gap-1 px-2 py-1">
            {currentSubPickerIntentions.map((subIntention, index) =>
              renderSubIntentionButton(subIntention, index)
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        data-testid="expanded-sub-intentions-picker"
        className="flex flex-col items-center gap-0.5"
      >
        <div className="flex items-center gap-0.5 rounded-md border border-cyan-500/20 bg-slate-950/80 px-2 py-1 shadow-lg shadow-slate-950/30">
          <button
            type="button"
            onClick={prevSubPage}
            disabled={subCurrentPage === 0}
            className={`relative flex ${isMobile ? 'h-8 w-8' : 'h-7 w-7'} items-center justify-center rounded-md transition-colors ${
              subCurrentPage === 0
                ? 'text-slate-600'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
            aria-label={t('intention.previousSubIntentions')}
            title={t('intention.previousSubIntentions')}
          >
            <FaChevronLeft size={12} />
            {preferences?.keyboardShortcuts && (
              <KeyboardShortcut
                text="←"
                position="topRight"
                alwaysShow
                showModIcon={false}
              />
            )}
            {renderPageSelectionBadge(subPreviousSelectionCount)}
          </button>

          <div className="grid grid-cols-6 gap-1">
            {subIntentionSlots.map((subIntention, index) => {
              if (!subIntention) {
                return (
                  <div
                    key={`empty-expanded-sub-intention-${index}`}
                    className={`${isMobile ? 'h-8 w-11' : 'h-7 w-10'} rounded-md bg-cyan-500/5`}
                  />
                );
              }

              return renderSubIntentionButton(subIntention, index);
            })}
          </div>

          <button
            type="button"
            onClick={nextSubPage}
            disabled={subCurrentPage >= subMaxPage}
            className={`relative flex ${isMobile ? 'h-8 w-8' : 'h-7 w-7'} items-center justify-center rounded-md transition-colors ${
              subCurrentPage >= subMaxPage
                ? 'text-slate-600'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
            aria-label={t('intention.nextSubIntentions')}
            title={t('intention.nextSubIntentions')}
          >
            <FaChevronRight size={12} />
            {preferences?.keyboardShortcuts && (
              <KeyboardShortcut
                text="→"
                position="topRight"
                alwaysShow
                showModIcon={false}
              />
            )}
            {renderPageSelectionBadge(subNextSelectionCount)}
          </button>
        </div>

        {subMaxPage > 0 && (
          <div className="flex h-4 items-center gap-2">
            <span className="text-[10px] font-medium leading-none text-cyan-100/60">
              {subCurrentPage + 1}/{subMaxPage + 1}
            </span>
          </div>
        )}
      </div>
    );
  };

  const controls = (
    <div
      data-testid="expanded-intentions-controls"
      className="flex min-h-10 w-full items-center justify-between px-3"
    >
      <div className="w-32" />
      <div className="flex flex-1 justify-center">
        <div className="flex items-center gap-2">
          {maxPage > 0 && !isMobile && (
            <PaginationControls
              pageIndex={currentPage}
              pageCount={maxPage + 1}
              onPrevious={prevPage}
              onNext={nextPage}
              previousLabel={t('navigation.previousTaskPage')}
              nextLabel={t('navigation.nextTaskPage')}
              showShortcuts={preferences?.keyboardShortcuts}
              previousBadge={renderPageSelectionBadge(
                parentPreviousSelectionCount
              )}
              nextBadge={renderPageSelectionBadge(parentNextSelectionCount)}
              className="gap-2"
              buttonSizeClassName={isMobile ? 'h-8 w-8' : undefined}
              countClassName={isMobile ? 'min-w-9 text-sm' : undefined}
              iconSize={isMobile ? 17 : undefined}
            />
          )}
        </div>
      </div>
      <div className="flex w-32 justify-end gap-1">
        <Button
          size="xs"
          variant="secondary"
          onClick={handleOpenIntentions}
          className="h-8 w-8 rounded-lg p-0"
          title={t('intention.editIntentions')}
          aria-label={t('intention.editIntentions')}
        >
          <FaListUl size={10} />
        </Button>
        <Button
          size="xs"
          onClick={handleAddIntention}
          className="relative h-8 w-8 rounded-lg p-0"
          title={`${t('intention.addNew')} (${isMac ? '⌘' : 'Ctrl+'}0)`}
          aria-label={t('intention.addNew')}
        >
          <FaPlus size={10} />
          {preferences?.keyboardShortcuts && (
            <KeyboardShortcut text="0" position="topRight" />
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <motion.div
      data-testid="expanded-intentions-picker"
      className={`w-full px-3 ${
        isTopPlacement
          ? 'bg-linear-to-b from-slate-950/45 via-slate-950/20 to-transparent'
          : isIos
            ? 'bg-slate-950 bg-linear-to-t from-slate-950 to-transparent'
            : 'bg-linear-to-t from-slate-900 to-transparent'
      } ${isTopPlacement || compressPicker ? (isMobile ? 'pt-1' : 'pt-1.5') : 'pt-4'} ${
        isDisconnected ? 'opacity-50' : ''
      }`}
      style={{
        paddingBottom: isTopPlacement ? '8px' : safeAreaPaddingBottom,
      }}
      initial={{ opacity: 0, y: isTopPlacement ? -16 : 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onTouchStart={isMobile ? handlePickerTouchStart : undefined}
      onTouchEnd={isMobile ? handlePickerTouchEnd : undefined}
    >
      <div className="flex flex-col">
        {isMobile ? (
          <div
            data-testid="expanded-intentions-grid"
            className="app-scrollbar grid w-full grid-flow-col grid-rows-3 gap-1.5 overflow-x-auto overscroll-x-contain p-1 [mask-image:linear-gradient(to_right,black_0,black_calc(100%-10px),transparent_100%)]"
            style={{ gridAutoColumns: 'min(8.5rem, 38vw)' }}
          >
            {displayIntentions.map((intention, index) =>
              renderIntentionButton(intention, index)
            )}
          </div>
        ) : (
          <div
            data-testid="expanded-intentions-grid"
            className={
              isTopPlacement || compressPicker
                ? isTopPlacement
                  ? 'flex flex-col gap-1.5'
                  : 'flex flex-col gap-1'
                : 'flex flex-col gap-2'
            }
          >
            {renderRow(firstRow, 0, 'empty-first')}
            {renderRow(secondRow, itemsPerRow, 'empty-second')}
            {renderRow(thirdRow, itemsPerRow * 2, 'empty-third')}
          </div>
        )}
        <div
          data-testid="expanded-intentions-bottom-slot"
          className={`relative flex items-center justify-center ${isTopPlacement || compressPicker ? 'mt-1 min-h-8' : 'mt-2 min-h-10'}`}
        >
          {subPickerState ? renderSubIntentionsBand() : controls}
        </div>
      </div>
    </motion.div>
  );
}
