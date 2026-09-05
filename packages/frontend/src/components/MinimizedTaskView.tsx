import type { Intention, List, ListItem, Task } from '@pomi/shared';
import {
  TASK_STATUSES,
  TIMER_TYPES,
  TIMER_TYPE_VALUES,
} from '@pomi/shared/src/constants';
import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from 'react';
import { FaEdit, FaPlus, FaSearch, FaThumbtack, FaTimes } from 'react-icons/fa';
import { MOBILE_TASK_ROW_HEIGHT } from '../constants/mobileTaskLayout';
import { useTaskOrderingClock } from '../hooks/useTaskOrderingClock';
import { useI18n } from '../i18n';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTasksStore } from '../stores/tasksStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { useVacationStore } from '../stores/vacationStore';
import { apiClient } from '../utils/apiClient';
import {
  requestListRefresh,
  subscribeToListRefresh,
} from '../utils/listRefresh';
import { mixTaskAndListItems } from '../utils/mixedTaskItems';
import { isMobile } from '../utils/osUtils';
import {
  focusTaskOnTimer,
  getTaskIntentionEmojis,
  getTaskPriorityAccentClass,
  isInlineTaskPropertyUpdate,
  isTaskOverdue,
} from '../utils/taskUi';
import {
  buildTaskView,
  getDisplayedTaskMode,
  type TaskViewTimer,
} from '../utils/taskView';
import { getSelectedTimerIntentions } from '../utils/timerIntentions';
import { submitUserMutation } from '../utils/userActionQueue';
import { shouldHideVacationCoveredTasks } from '../utils/vacationVisibility';
import { PaginationControls } from './PaginationControls';
import { TaskModeToggle } from './TaskModeToggle';
import { CompletionButton } from './tasks/CompletionButton';
import { MobileSwipeActionRow } from './tasks/MobileSwipeActionRow';
import { OverflowTaskTitle } from './tasks/OverflowTaskTitle';
import { TaskArchiveConfirmationModal } from './tasks/TaskArchiveConfirmationModal';
import {
  TaskDescriptionButton,
  TaskDescriptionModal,
} from './tasks/TaskDescriptionModal';
import { TaskFollowUpContext } from './tasks/TaskFollowUpContext';
import { TaskFormModal } from './tasks/TaskFormModal';
import { TaskInlineProperties } from './tasks/TaskInlineProperties';
import { TaskQuickCreateRow } from './tasks/TaskQuickCreateRow';
import { TaskTimerTypeBadge } from './tasks/TaskTimerTypeBadge';
import { showToastFromStore } from './toast/ToastContext';
import { Button } from './ui/Button';
import { CompactIconButton } from './ui/CompactIconButton';
import { IntentionEmojiPair } from './ui/IntentionEmojiPair';
import { KeyboardShortcut } from './ui/KeyboardShortcut';

const TASK_ACTION_BUTTON_BASE_CLASS =
  'group/task-action relative flex items-center justify-center overflow-visible rounded-full border border-slate-700/60 bg-slate-950/40 p-0 text-slate-300 transition hover:border-slate-500 hover:bg-slate-800/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50';
const TASK_ACTION_ICON_SIZE = 13;
const MOBILE_TASK_PEEK_HEIGHT = 28;
const MOBILE_TASK_GESTURE_THRESHOLD = 36;
export const MOBILE_TASK_SCROLL_GUTTER_CLASS =
  'app-scrollbar -mr-3 h-full w-[calc(100%+0.75rem)] space-y-1 overflow-y-auto overscroll-contain pr-3';
interface MinimizedTaskViewProps {
  className?: string;
  compact?: boolean;
  visibleRowLimit: number;
}

function isTypingInField(event: globalThis.KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toLowerCase();
  return (
    tagName === 'input' || tagName === 'textarea' || target.isContentEditable
  );
}

function canToggleTaskPin(task: Task) {
  return !task.followUpSourceTaskId && !task.followUpParent;
}

export function getPinShortcutTask(tasks: Task[], code: string) {
  if (!/^Digit[1-9]$/.test(code)) return null;
  const task = tasks[Number(code.slice(-1)) - 1];
  return task && canToggleTaskPin(task) ? task : null;
}

export function getTaskDestinationPageIndex(
  tasks: Array<Pick<Task, 'id'>>,
  taskId: string,
  tasksPerPage: number
) {
  const destinationIndex = tasks.findIndex(task => task.id === taskId);
  return destinationIndex < 0
    ? null
    : Math.floor(destinationIndex / tasksPerPage);
}

export function shouldDisplayMinimizedListItems(
  timerType: TaskViewTimer['type'] | undefined,
  displayedTaskMode: 'general' | 'intention',
  query: string
) {
  return (
    timerType === TIMER_TYPES.WORK &&
    (displayedTaskMode === 'general' || query.trim().length > 0)
  );
}

export function MinimizedTaskView({
  className,
  compact = false,
  visibleRowLimit,
}: MinimizedTaskViewProps) {
  const { t } = useI18n();
  const tasks = useTasksStore.use.tasks();
  const completingTaskIds = useTasksStore.use.completingTaskIds();
  const preferences = usePreferencesStore.use.preferences();
  const vacationStatus = useVacationStore.use.status();
  const loadVacationStatus = useVacationStore.use.loadStatus();
  const updatePreferenceWithResult =
    usePreferencesStore.use.updatePreferenceWithResult();
  const isLoading = useTasksStore.use.isLoading();
  const loadTasks = useTasksStore.use.loadTasks();
  const createTask = useTasksStore.use.createTask();
  const updateTask = useTasksStore.use.updateTask();
  const timer = useTimerStore.use.timer();
  const orderingClock = useTaskOrderingClock();
  const timerType = timer?.type;
  const timerIntention = timer?.intention;
  const timerIntentionSlugs = timer?.intentionSlugs;
  const timerSubIntention = timer?.subIntention;
  const timerSubIntentions = timer?.subIntentions;
  const taskViewTimer = useMemo<TaskViewTimer | null>(
    () =>
      timerType === undefined
        ? null
        : {
            type: timerType,
            intention: timerIntention,
            intentionSlugs: timerIntentionSlugs,
            subIntention: timerSubIntention,
            subIntentions: timerSubIntentions,
          },
    [
      timerIntention,
      timerIntentionSlugs,
      timerSubIntention,
      timerSubIntentions,
      timerType,
    ]
  );
  const createOrResumeTimer = useTimerStore.use.createOrResumeTimer();
  const taskMode = useUiStore.use.taskMode();
  const setTaskMode = useUiStore.use.setTaskMode();
  const setActiveTab = useUiStore.use.setActiveTab();
  const setExpanded = useUiStore.use.setExpanded();
  const requestTaskCreate = useUiStore.use.requestTaskCreate();
  const taskEditRequestedId = useUiStore.use.taskEditRequestedId();
  const requestTaskEdit = useUiStore.use.requestTaskEdit();
  const clearTaskEditRequest = useUiStore.use.clearTaskEditRequest();
  const requestTaskItemReveal = useUiStore.use.requestTaskItemReveal();
  const taskSearchFocusRequest = useUiStore.use.taskSearchFocusRequest();
  const [pageIndex, setPageIndex] = useState(0);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [createInitialTitle, setCreateInitialTitle] = useState('');
  const [descriptionTask, setDescriptionTask] = useState<Task | null>(null);
  const [archiveTask, setArchiveTask] = useState<Task | null>(null);
  const [taskScrollEdges, setTaskScrollEdges] = useState({
    top: false,
    bottom: false,
  });
  const [isTaskSearchOpen, setIsTaskSearchOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [completingListItemIds, setCompletingListItemIds] = useState<string[]>(
    []
  );
  const [taskDestinationId, setTaskDestinationId] = useState<string | null>(
    null
  );
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const taskHighlightTimeoutRef = useRef<number | null>(null);
  const [pinningTaskIds, setPinningTaskIds] = useState<string[]>([]);
  const pinningTaskIdsRef = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const taskScrollRef = useRef<HTMLDivElement | null>(null);
  const taskSearchBlurredByEscapeRef = useRef(false);
  const taskSearchFocusPendingRef = useRef(false);
  const lastTaskSearchFocusRequestRef = useRef(taskSearchFocusRequest);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const editingTask = tasks.find(task => task.id === editingTaskId);
  const tasksPerPage = Math.min(5, Math.max(1, Math.trunc(visibleRowLimit)));
  const hasTimerIntention =
    getSelectedTimerIntentions(taskViewTimer).length > 0;
  const displayedTaskMode = getDisplayedTaskMode(taskMode, hasTimerIntention);
  const hideVacationCovered = shouldHideVacationCoveredTasks(
    preferences?.vacationExtension,
    preferences?.tasksShowVacationCovered,
    vacationStatus.active
  );
  const canUseTaskSearch = preferences?.tasksExtension === true;
  const effectiveTaskSearchQuery = canUseTaskSearch ? taskSearchQuery : '';
  const quickCreateDefaults = useMemo(
    () => buildMinimizedQuickCreateDefaults(taskViewTimer, displayedTaskMode),
    [displayedTaskMode, taskViewTimer]
  );
  const mobileExpandedLayout = isMobile && !compact;
  const taskActionButtonClassName = clsx(
    TASK_ACTION_BUTTON_BASE_CLASS,
    mobileExpandedLayout ? 'h-8 w-8' : 'h-7 w-7'
  );
  const taskActionIconSize = mobileExpandedLayout ? 14 : TASK_ACTION_ICON_SIZE;
  const taskGridMinHeight = compact
    ? 90
    : mobileExpandedLayout
      ? tasksPerPage * MOBILE_TASK_ROW_HEIGHT
      : 96;

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (preferences?.vacationExtension === true) void loadVacationStatus();
  }, [loadVacationStatus, preferences?.vacationExtension]);

  useEffect(() => {
    if (!vacationStatus.active) return;
    const interval = window.setInterval(
      () => void loadVacationStatus(),
      60_000
    );
    return () => window.clearInterval(interval);
  }, [loadVacationStatus, vacationStatus.active]);

  const loadLists = useCallback(async () => {
    if (!preferences?.listsExtension) {
      setLists([]);
      setListItems([]);
      return;
    }
    const [listsResponse, itemsResponse] = await Promise.all([
      apiClient.lists.list({ query: {} }),
      apiClient.lists.items({ query: {} }),
    ]);
    if (listsResponse.status === 200) {
      setLists(listsResponse.body.filter(list => !list.isArchived));
    }
    if (itemsResponse.status === 200) {
      setListItems(itemsResponse.body);
    }
  }, [preferences?.listsExtension]);

  useEffect(() => {
    void loadLists();
    return subscribeToListRefresh(() => void loadLists());
  }, [loadLists]);

  const createListItemFromEditor = useCallback(
    async (
      listId: string,
      item: {
        title: string;
        dueDate: string | null;
        priority: Task['priority'];
        vacationEligible: boolean;
      }
    ) => {
      try {
        await submitUserMutation({
          kind: 'lists',
          label: t('task.createListItemAction'),
          payload: { operation: 'createItem', listId, ...item },
          reconcile: loadLists,
        });
        await loadLists();
        requestListRefresh();
        return true;
      } catch {
        return false;
      }
    },
    [loadLists, t]
  );

  const convertTaskToListItem = useCallback(
    async (
      taskId: string,
      listId: string,
      item: {
        title: string;
        dueDate: string | null;
        priority: Task['priority'];
        vacationEligible: boolean;
      }
    ) => {
      try {
        await submitUserMutation({
          kind: 'lists',
          label: t('task.moveTaskToList'),
          payload: {
            operation: 'convertTaskToListItem',
            taskId,
            listId,
            ...item,
          },
          reconcile: async () => {
            await Promise.all([loadTasks(), loadLists()]);
          },
        });
        await Promise.all([loadTasks(), loadLists()]);
        requestListRefresh();
        showToastFromStore(t('task.movedToList'), 'success');
        return true;
      } catch {
        return false;
      }
    },
    [loadLists, loadTasks, t]
  );

  const updateListItem = useCallback(
    async (
      item: ListItem,
      updates: {
        dueDate?: string | null;
        priority?: ListItem['priority'];
      }
    ) => {
      try {
        await submitUserMutation({
          kind: 'lists',
          label: t('lists.updateItem'),
          payload: { operation: 'updateItem', itemId: item.id, ...updates },
          reconcile: loadLists,
        });
        await loadLists();
        requestListRefresh();
        return true;
      } catch {
        return false;
      }
    },
    [loadLists, t]
  );

  const completeListItem = useCallback(
    async (item: ListItem) => {
      if (completingListItemIds.includes(item.id)) return;
      setCompletingListItemIds(current => [...current, item.id]);
      try {
        await submitUserMutation({
          kind: 'lists',
          label: t('lists.completeItem'),
          payload: {
            operation: 'updateItem',
            itemId: item.id,
            status: TASK_STATUSES.COMPLETED,
          },
          reconcile: loadLists,
        });
        await loadLists();
        requestListRefresh();
      } finally {
        setCompletingListItemIds(current =>
          current.filter(itemId => itemId !== item.id)
        );
      }
    },
    [completingListItemIds, loadLists, t]
  );

  const convertListItemToTask = useCallback(
    async (
      itemId: string,
      intentionSlug: string,
      subIntentionSlug: string | null
    ) => {
      try {
        await submitUserMutation({
          kind: 'lists',
          label: t('task.intentionOrList'),
          payload: {
            operation: 'convertListItemToTask',
            itemId,
            intentionSlug,
            subIntentionSlug,
          },
          reconcile: async () => {
            await Promise.all([loadTasks(), loadLists()]);
          },
        });
        await Promise.all([loadTasks(), loadLists()]);
        requestListRefresh();
        showToastFromStore(t('task.updated'), 'success');
        return true;
      } catch {
        return false;
      }
    },
    [loadLists, loadTasks, t]
  );

  const openListItem = useCallback(
    (item: ListItem) => {
      setExpanded(true);
      setActiveTab('timer');
      requestTaskItemReveal({
        kind: 'listItem',
        id: item.id,
        listId: item.listId,
      });
    },
    [requestTaskItemReveal, setActiveTab, setExpanded]
  );

  useEffect(() => {
    if (compact || !taskEditRequestedId) {
      return;
    }

    if (!tasks.some(task => task.id === taskEditRequestedId)) {
      return;
    }

    setEditingTaskId(taskEditRequestedId);
    clearTaskEditRequest();
  }, [clearTaskEditRequest, compact, taskEditRequestedId, tasks]);

  useEffect(() => {
    let isCancelled = false;

    Promise.all(
      TIMER_TYPE_VALUES.map(type =>
        apiClient.intentions.list({
          query: { type, includeSubIntentions: true },
        })
      )
    ).then(responses => {
      if (!isCancelled) {
        setIntentions(
          responses.flatMap(response =>
            response.status === 200
              ? response.body.filter(intention => !intention.isArchived)
              : []
          )
        );
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const taskView = useMemo(
    () =>
      buildTaskView({
        tasks,
        timer: taskViewTimer,
        mode: displayedTaskMode,
        filterTimerType: true,
        hideVacationCovered,
        today: orderingClock.today,
        currentTime: orderingClock.currentTime,
      }),
    [
      displayedTaskMode,
      hideVacationCovered,
      orderingClock,
      taskViewTimer,
      tasks,
    ]
  );
  const updateTaskWithDeferredOrder = useCallback(
    async (updates: Parameters<typeof updateTask>[0]) => {
      const isPinUpdate = updates.pinned !== undefined;
      if (isPinUpdate && pinningTaskIdsRef.current.has(updates.id)) {
        return false;
      }
      if (isPinUpdate) {
        pinningTaskIdsRef.current.add(updates.id);
        setPinningTaskIds([...pinningTaskIdsRef.current]);
      }
      const currentTask = tasks.find(task => task.id === updates.id);
      try {
        const didUpdate = await updateTask(updates);
        if (didUpdate && updates.pinned === true && currentTask) {
          setTaskDestinationId(currentTask.id);
          await focusTaskOnTimer({
            task: currentTask,
            timer,
            preferences,
            createOrResumeTimer,
            updatePreferenceWithResult,
            setTaskMode,
          });
        }
        if (didUpdate && isInlineTaskPropertyUpdate(updates)) {
          showToastFromStore(t('task.updated'), 'success', 5000, {
            label: t('task.viewUpdated'),
            onClick: () => setTaskDestinationId(updates.id),
          });
        }
        return didUpdate;
      } finally {
        if (isPinUpdate) {
          pinningTaskIdsRef.current.delete(updates.id);
          setPinningTaskIds([...pinningTaskIdsRef.current]);
        }
      }
    },
    [
      createOrResumeTimer,
      preferences,
      setTaskMode,
      tasks,
      timer,
      t,
      updateTask,
      updatePreferenceWithResult,
    ]
  );

  const displayTasks = useMemo(() => {
    const query = effectiveTaskSearchQuery.trim();
    if (!query) {
      return taskView.tasks;
    }
    return searchMinimizedTasks(
      tasks,
      query,
      taskViewTimer,
      hideVacationCovered,
      intentions
    );
  }, [
    effectiveTaskSearchQuery,
    hideVacationCovered,
    taskView.tasks,
    taskViewTimer,
    tasks,
    intentions,
  ]);
  const displayListItems = useMemo(() => {
    const query = effectiveTaskSearchQuery.trim();
    if (
      !shouldDisplayMinimizedListItems(
        taskViewTimer?.type,
        displayedTaskMode,
        query
      )
    ) {
      return [];
    }
    return searchMinimizedListItems(
      listItems,
      lists,
      query,
      hideVacationCovered
    );
  }, [
    displayedTaskMode,
    effectiveTaskSearchQuery,
    hideVacationCovered,
    listItems,
    lists,
    taskViewTimer?.type,
  ]);
  const displayEntries = useMemo(
    () => mixTaskAndListItems(displayTasks, displayListItems, 'default'),
    [displayListItems, displayTasks]
  );
  const generalPreviewTasks = useMemo(
    () =>
      effectiveTaskSearchQuery.trim()
        ? []
        : taskView.generalPreviewTasks.filter(task =>
            doesTaskMatchMiniSearch(task, effectiveTaskSearchQuery)
          ),
    [effectiveTaskSearchQuery, taskView.generalPreviewTasks]
  );
  const pageCount = Math.max(
    1,
    Math.ceil(displayEntries.length / tasksPerPage)
  );
  const visibleEntries = useMemo(() => {
    if (mobileExpandedLayout) return displayEntries;
    const normalizedPage = Math.min(pageIndex, pageCount - 1);
    return displayEntries.slice(
      normalizedPage * tasksPerPage,
      normalizedPage * tasksPerPage + tasksPerPage
    );
  }, [
    displayEntries,
    mobileExpandedLayout,
    pageCount,
    pageIndex,
    tasksPerPage,
  ]);
  const visibleTasks = useMemo(
    () =>
      visibleEntries.flatMap(entry =>
        entry.kind === 'task' ? [entry.task] : []
      ),
    [visibleEntries]
  );

  useEffect(() => {
    setPageIndex(currentPage => Math.min(currentPage, pageCount - 1));
  }, [pageCount]);

  useLayoutEffect(() => {
    if (!taskDestinationId) return;
    const destinationPage = getTaskDestinationPageIndex(
      displayEntries.map(entry => ({
        id: entry.kind === 'task' ? entry.task.id : entry.item.id,
      })),
      taskDestinationId,
      tasksPerPage
    );
    if (destinationPage === null) {
      setTaskDestinationId(null);
      return;
    }

    if (!mobileExpandedLayout) {
      if (destinationPage !== pageIndex) {
        setPageIndex(destinationPage);
        return;
      }
    }

    const destination = Array.from(
      taskScrollRef.current?.querySelectorAll<HTMLElement>(
        '[data-testid="minimized-task-row"]'
      ) ?? []
    ).find(row => row.dataset.taskId === taskDestinationId);
    if (!destination) return;

    if (mobileExpandedLayout) {
      destination.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    setHighlightedTaskId(taskDestinationId);
    setTaskDestinationId(null);
    if (taskHighlightTimeoutRef.current !== null) {
      window.clearTimeout(taskHighlightTimeoutRef.current);
    }
    taskHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedTaskId(null);
      taskHighlightTimeoutRef.current = null;
    }, 1800);
  }, [
    displayEntries,
    mobileExpandedLayout,
    pageIndex,
    taskDestinationId,
    tasksPerPage,
  ]);

  useEffect(
    () => () => {
      if (taskHighlightTimeoutRef.current !== null) {
        window.clearTimeout(taskHighlightTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (effectiveTaskSearchQuery.trim().length > 0) {
      setPageIndex(0);
    }
  }, [effectiveTaskSearchQuery]);

  useEffect(() => {
    if (taskSearchFocusRequest === lastTaskSearchFocusRequestRef.current) {
      return;
    }
    lastTaskSearchFocusRequestRef.current = taskSearchFocusRequest;
    if (!canUseTaskSearch) {
      return;
    }
    if (isTaskSearchOpen) {
      if (taskSearchBlurredByEscapeRef.current) {
        taskSearchBlurredByEscapeRef.current = false;
        setTaskSearchQuery('');
        setIsTaskSearchOpen(false);
        requestAnimationFrame(() => searchInputRef.current?.blur());
        return;
      }
      if (document.activeElement === searchInputRef.current) {
        setTaskSearchQuery('');
        setIsTaskSearchOpen(false);
        requestAnimationFrame(() => searchInputRef.current?.blur());
        return;
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return;
    }
    taskSearchBlurredByEscapeRef.current = false;
    taskSearchFocusPendingRef.current = true;
    setIsTaskSearchOpen(true);
  }, [canUseTaskSearch, isTaskSearchOpen, taskSearchFocusRequest]);

  useLayoutEffect(() => {
    if (
      !isTaskSearchOpen ||
      !canUseTaskSearch ||
      !taskSearchFocusPendingRef.current
    ) {
      return;
    }

    taskSearchFocusPendingRef.current = false;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [canUseTaskSearch, isTaskSearchOpen]);

  const openTaskCreate = useCallback(() => {
    setIsQuickCreateOpen(current => !current);
  }, []);

  const openAdvancedTaskCreate = useCallback(
    (initialTitle: string) => {
      setIsQuickCreateOpen(false);
      if (compact) {
        setExpanded(true);
        setActiveTab('timer');
        requestTaskCreate(initialTitle);
        return;
      }

      setCreateInitialTitle(initialTitle);
      setIsCreateOpen(true);
    },
    [compact, requestTaskCreate, setActiveTab, setExpanded]
  );

  const changePage = useCallback(
    (direction: -1 | 1) => {
      setPageIndex(currentPage =>
        Math.min(pageCount - 1, Math.max(0, currentPage + direction))
      );
    },
    [pageCount]
  );

  const handleTaskTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (!mobileExpandedLayout || pageCount <= 1) {
        touchStartRef.current = null;
        return;
      }

      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    },
    [mobileExpandedLayout, pageCount]
  );

  const handleTaskTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start || !mobileExpandedLayout || pageCount <= 1) {
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (
        Math.abs(deltaY) <= Math.abs(deltaX) ||
        Math.abs(deltaY) < MOBILE_TASK_GESTURE_THRESHOLD
      ) {
        return;
      }

      const direction = deltaY < 0 ? 1 : -1;
      const canMove = direction > 0 ? pageIndex < pageCount - 1 : pageIndex > 0;
      if (canMove) {
        changePage(direction);
      }
    },
    [changePage, mobileExpandedLayout, pageCount, pageIndex]
  );

  const toggleTaskSearch = useCallback(() => {
    setIsTaskSearchOpen(isOpen => {
      const nextOpen = !isOpen;
      if (nextOpen) {
        taskSearchBlurredByEscapeRef.current = false;
        taskSearchFocusPendingRef.current = true;
      } else {
        taskSearchBlurredByEscapeRef.current = false;
        taskSearchFocusPendingRef.current = false;
        setTaskSearchQuery('');
      }
      return nextOpen;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTypingInField(event)) {
        return;
      }

      const isModPressed = event.metaKey || event.ctrlKey;
      if (event.altKey) {
        return;
      }

      if (!event.shiftKey && event.key === 'ArrowUp') {
        event.preventDefault();
        changePage(-1);
        return;
      }

      if (!event.shiftKey && event.key === 'ArrowDown') {
        event.preventDefault();
        changePage(1);
        return;
      }

      if (!isModPressed) {
        return;
      }

      if (!event.shiftKey && event.code === 'KeyG') {
        event.preventDefault();
        setTaskMode('general');
        return;
      }

      if (!event.shiftKey && event.code === 'KeyI') {
        if (!hasTimerIntention) {
          return;
        }
        event.preventDefault();
        setTaskMode('intention');
        return;
      }

      if (!event.shiftKey && event.code === 'KeyN') {
        event.preventDefault();
        openTaskCreate();
        return;
      }

      if (
        event.shiftKey &&
        event.code.startsWith('Digit') &&
        event.code !== 'Digit0'
      ) {
        const task = getPinShortcutTask(visibleTasks, event.code);
        if (!task) {
          return;
        }

        event.preventDefault();
        void updateTaskWithDeferredOrder({
          id: task.id,
          pinned: task.pinnedAt === null,
        });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    changePage,
    hasTimerIntention,
    openTaskCreate,
    setTaskMode,
    updateTaskWithDeferredOrder,
    visibleTasks,
  ]);

  const availableRows = [
    ...visibleEntries,
    ...(generalPreviewTasks.length > 0 && visibleEntries.length < tasksPerPage
      ? ['general-preview' as const]
      : []),
  ];
  const visibleRows = mobileExpandedLayout
    ? availableRows
    : availableRows.slice(0, tasksPerPage);

  const updateTaskScrollEdges = useCallback(() => {
    const scrollArea = taskScrollRef.current;
    if (!scrollArea) return;
    setTaskScrollEdges({
      top: scrollArea.scrollTop > 1,
      bottom:
        scrollArea.scrollTop + scrollArea.clientHeight <
        scrollArea.scrollHeight - 1,
    });
  }, []);

  useLayoutEffect(() => {
    if (!mobileExpandedLayout) {
      setTaskScrollEdges({ top: false, bottom: false });
      return;
    }
    const scrollArea = taskScrollRef.current;
    if (!scrollArea) return;
    const frame = window.requestAnimationFrame(updateTaskScrollEdges);
    const observer = new ResizeObserver(updateTaskScrollEdges);
    observer.observe(scrollArea);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mobileExpandedLayout, updateTaskScrollEdges, visibleRows.length]);

  return (
    <div
      data-testid="minimized-task-view"
      className={clsx(
        'relative mx-auto w-full max-w-md rounded-lg border border-transparent bg-transparent shadow-none',
        compact ? 'px-2 py-1' : 'px-4 py-2',
        className
      )}
      onTouchStart={mobileExpandedLayout ? handleTaskTouchStart : undefined}
      onTouchEnd={mobileExpandedLayout ? handleTaskTouchEnd : undefined}
    >
      <div className="relative mb-2 min-h-9">
        {isQuickCreateOpen ? (
          <TaskQuickCreateRow
            compact={compact}
            autoFocus
            createDefaults={quickCreateDefaults}
            assistantDefaults={quickCreateDefaults}
            onOpenAdvanced={openAdvancedTaskCreate}
            onCancel={() => setIsQuickCreateOpen(false)}
            onCreated={() => setIsQuickCreateOpen(false)}
          />
        ) : (
          <div className="flex items-center gap-2">
            {isTaskSearchOpen && canUseTaskSearch ? (
              <label className="relative z-10 min-w-0 flex-1">
                <span className="sr-only">
                  {t('navigation.searchVisibleTasks')}
                </span>
                <FaSearch
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={taskSearchQuery}
                  onChange={event => setTaskSearchQuery(event.target.value)}
                  onFocus={() => {
                    taskSearchBlurredByEscapeRef.current = false;
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      taskSearchBlurredByEscapeRef.current = true;
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder={t('task.search')}
                  aria-label={t('navigation.searchVisibleTasks')}
                  className="h-8 w-full rounded-md border border-slate-700/50 bg-slate-950/65 py-0 pl-6 pr-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/70"
                />
              </label>
            ) : (
              <div className="shrink-0">
                <TaskModeToggle
                  mode={displayedTaskMode}
                  onModeChange={setTaskMode}
                  showShortcuts
                  isIntentionDisabled={!hasTimerIntention}
                  compact
                />
              </div>
            )}
            {!mobileExpandedLayout && (
              <div
                className={clsx(
                  'flex justify-center',
                  !isTaskSearchOpen &&
                    'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
                )}
              >
                <PaginationControls
                  pageIndex={pageIndex}
                  pageCount={pageCount}
                  onPrevious={() => changePage(-1)}
                  onNext={() => changePage(1)}
                  direction="vertical"
                  previousLabel={t('navigation.previousTaskPage')}
                  nextLabel={t('navigation.nextTaskPage')}
                  className={
                    isTaskSearchOpen ? 'gap-0' : isMobile ? 'gap-0.5' : 'gap-1'
                  }
                  buttonSizeClassName={
                    isTaskSearchOpen
                      ? 'h-6 w-6'
                      : isMobile
                        ? 'h-7 w-7'
                        : undefined
                  }
                  buttonClassName="bg-transparent hover:bg-transparent"
                  countClassName={clsx(
                    isTaskSearchOpen
                      ? 'min-w-6 text-[9px]'
                      : isMobile
                        ? 'min-w-7 text-xs'
                        : 'text-[10px]'
                  )}
                  iconSize={isTaskSearchOpen ? 12 : isMobile ? 15 : 16}
                  showSinglePageControls={!compact}
                />
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
              {canUseTaskSearch && isTaskSearchOpen ? (
                <CompactIconButton
                  label={t('task.closeSearch')}
                  title={t('task.closeSearch')}
                  onClick={toggleTaskSearch}
                  variant="secondary"
                >
                  <FaTimes size={9} />
                  <KeyboardShortcut text="K" showModIcon />
                </CompactIconButton>
              ) : (
                <>
                  {canUseTaskSearch && (
                    <CompactIconButton
                      label={t('task.search')}
                      title={t('task.searchShortcut')}
                      onClick={toggleTaskSearch}
                      variant="secondary"
                    >
                      <FaSearch size={9} />
                      <KeyboardShortcut text="K" showModIcon />
                    </CompactIconButton>
                  )}
                  <CompactIconButton
                    label={t('navigation.addTask')}
                    title={t('navigation.addTask')}
                    onClick={openTaskCreate}
                    variant="primary"
                    className={mobileExpandedLayout ? '!h-8 !w-8' : undefined}
                  >
                    <FaPlus size={mobileExpandedLayout ? 10 : 9} />
                    <KeyboardShortcut text="N" showModIcon />
                  </CompactIconButton>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        className={mobileExpandedLayout ? 'relative' : undefined}
        style={
          mobileExpandedLayout
            ? { height: taskGridMinHeight + MOBILE_TASK_PEEK_HEIGHT }
            : undefined
        }
      >
        <div
          ref={taskScrollRef}
          data-testid="minimized-task-grid"
          onScroll={mobileExpandedLayout ? updateTaskScrollEdges : undefined}
          className={clsx(
            mobileExpandedLayout
              ? MOBILE_TASK_SCROLL_GUTTER_CLASS
              : 'grid gap-1'
          )}
          style={
            mobileExpandedLayout
              ? undefined
              : {
                  gridTemplateRows: `repeat(${tasksPerPage}, minmax(0, 1fr))`,
                  minHeight: taskGridMinHeight,
                }
          }
        >
          {isLoading && (
            <div
              className="flex items-center justify-center text-xs text-slate-400"
              style={{ gridRow: `span ${tasksPerPage}` }}
            >
              {t('task.loading')}
            </div>
          )}
          {!isLoading &&
            displayEntries.length === 0 &&
            generalPreviewTasks.length === 0 && (
              <div
                className="rounded-md border border-dashed border-slate-700/55 px-3 text-xs text-slate-400 transition hover:border-indigo-500/60 hover:text-slate-200"
                style={{ gridRow: `span ${tasksPerPage}` }}
              >
                {effectiveTaskSearchQuery.trim()
                  ? t('task.noMatching')
                  : t('task.noTasks')}
              </div>
            )}
          {!isLoading &&
            visibleRows.map(row => {
              if (row === 'general-preview') {
                return (
                  <GeneralPreviewStrip
                    key="general-preview"
                    tasks={generalPreviewTasks}
                    onSwitch={() => setTaskMode('general')}
                  />
                );
              }

              if (row.kind === 'listItem') {
                return (
                  <MinimizedListItemRow
                    key={`list-item:${row.item.id}`}
                    item={row.item}
                    list={row.list}
                    intentions={intentions}
                    compact={compact}
                    mobileExpandedLayout={mobileExpandedLayout}
                    isCompleting={completingListItemIds.includes(row.item.id)}
                    onComplete={completeListItem}
                    onUpdate={updateListItem}
                    onConvertToTask={convertListItemToTask}
                    onOpen={openListItem}
                  />
                );
              }

              const task = row.task;
              const isPinned = task.pinnedAt !== null;
              const isPinning = pinningTaskIds.includes(task.id);
              const isCompleting = completingTaskIds.includes(task.id);
              const isOverdue = isTaskOverdue(task);
              const intentionEmojis = getTaskIntentionEmojis(task, intentions);

              const taskRow = (
                <div
                  key={task.id}
                  data-testid="minimized-task-row"
                  data-task-id={task.id}
                  data-pinned={isPinned}
                  data-overdue={isOverdue}
                  data-completing={isCompleting}
                  className={clsx(
                    'group/minimized-task relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-visible rounded-md border transition-all duration-200',
                    compact
                      ? 'min-h-7 px-1.5'
                      : mobileExpandedLayout
                        ? 'min-h-10 px-2.5 py-1'
                        : 'min-h-8 px-2',
                    (task.status === TASK_STATUSES.COMPLETED || isCompleting) &&
                      'opacity-45 line-through',
                    isPinned &&
                      'border-indigo-400/70 bg-indigo-950/35 shadow-sm shadow-indigo-500/10 ring-1 ring-indigo-400/30',
                    !isPinned &&
                      'border-slate-800/70 bg-slate-950/35 hover:border-slate-700/80 hover:bg-slate-900/55',
                    highlightedTaskId === task.id &&
                      'border-indigo-300/90 ring-2 ring-indigo-400/60'
                  )}
                >
                  <div
                    aria-hidden="true"
                    className={clsx(
                      'absolute inset-y-1 left-0 w-0.5 rounded-r-full',
                      getTaskPriorityAccentClass(task.priority)
                    )}
                    data-testid="minimized-task-priority-accent"
                  />
                  <CompletionButton
                    label={task.title}
                    isCompleted={task.status === TASK_STATUSES.COMPLETED}
                    isCompleting={isCompleting}
                    onClick={() =>
                      void updateTask({
                        id: task.id,
                        status: isCompleting
                          ? TASK_STATUSES.ACTIVE
                          : TASK_STATUSES.COMPLETED,
                      })
                    }
                    disabled={task.status === TASK_STATUSES.COMPLETED}
                    compact={!mobileExpandedLayout}
                  />
                  <div className="min-w-0">
                    {task.followUpParent && (
                      <TaskFollowUpContext
                        parentTitle={task.followUpParent.title}
                        compact
                      />
                    )}
                    <div className="flex min-w-0 items-center gap-1">
                      {isPinned && (
                        <FaThumbtack
                          aria-hidden="true"
                          className="shrink-0 text-[10px] text-indigo-200"
                        />
                      )}
                      <OverflowTaskTitle
                        title={task.title}
                        testId="minimized-task-title"
                        nativeOnly
                        className="text-xs font-medium text-slate-100"
                      />
                      <TaskDescriptionButton
                        task={task}
                        onOpen={setDescriptionTask}
                      />
                      {effectiveTaskSearchQuery.trim() && (
                        <TaskTimerTypeBadge timerType={task.timerType} />
                      )}
                    </div>
                    <TaskInlineProperties
                      task={task}
                      intentions={intentions}
                      lists={lists}
                      onUpdate={updateTaskWithDeferredOrder}
                      onConvertToListItem={convertTaskToListItem}
                      onOpenEditor={() => {
                        if (compact) {
                          requestTaskEdit(task.id);
                          setExpanded(true);
                          return;
                        }
                        setEditingTaskId(task.id);
                      }}
                      showIntention
                      compact
                      isOverdue={isOverdue}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-1 opacity-80 transition-opacity group-hover/minimized-task:opacity-100 group-focus-within/minimized-task:opacity-100">
                    {canToggleTaskPin(task) && (
                      <button
                        type="button"
                        aria-label={t(
                          isPinned ? 'task.unpinFor' : 'task.pinFor',
                          { title: task.title }
                        )}
                        title={t(isPinned ? 'task.unpin' : 'task.pin')}
                        onClick={() =>
                          void updateTaskWithDeferredOrder({
                            id: task.id,
                            pinned: !isPinned,
                          })
                        }
                        className={clsx(
                          taskActionButtonClassName,
                          isPinned &&
                            '!border-indigo-300/80 !bg-indigo-500 !text-ink shadow-sm shadow-indigo-500/30'
                        )}
                        disabled={isPinning}
                        aria-pressed={isPinned}
                      >
                        <FaThumbtack
                          size={taskActionIconSize}
                          className="shrink-0"
                        />
                        {(intentionEmojis.parentEmoji ||
                          intentionEmojis.subEmoji) && (
                          <span
                            data-testid="task-pin-intention-badge"
                            className="pointer-events-none absolute -right-0.5 -top-1 origin-top-right scale-75 drop-shadow"
                          >
                            <IntentionEmojiPair
                              parentEmoji={intentionEmojis.parentEmoji}
                              subEmoji={intentionEmojis.subEmoji}
                              size="xs"
                            />
                          </span>
                        )}
                        {visibleTasks.indexOf(task) < 9 && (
                          <KeyboardShortcut
                            text={`⇧${visibleTasks.indexOf(task) + 1}`}
                            showModIcon
                          />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t('task.editFor', { title: task.title })}
                      title={t('common.edit')}
                      onClick={() => {
                        if (compact) {
                          requestTaskEdit(task.id);
                          setExpanded(true);
                          return;
                        }
                        setEditingTaskId(task.id);
                      }}
                      className={taskActionButtonClassName}
                    >
                      <FaEdit size={taskActionIconSize} className="shrink-0" />
                    </button>
                  </div>
                </div>
              );
              return mobileExpandedLayout ? (
                <MobileSwipeActionRow
                  key={task.id}
                  disabled={
                    isCompleting || task.status === TASK_STATUSES.COMPLETED
                  }
                  onComplete={() =>
                    void updateTask({
                      id: task.id,
                      status: TASK_STATUSES.COMPLETED,
                    })
                  }
                  onArchive={() => setArchiveTask(task)}
                  className="rounded-md"
                >
                  {taskRow}
                </MobileSwipeActionRow>
              ) : (
                taskRow
              );
            })}
        </div>
        {mobileExpandedLayout && taskScrollEdges.top && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-3 bg-linear-to-b from-slate-950 to-transparent" />
        )}
        {mobileExpandedLayout && taskScrollEdges.bottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-3 bg-linear-to-t from-slate-950 to-transparent" />
        )}
      </div>

      {(!compact || editingTask) && (
        <TaskFormModal
          isOpen={isCreateOpen || editingTask !== undefined}
          task={editingTask ?? null}
          intentions={intentions}
          lists={lists}
          preferences={preferences}
          timer={timer}
          taskMode={displayedTaskMode}
          onClose={() => {
            setIsCreateOpen(false);
            setEditingTaskId(null);
            setCreateInitialTitle('');
          }}
          initialTitle={createInitialTitle}
          onCreate={createTask}
          onUpdate={updateTaskWithDeferredOrder}
          onCreateListItem={createListItemFromEditor}
          onConvertToListItem={convertTaskToListItem}
          onArchive={task =>
            updateTask({ id: task.id, status: TASK_STATUSES.ARCHIVED })
          }
        />
      )}

      <TaskDescriptionModal
        task={descriptionTask}
        onClose={() => setDescriptionTask(null)}
      />
      <TaskArchiveConfirmationModal
        task={archiveTask}
        isSaving={false}
        onCancel={() => setArchiveTask(null)}
        onConfirm={() => {
          if (!archiveTask) return;
          void updateTask({
            id: archiveTask.id,
            status: TASK_STATUSES.ARCHIVED,
          }).then(didArchive => {
            if (didArchive) setArchiveTask(null);
          });
        }}
      />
    </div>
  );
}

function buildMinimizedQuickCreateDefaults(
  timer: TaskViewTimer | null | undefined,
  taskMode: 'intention' | 'general'
) {
  const selectedIntentions = getSelectedTimerIntentions(timer);
  const intentionSlug =
    taskMode === 'intention' ? (selectedIntentions[0] ?? null) : null;
  const subIntentionSlug = intentionSlug
    ? (timer?.subIntentions?.[intentionSlug] ??
      (timer?.intention === intentionSlug
        ? (timer?.subIntention ?? null)
        : null))
    : null;

  return {
    timerType: timer?.type ?? TIMER_TYPES.WORK,
    intentionSlug,
    subIntentionSlug,
  };
}

function GeneralPreviewStrip({
  tasks,
  onSwitch,
}: {
  tasks: Task[];
  onSwitch: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden rounded-md border border-slate-800/50 bg-slate-950/25 px-1.5 opacity-70">
      <div className="min-w-0 overflow-hidden">
        <div className="text-[10px] font-semibold text-slate-300">
          {t('common.all')}
        </div>
        <div className="truncate text-[9px] text-slate-500">
          {tasks
            .slice(0, 2)
            .map(task => task.title)
            .join(', ')}
        </div>
      </div>
      <Button
        size="xs"
        variant="secondary"
        onClick={onSwitch}
        className="h-5 max-w-[4.75rem] shrink-0 overflow-hidden truncate px-1.5 py-0 text-[9px] leading-none"
      >
        {t('task.switchToAll')}
      </Button>
    </div>
  );
}

function MinimizedListItemRow({
  item,
  list,
  intentions,
  compact,
  mobileExpandedLayout,
  isCompleting,
  onComplete,
  onUpdate,
  onConvertToTask,
  onOpen,
}: {
  item: ListItem;
  list: List;
  intentions: Intention[];
  compact: boolean;
  mobileExpandedLayout: boolean;
  isCompleting: boolean;
  onComplete: (item: ListItem) => Promise<void>;
  onUpdate: (
    item: ListItem,
    updates: {
      dueDate?: string | null;
      priority?: ListItem['priority'];
    }
  ) => Promise<boolean>;
  onConvertToTask: (
    itemId: string,
    intentionSlug: string,
    subIntentionSlug: string | null
  ) => Promise<boolean>;
  onOpen: (item: ListItem) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="minimized-list-item-row"
      data-list-item-id={item.id}
      data-completing={isCompleting}
      className={clsx(
        'group/minimized-task relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-visible rounded-md border border-slate-800/70 bg-slate-950/35 transition-all duration-200 hover:border-slate-700/80 hover:bg-slate-900/55',
        compact
          ? 'min-h-7 px-1.5'
          : mobileExpandedLayout
            ? 'min-h-10 px-2.5 py-1'
            : 'min-h-8 px-2',
        isCompleting && 'opacity-45 line-through'
      )}
    >
      <div
        aria-hidden="true"
        className={clsx(
          'absolute inset-y-1 left-0 w-0.5 rounded-r-full',
          getTaskPriorityAccentClass(item.priority)
        )}
      />
      <CompletionButton
        label={item.title}
        isCompleted={false}
        isCompleting={isCompleting}
        disabled={isCompleting}
        onClick={() => void onComplete(item)}
        compact={!mobileExpandedLayout}
      />
      <div className="min-w-0">
        <OverflowTaskTitle
          title={item.title}
          testId="minimized-list-item-title"
          nativeOnly
          className="text-xs font-medium text-slate-100"
        />
        <TaskInlineProperties
          task={item}
          intentions={intentions}
          currentList={list}
          onUpdate={update =>
            onUpdate(item, {
              ...(update.dueDate !== undefined
                ? { dueDate: update.dueDate }
                : {}),
              ...(update.priority !== undefined
                ? { priority: update.priority }
                : {}),
            })
          }
          onConvertListItemToTask={onConvertToTask}
          onOpenEditor={() => onOpen(item)}
          showIntention
          compact
          isOverdue={isTaskOverdue({
            dueDate: item.dueDate,
            dueTime: null,
          })}
        />
      </div>
      <button
        type="button"
        aria-label={t('task.editFor', { title: item.title })}
        title={t('common.edit')}
        onClick={() => onOpen(item)}
        className={clsx(
          TASK_ACTION_BUTTON_BASE_CLASS,
          mobileExpandedLayout ? 'h-8 w-8' : 'h-7 w-7'
        )}
      >
        <FaEdit size={mobileExpandedLayout ? 14 : TASK_ACTION_ICON_SIZE} />
      </button>
    </div>
  );
}

export function searchMinimizedTasks(
  tasks: Task[],
  query: string,
  timer: TaskViewTimer | null | undefined,
  hideVacationCovered: boolean,
  intentions: Intention[] = []
) {
  return tasks
    .filter(task => !hideVacationCovered || !task.vacationEligible)
    .filter(task => doesTaskMatchMiniSearch(task, query, intentions))
    .sort(
      (a, b) =>
        Number(doesTaskMatchCurrentTimer(b, timer)) -
          Number(doesTaskMatchCurrentTimer(a, timer)) ||
        Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) ||
        (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? '')
    );
}

export function searchMinimizedListItems(
  items: ListItem[],
  lists: List[],
  query: string,
  hideVacationCovered: boolean
) {
  const normalizedQuery = normalizeMiniSearchText(query);
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const listsById = new Map(lists.map(list => [list.id, list]));

  return items
    .filter(item => item.status === TASK_STATUSES.ACTIVE)
    .filter(item => !hideVacationCovered || !item.vacationEligible)
    .flatMap(item => {
      const list = listsById.get(item.listId);
      if (!list) return [];
      const searchableText = normalizeMiniSearchText(
        `${item.title} ${item.priority} ${list.title}`
      );
      return tokens.every(token => searchableText.includes(token))
        ? [{ item, list }]
        : [];
    });
}

function doesTaskMatchMiniSearch(
  task: Task,
  query: string,
  intentions: Intention[] = []
) {
  const normalizedQuery = normalizeMiniSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const linkedIntentions = intentions.filter(
    intention =>
      intention.type === task.timerType &&
      (intention.slug === task.intentionSlug ||
        intention.slug === task.subIntentionSlug)
  );
  const searchableText = [
    task.title,
    task.description ?? '',
    task.sourceTranscript ?? '',
    task.priority,
    task.timerType,
    ...linkedIntentions.flatMap(intention => [
      intention.title,
      intention.emoji,
    ]),
  ]
    .map(normalizeMiniSearchText)
    .join(' ');
  return normalizedQuery
    .split(' ')
    .every(token => searchableText.includes(token));
}

function normalizeMiniSearchText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function doesTaskMatchCurrentTimer(
  task: Task,
  timer: TaskViewTimer | null | undefined
) {
  if (!timer || task.timerType !== timer.type) {
    return false;
  }
  const selected = getSelectedTimerIntentions(timer);
  if (!task.intentionSlug || !selected.includes(task.intentionSlug)) {
    return false;
  }
  const selectedSub = timer?.subIntentions?.[task.intentionSlug];
  return !selectedSub || task.subIntentionSlug === selectedSub;
}
