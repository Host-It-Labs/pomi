import { FavoriteDestinationShortcuts } from '../components/tasks/FavoriteDestinationShortcuts';
import { getSelectedTimerIntentions } from '../utils/timerIntentions';
import { TaskModeToggle } from '../components/TaskModeToggle';
import { hasOpenModal } from '../utils/modalRegistry';
import { isDesktop } from '../utils/osUtils';
import {
  Intention,
  List,
  ListItem,
  Task,
  type TaskSortMode,
  TaskStatus,
} from '@pomi/shared';
import { TASK_STATUSES, TIMER_TYPES } from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  FaArchive,
  FaChevronUp,
  FaChevronDown,
  FaEdit,
  FaFileImport,
  FaRegStar,
  FaSearch,
  FaSort,
  FaSortAmountDown,
  FaSortAmountUp,
  FaStar,
  FaThumbtack,
  FaTimes,
  FaUndo,
} from 'react-icons/fa';
import {
  IntentionAssignmentPicker,
  type IntentionAssignmentPickerChange,
  type IntentionAssignmentOption,
  type SubIntentionAssignmentOption,
} from '../components/intentions/IntentionAssignmentPicker';
import {
  TaskDescriptionButton,
  TaskDescriptionModal,
} from '../components/tasks/TaskDescriptionModal';
import { TaskFormModal } from '../components/tasks/TaskFormModal';
import { TaskFollowUpContext } from '../components/tasks/TaskFollowUpContext';
import { TaskTimerTypeBadge } from '../components/tasks/TaskTimerTypeBadge';
import { TaskImportModal } from '../components/tasks/TaskImportModal';
import { TaskQuickCreateRow } from '../components/tasks/TaskQuickCreateRow';
import { OverflowTaskTitle } from '../components/tasks/OverflowTaskTitle';
import { TaskInlineProperties } from '../components/tasks/TaskInlineProperties';
import { TaskArchiveConfirmationModal } from '../components/tasks/TaskArchiveConfirmationModal';
import { CompletionButton } from '../components/tasks/CompletionButton';
import { MobileSwipeActionRow } from '../components/tasks/MobileSwipeActionRow';
import {
  EMPTY_TASK_PROPERTY_FILTERS,
  hasTaskPropertyFilters,
  matchesListItemPropertyFilters,
  matchesTaskPropertyFilters,
  TaskPropertyFilterMenu,
  type TaskPropertyFilters,
} from '../components/tasks/TaskPropertyFilterMenu';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { KeyboardShortcut } from '../components/ui/KeyboardShortcut';
import { Modal } from '../components/ui/Modal';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useAuthStore } from '../stores/authStore';
import { useTasksStore } from '../stores/tasksStore';
import { useVacationStore } from '../stores/vacationStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { useTaskOrderingClock } from '../hooks/useTaskOrderingClock';
import { apiClient } from '../utils/apiClient';
import { submitUserMutation } from '../utils/userActionQueue';
import {
  focusTaskOnTimer,
  getTaskPriorityAccentClass,
  isTaskOverdue,
  isInlineTaskPropertyUpdate,
} from '../utils/taskUi';
import { buildTaskView, isTaskLinkedToTimer } from '../utils/taskView';
import { showToastFromStore } from '../components/toast/ToastContext';
import { VacationControl } from '../components/vacation/VacationControl';
import { isMobile } from '../utils/osUtils';
import {
  requestListRefresh,
  subscribeToListRefresh,
} from '../utils/listRefresh';
import { subscribeToIntentionRefresh } from '../utils/recoveryRefresh';
import {
  mixTaskAndListItems,
  type MixedTaskItem,
} from '../utils/mixedTaskItems';
import { useI18n } from '../i18n';
import { useDefaultTaskSort } from './taskDefaultSort';
import { useUpdatedTaskReveal } from './taskUpdatedReveal';
import { shouldHideVacationCoveredTasks } from '../utils/vacationVisibility';

type TaskIntentionFilterValue = string | null;
type TaskIntentionFilterOption = {
  value: string;
  title: string;
  emoji: string;
  intention: Intention;
  parent: Intention | null;
  subIntention: Intention | null;
};

const TASKS_PER_PAGE = 5;

export function TaskWorkspace() {
  const { t } = useI18n();
  const tasks = useTasksStore.use.tasks();
  const completingTaskIds = useTasksStore.use.completingTaskIds();
  const isLoading = useTasksStore.use.isLoading();
  const error = useTasksStore.use.error();
  const loadTasks = useTasksStore.use.loadTasks();
  const createTask = useTasksStore.use.createTask();
  const updateTask = useTasksStore.use.updateTask();
  const user = useAuthStore.use.user();
  const preferences = usePreferencesStore.use.preferences();
  const vacationStatus = useVacationStore.use.status();
  const loadVacationStatus = useVacationStore.use.loadStatus();
  const updatePreferenceWithResult =
    usePreferencesStore.use.updatePreferenceWithResult();
  const timer = useTimerStore.use.timer();
  const orderingClock = useTaskOrderingClock();
  const createOrResumeTimer = useTimerStore.use.createOrResumeTimer();
  const setTaskMode = useUiStore.use.setTaskMode();
  const taskMode = useUiStore.use.taskMode();
  const hasTimerIntention = getSelectedTimerIntentions(timer).length > 0;
  useEffect(() => {
    if (!hasTimerIntention && taskMode === 'intention') setTaskMode('general');
  }, [hasTimerIntention, taskMode, setTaskMode]);
  const [taskPage, setTaskPage] = useState(0);
  const taskCreateRequested = useUiStore.use.taskCreateRequested();
  const taskCreateInitialTitle = useUiStore.use.taskCreateInitialTitle();
  const clearTaskCreateRequest = useUiStore.use.clearTaskCreateRequest();
  const intentionPickerOpenRequest =
    useUiStore.use.intentionPickerOpenRequest();
  const taskSearchFocusRequest = useUiStore.use.taskSearchFocusRequest();
  const taskQuickCreateFocusRequest =
    useUiStore.use.taskQuickCreateFocusRequest();
  const taskItemRevealRequest = useUiStore.use.taskItemRevealRequest();
  const clearTaskItemRevealRequest =
    useUiStore.use.clearTaskItemRevealRequest();
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [editingListItem, setEditingListItem] = useState<ListItem | null>(null);
  const [completingListItemIds, setCompletingListItemIds] = useState<string[]>(
    []
  );
  const [archivingListItem, setArchivingListItem] = useState<ListItem | null>(
    null
  );
  const [isResetListOpen, setIsResetListOpen] = useState(false);
  const [intentionsError, setIntentionsError] = useState<string | null>(null);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [selectedIntentionFilter, setSelectedIntentionFilter] =
    useState<TaskIntentionFilterValue>(null);
  useEffect(() => {
    if (taskMode === 'intention') {
      setSelectedIntentionFilter(null);
      setSelectedListId(null);
    }
  }, [taskMode]);
  const taskModeToggleRequest = useUiStore.use.taskModeToggleRequest();
  const lastModeToggleRequest = useRef(taskModeToggleRequest);
  useEffect(() => {
    if (lastModeToggleRequest.current === taskModeToggleRequest) return;
    lastModeToggleRequest.current = taskModeToggleRequest;
    const next =
      selectedIntentionFilter ||
      selectedListId ||
      taskMode === 'intention' ||
      !hasTimerIntention
        ? 'general'
        : 'intention';
    setSelectedIntentionFilter(null);
    setSelectedListId(null);
    setTaskMode(next);
  }, [
    taskModeToggleRequest,
    selectedIntentionFilter,
    selectedListId,
    taskMode,
    hasTimerIntention,
    setTaskMode,
  ]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createInitialTitle, setCreateInitialTitle] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [hasImportedTasks, setHasImportedTasks] = useState<boolean | null>(
    null
  );
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [isArchiveLoadingMore, setIsArchiveLoadingMore] = useState(false);
  const [archiveNextCursor, setArchiveNextCursor] = useState<string | null>(
    null
  );
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [restoringTaskId, setRestoringTaskId] = useState<string | null>(null);
  const [descriptionTask, setDescriptionTask] = useState<Task | null>(null);
  const [taskSortMode, setTaskSortMode] = useState<TaskSortMode>('default');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [propertyFilters, setPropertyFilters] = useState<TaskPropertyFilters>(
    EMPTY_TASK_PROPERTY_FILTERS
  );
  const [isPropertyMenuOpen, setIsPropertyMenuOpen] = useState(false);
  const [updatedTaskDestinationId, setUpdatedTaskDestinationId] = useState<
    string | null
  >(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const updatedTaskHighlightTimeoutRef = useRef<number | null>(null);
  const [pinnedTaskDestinationId, setPinnedTaskDestinationId] = useState<
    string | null
  >(null);
  const taskSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lastTaskSearchFocusRequestRef = useRef(taskSearchFocusRequest);
  const hideVacationCovered = shouldHideVacationCoveredTasks(
    preferences?.vacationExtension,
    preferences?.tasksShowVacationCovered,
    vacationStatus.active
  );

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (preferences?.vacationExtension === true) void loadVacationStatus();
  }, [loadVacationStatus, preferences?.vacationExtension]);

  useDefaultTaskSort({
    userId: user?.id,
    configuredMode: preferences?.taskDefaultSortMode,
    preferencesLoaded: preferences !== null,
    onApply: setTaskSortMode,
  });

  const loadImportStatus = useCallback(async () => {
    const response = await apiClient.tasks.importStatus();
    if (response.status === 200) {
      setHasImportedTasks(response.body.hasImportedTasks);
    }
  }, []);

  useEffect(() => {
    void loadImportStatus();
  }, [loadImportStatus]);

  useEffect(() => {
    const loadIntentions = async () => {
      const response = await apiClient.intentions.list({
        query: { includeSubIntentions: true },
      });
      if (response.status === 200) {
        const activeIntentions = response.body.filter(
          intention => !intention.isArchived
        );
        setIntentions(activeIntentions);
        setIntentionsError(null);
        return;
      }
      setIntentionsError(t('intention.loadFailed'));
    };

    void loadIntentions();
    return subscribeToIntentionRefresh(() => void loadIntentions());
  }, [t, user?.id]);

  const loadLists = useCallback(async () => {
    const [listsResponse, itemsResponse] = await Promise.all([
      apiClient.lists.list({ query: {} }),
      apiClient.lists.items({ query: {} }),
    ]);
    if (listsResponse.status === 200) {
      setLists(listsResponse.body.filter(list => !list.isArchived));
    }
    if (itemsResponse.status === 200) setListItems(itemsResponse.body);
  }, []);

  useEffect(() => {
    if (!preferences?.listsExtension) {
      setLists([]);
      setListItems([]);
      setSelectedListId(null);
      return;
    }
    void loadLists();
    return subscribeToListRefresh(() => void loadLists());
  }, [loadLists, preferences?.listsExtension]);

  useEffect(() => {
    if (!taskCreateRequested) {
      return;
    }

    setCreateInitialTitle(taskCreateInitialTitle);
    setIsCreateOpen(true);
    clearTaskCreateRequest();
  }, [clearTaskCreateRequest, taskCreateInitialTitle, taskCreateRequested]);

  useEffect(() => {
    if (taskSearchFocusRequest === lastTaskSearchFocusRequestRef.current) {
      return;
    }
    lastTaskSearchFocusRequestRef.current = taskSearchFocusRequest;
    requestAnimationFrame(() => {
      taskSearchInputRef.current?.focus();
      taskSearchInputRef.current?.select();
    });
  }, [taskSearchFocusRequest]);

  const filterOptions = useMemo(() => {
    const availableIntentions = intentions.filter(intention =>
      propertyFilters.timerTypes.includes(intention.type)
    );
    return buildTaskIntentionFilterOptions(availableIntentions);
  }, [intentions, propertyFilters.timerTypes]);
  const timerDestinations = getSelectedTimerIntentions(timer).map(slug => {
    const parent = intentions.find(
      item =>
        item.slug === slug &&
        item.type === timer?.type &&
        !item.parentIntentionId
    );
    const subSlug =
      timer?.subIntentions?.[slug] ??
      (slug === timer?.intention ? timer?.subIntention : null);
    const sub = subSlug
      ? intentions.find(
          item => item.slug === subSlug && item.parentIntentionId === parent?.id
        )
      : null;
    return {
      title: sub?.title ?? parent?.title ?? slug,
      emoji:
        sub?.emoji ?? parent?.emoji ?? timer?.intentionEmojis?.[slug] ?? '🎯',
    };
  });
  const timerFilterLabel =
    taskMode === 'intention' && timerDestinations.length > 0 ? (
      <span
        className="truncate"
        title={timerDestinations.map(item => item.title).join(', ')}
        aria-label={timerDestinations.map(item => item.title).join(', ')}
      >
        {timerDestinations.length === 1
          ? `${timerDestinations[0].emoji} ${timerDestinations[0].title}`
          : timerDestinations.map(item => item.emoji).join(' ')}
      </span>
    ) : undefined;
  const favoriteDestinations = [
    ...filterOptions
      .filter(option => option.intention.isFavorite)
      .map(option => ({
        value: option.value,
        title: option.title,
        emoji: option.emoji,
      })),
    ...lists
      .filter(list => list.isFavorite)
      .map(list => ({
        value: buildListFilterValue(list.id),
        title: list.title,
        emoji: list.emoji ?? '📋',
      })),
  ];
  const selectedFilterOption = useMemo(
    () =>
      selectedIntentionFilter
        ? (filterOptions.find(
            option => option.value === selectedIntentionFilter
          ) ?? null)
        : null,
    [filterOptions, selectedIntentionFilter]
  );
  const taskFormDefaultIntention = useMemo(() => {
    if (!selectedFilterOption) {
      if (taskMode !== 'intention' || !timer) return null;
      const intentionSlug = getSelectedTimerIntentions(timer)[0];
      return intentionSlug
        ? {
            intentionSlug,
            subIntentionSlug:
              timer.subIntentions?.[intentionSlug] ??
              (timer.intention === intentionSlug ? timer.subIntention : null) ??
              null,
          }
        : null;
    }

    return {
      intentionSlug:
        selectedFilterOption.parent?.slug ??
        selectedFilterOption.intention.slug,
      subIntentionSlug: selectedFilterOption.subIntention?.slug ?? null,
    };
  }, [selectedFilterOption, taskMode, timer]);
  const taskFormDefaultTimerType =
    selectedFilterOption?.intention.type ??
    (taskMode === 'intention' ? timer?.type : undefined) ??
    propertyFilters.timerTypes[0] ??
    TIMER_TYPES.WORK;

  const updatePropertyFilters = useCallback(
    (nextFilters: TaskPropertyFilters) => {
      const selectedType = selectedFilterOption?.intention.type;
      if (selectedType && !nextFilters.timerTypes.includes(selectedType)) {
        setSelectedIntentionFilter(null);
        showToastFromStore(t('intention.filterCleared'), 'info');
      }
      setPropertyFilters(nextFilters);
    },
    [selectedFilterOption, t]
  );

  useEffect(() => {
    if (
      selectedIntentionFilter &&
      !filterOptions.some(option => option.value === selectedIntentionFilter)
    ) {
      setSelectedIntentionFilter(null);
    }
  }, [filterOptions, selectedIntentionFilter]);

  const toggleFavoriteIntention = useCallback(
    async (intention: Intention) => {
      const body = {
        title: intention.title,
        emoji: intention.emoji,
        type: intention.type,
        hasCustomDuration: intention.hasCustomDuration,
        customDuration: intention.customDuration ?? undefined,
        keepScreenAwake: intention.keepScreenAwake,
        isHabit: intention.isHabit,
        isFavorite: !intention.isFavorite,
      };
      const result = await submitUserMutation({
        kind: 'intentions',
        label: t('task.updateFavoriteIntention'),
        payload: { operation: 'update', slug: intention.slug, ...body },
        reconcile: async () => {
          const refreshed = await apiClient.intentions.list({
            query: { includeSubIntentions: true },
          });
          if (refreshed.status === 200) {
            setIntentions(refreshed.body.filter(item => !item.isArchived));
          }
        },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: Intention })
          : { status: 200, body: result as Intention };

      if (response.status === 200) {
        setIntentions(current => {
          const next = current.map(item =>
            item.id === response.body.id ? response.body : item
          );
          return next;
        });
        setIntentionsError(null);
        return;
      }

      setIntentionsError(t('task.updateFavoriteIntentionFailed'));
    },
    [t, user?.id]
  );

  const toggleFavoriteList = useCallback(
    async (list: List) => {
      const result = await submitUserMutation({
        kind: 'lists',
        label: t('task.updateFavoriteList'),
        payload: {
          operation: 'update',
          listId: list.id,
          isFavorite: !list.isFavorite,
        },
        reconcile: loadLists,
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: List })
          : { status: 200, body: result as List };
      if (response.status === 200) {
        setLists(current =>
          current.map(item =>
            item.id === response.body.id ? response.body : item
          )
        );
        requestListRefresh();
      }
    },
    [loadLists, t]
  );

  const selectedList = useMemo(
    () => lists.find(list => list.id === selectedListId) ?? null,
    [lists, selectedListId]
  );
  const selectedListItems = useMemo(
    () => listItems.filter(item => item.listId === selectedListId),
    [listItems, selectedListId]
  );
  const activeListItems = useMemo(() => {
    const query = normalizeSearchText(taskSearchQuery);
    const matching = selectedListItems.filter(
      item =>
        item.status === TASK_STATUSES.ACTIVE &&
        (!hideVacationCovered || !item.vacationEligible) &&
        matchesListItemPropertyFilters(item, propertyFilters) &&
        (!query || normalizeSearchText(item.title).includes(query))
    );
    if (taskSortMode === 'created-desc') {
      return [...matching].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
    }
    if (taskSortMode === 'created-asc') {
      return [...matching].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );
    }
    return matching;
  }, [
    hideVacationCovered,
    propertyFilters,
    selectedListItems,
    taskSearchQuery,
    taskSortMode,
  ]);
  const completedListItems = selectedListItems.filter(
    item => item.status === TASK_STATUSES.COMPLETED
  );
  const archivedListItems = selectedListItems.filter(
    item => item.status === TASK_STATUSES.ARCHIVED
  );
  const visibleActiveSelectedListItemCount = selectedListItems.filter(
    item =>
      item.status === TASK_STATUSES.ACTIVE &&
      (!hideVacationCovered || !item.vacationEligible)
  ).length;

  const updateListItem = useCallback(
    async (
      item: ListItem,
      updates: {
        title?: string;
        dueDate?: string | null;
        priority?: ListItem['priority'];
        status?: TaskStatus;
        vacationEligible?: boolean;
      }
    ) => {
      await submitUserMutation({
        kind: 'lists',
        label: t('lists.updateItem'),
        payload: { operation: 'updateItem', itemId: item.id, ...updates },
        reconcile: loadLists,
      });
      await loadLists();
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
        });
        await new Promise(resolve => window.setTimeout(resolve, 900));
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

  const createListItemFromEditor = useCallback(
    async (
      listId: string,
      item: {
        title: string;
        dueDate: string | null;
        priority: ListItem['priority'];
        vacationEligible: boolean;
      }
    ) => {
      try {
        await submitUserMutation({
          kind: 'lists',
          label: t('lists.createItem'),
          payload: { operation: 'createItem', listId, ...item },
          reconcile: loadLists,
        });
        await loadLists();
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
        priority: ListItem['priority'];
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
        showToastFromStore(t('task.movedToList'), 'success');
        return true;
      } catch {
        return false;
      }
    },
    [loadLists, loadTasks, t]
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
        showToastFromStore(t('task.updated'), 'success');
        return true;
      } catch {
        return false;
      }
    },
    [loadLists, loadTasks, t]
  );

  const resetSelectedList = useCallback(async () => {
    if (!selectedList) return;
    await submitUserMutation({
      kind: 'lists',
      label: t('task.resetListFor', { title: selectedList.title }),
      payload: {
        operation: 'resetCompletedItems',
        listId: selectedList.id,
      },
      reconcile: loadLists,
    });
    setIsResetListOpen(false);
    await loadLists();
  }, [loadLists, selectedList, t]);

  const loadTaskArchive = useCallback(
    async (cursor?: string) => {
      if (cursor) {
        setIsArchiveLoadingMore(true);
      } else {
        setIsArchiveLoading(true);
        setArchivedTasks([]);
        setArchiveNextCursor(null);
      }
      try {
        const pageResponse = await apiClient.tasks.archive({
          query: { limit: 50, ...(cursor ? { cursor } : {}) },
        });
        if (pageResponse.status === 200) {
          setArchivedTasks(current => {
            const combined = cursor
              ? [...current, ...pageResponse.body.items]
              : pageResponse.body.items;
            return [...new Map(combined.map(task => [task.id, task])).values()];
          });
          setArchiveNextCursor(pageResponse.body.nextCursor);
          setArchiveError(null);
          return;
        }

        setArchiveError(t('task.archiveLoadFailed'));
      } catch {
        setArchiveError(t('task.archiveLoadFailed'));
      } finally {
        setIsArchiveLoading(false);
        setIsArchiveLoadingMore(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (isArchiveOpen) {
      void loadTaskArchive();
    }
  }, [isArchiveOpen, loadTaskArchive]);

  const restoreArchivedTask = useCallback(
    async (task: Task) => {
      setRestoringTaskId(task.id);
      try {
        const didRestore = await updateTask({
          id: task.id,
          status: TASK_STATUSES.ACTIVE,
        });
        if (didRestore) {
          setArchivedTasks(current =>
            current.filter(archivedTask => archivedTask.id !== task.id)
          );
          setArchiveError(null);
          await loadTasks();
          return;
        }

        setArchiveError(t('task.restoreFailed'));
      } finally {
        setRestoringTaskId(null);
      }
    },
    [loadTasks, t, updateTask]
  );

  const taskView = useMemo(
    () =>
      buildTaskView({
        tasks,
        mode: 'general',
        filterTimerType: false,
        hideVacationCovered,
        today: orderingClock.today,
        currentTime: orderingClock.currentTime,
      }),
    [hideVacationCovered, orderingClock, tasks]
  );
  const resetUpdatedTaskFilters = useCallback(() => {
    setTaskSearchQuery('');
    setTaskMode('general');
    setSelectedIntentionFilter(null);
    setSelectedListId(null);
    setPropertyFilters(EMPTY_TASK_PROPERTY_FILTERS);
  }, [setTaskMode]);
  const revealUpdatedTask = useUpdatedTaskReveal({
    resetFilters: resetUpdatedTaskFilters,
    setDestinationTaskId: setUpdatedTaskDestinationId,
  });
  useEffect(() => {
    if (!taskItemRevealRequest) return;
    if (taskItemRevealRequest.kind === 'listItem') {
      setTaskMode('general');
      setTaskSearchQuery('');
      setSelectedIntentionFilter(null);
      setPropertyFilters(EMPTY_TASK_PROPERTY_FILTERS);
      setSelectedListId(taskItemRevealRequest.listId);
      setHighlightedTaskId(taskItemRevealRequest.id);
    } else {
      revealUpdatedTask(taskItemRevealRequest.id);
    }
    clearTaskItemRevealRequest();
  }, [
    clearTaskItemRevealRequest,
    revealUpdatedTask,
    taskItemRevealRequest,
    setTaskMode,
  ]);
  const createTaskWithViewFeedback = useCallback(
    async (input: Parameters<typeof createTask>[0]) => {
      const existingTaskIds = new Set(
        useTasksStore.getState().tasks.map(task => task.id)
      );
      const didCreate = await createTask(input);
      if (!didCreate) return false;

      const createdTask = useTasksStore
        .getState()
        .tasks.find(task => !existingTaskIds.has(task.id));
      showToastFromStore(
        t('task.created'),
        'success',
        5000,
        createdTask
          ? {
              label: t('task.viewUpdated'),
              onClick: () => revealUpdatedTask(createdTask.id),
            }
          : undefined
      );
      return true;
    },
    [createTask, revealUpdatedTask, t]
  );
  const updateTaskWithPositionFeedback = useCallback(
    async (updates: Parameters<typeof updateTask>[0]) => {
      const currentTask = tasks.find(task => task.id === updates.id);
      const didUpdate = await updateTask(updates);
      if (didUpdate && updates.pinned === true && currentTask) {
        setPinnedTaskDestinationId(currentTask.id);
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
          onClick: () => revealUpdatedTask(updates.id),
        });
      }
      return didUpdate;
    },
    [
      createOrResumeTimer,
      preferences,
      revealUpdatedTask,
      t,
      updatePreferenceWithResult,
      setTaskMode,
      tasks,
      timer,
      updateTask,
    ]
  );
  const isTaskSearchActive = normalizeSearchText(taskSearchQuery).length > 0;
  const visibleTasks = useMemo(() => {
    const filteredTasks = taskView.tasks
      .filter(
        task => taskMode !== 'intention' || isTaskLinkedToTimer(task, timer)
      )
      .filter(task => doesTaskMatchIntentionFilter(task, selectedFilterOption))
      .filter(task => doesTaskMatchSearch(task, taskSearchQuery, intentions))
      .filter(task => matchesTaskPropertyFilters(task, propertyFilters));
    const sorted = sortTasksForMode(filteredTasks, taskSortMode);
    const ranked = rankTasksForSearch(
      sorted,
      selectedFilterOption,
      isTaskSearchActive
    );
    return ranked;
  }, [
    intentions,
    isTaskSearchActive,
    propertyFilters,
    selectedFilterOption,
    taskSortMode,
    taskSearchQuery,
    taskView.tasks,
    taskMode,
    timer,
  ]);
  const eligibleMixedListItems = useMemo(() => {
    const query = normalizeSearchText(taskSearchQuery);
    if (
      selectedList !== null ||
      preferences?.listsExtension !== true ||
      selectedFilterOption !== null ||
      taskMode === 'intention' ||
      !propertyFilters.timerTypes.includes(TIMER_TYPES.WORK)
    ) {
      return [];
    }

    const listsById = new Map(lists.map(list => [list.id, list]));
    return listItems
      .filter(item => item.status === TASK_STATUSES.ACTIVE)
      .filter(item => !hideVacationCovered || !item.vacationEligible)
      .filter(item => matchesListItemPropertyFilters(item, propertyFilters))
      .map(item => ({ item, list: listsById.get(item.listId) }))
      .filter(
        (entry): entry is { item: ListItem; list: List } =>
          Boolean(entry.list) &&
          (!query ||
            normalizeSearchText(entry.item.title).includes(query) ||
            normalizeSearchText(entry.list?.title ?? '').includes(query))
      );
  }, [
    listItems,
    lists,
    hideVacationCovered,
    preferences?.listsExtension,
    propertyFilters,
    selectedFilterOption,
    selectedList,
    taskMode,
    taskSearchQuery,
  ]);
  const mixedTaskItems = useMemo<MixedTaskItem[]>(
    () =>
      mixTaskAndListItems(visibleTasks, eligibleMixedListItems, taskSortMode),
    [eligibleMixedListItems, taskSortMode, visibleTasks]
  );
  useLayoutEffect(() => {
    if (!pinnedTaskDestinationId) return;
    const destination = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')
    ).find(row => row.dataset.taskId === pinnedTaskDestinationId);
    if (!destination) return;
    destination.scrollIntoView({ behavior: 'auto', block: 'center' });
    destination.focus({ preventScroll: true });
    setPinnedTaskDestinationId(null);
  }, [mixedTaskItems, pinnedTaskDestinationId, taskPage]);
  useLayoutEffect(() => {
    if (!updatedTaskDestinationId) return;
    const destination = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')
    ).find(row => row.dataset.taskId === updatedTaskDestinationId);
    if (!destination) return;
    if (!isDesktop)
      destination.scrollIntoView({ behavior: 'auto', block: 'center' });
    destination.focus({ preventScroll: true });
    setHighlightedTaskId(updatedTaskDestinationId);
    setUpdatedTaskDestinationId(null);
    if (updatedTaskHighlightTimeoutRef.current !== null) {
      window.clearTimeout(updatedTaskHighlightTimeoutRef.current);
    }
    updatedTaskHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedTaskId(null);
      updatedTaskHighlightTimeoutRef.current = null;
    }, 1800);
  }, [mixedTaskItems, updatedTaskDestinationId, taskPage]);
  useEffect(
    () => () => {
      if (updatedTaskHighlightTimeoutRef.current !== null) {
        window.clearTimeout(updatedTaskHighlightTimeoutRef.current);
      }
    },
    []
  );
  const hasActiveFilters =
    taskMode === 'intention' ||
    taskSearchQuery.trim().length > 0 ||
    selectedFilterOption !== null ||
    selectedList !== null ||
    hasTaskPropertyFilters(propertyFilters);
  const taskCountLabel = selectedList
    ? taskSearchQuery.trim()
      ? `${activeListItems.length} of ${visibleActiveSelectedListItemCount}`
      : `${activeListItems.length}`
    : hasActiveFilters
      ? `${mixedTaskItems.length} of ${
          taskView.tasks.length +
          (selectedFilterOption === null &&
          preferences?.listsExtension === true &&
          propertyFilters.timerTypes.includes(TIMER_TYPES.WORK)
            ? listItems.filter(
                item =>
                  item.status === TASK_STATUSES.ACTIVE &&
                  (!hideVacationCovered || !item.vacationEligible)
              ).length
            : 0)
        }`
      : `${mixedTaskItems.length}`;
  const pageEntryCount = selectedList
    ? activeListItems.length
    : mixedTaskItems.length;
  const pageCount = Math.max(1, Math.ceil(pageEntryCount / TASKS_PER_PAGE));
  const visiblePage = Math.min(taskPage, pageCount - 1);
  const resetTaskView = useCallback(() => {
    setTaskSearchQuery('');
    setSelectedIntentionFilter(null);
    setSelectedListId(null);
    setPropertyFilters(EMPTY_TASK_PROPERTY_FILTERS);
    setTaskSortMode('default');
    setTaskMode('general');
    setTaskPage(0);
    setIsPropertyMenuOpen(false);
    setIsSortMenuOpen(false);
  }, [setTaskSearchQuery, setTaskMode]);
  useEffect(() => {
    setTaskPage(0);
  }, [
    taskSearchQuery,
    taskMode,
    timer?.type,
    timer?.intention,
    timer?.intentionSlugs,
    timer?.subIntention,
    timer?.subIntentions,
    selectedIntentionFilter,
    selectedListId,
    propertyFilters,
    taskSortMode,
  ]);
  useEffect(() => {
    const destinationId =
      updatedTaskDestinationId ?? pinnedTaskDestinationId ?? highlightedTaskId;
    if (!destinationId || !isDesktop) return;
    const index = selectedList
      ? activeListItems.findIndex(item => item.id === destinationId)
      : mixedTaskItems.findIndex(entry =>
          entry.kind === 'task'
            ? entry.task.id === destinationId
            : entry.item.id === destinationId
        );
    if (index >= 0) setTaskPage(Math.floor(index / TASKS_PER_PAGE));
  }, [
    updatedTaskDestinationId,
    pinnedTaskDestinationId,
    highlightedTaskId,
    mixedTaskItems,
    selectedList,
    activeListItems,
  ]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        hasOpenModal() ||
        preferences?.keyboardShortcuts === false
      )
        return;
      const target = event.target as HTMLElement;
      const editing = target.closest(
        'input, textarea, select, [contenteditable="true"]'
      );
      if (
        !editing &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (event.code === 'KeyG') {
          event.preventDefault();
          resetTaskView();
          return;
        }
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === 'KeyF'
      ) {
        event.preventDefault();
        resetTaskView();
        return;
      }
      if (
        !isDesktop ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]'
        )
      )
        return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setTaskPage(page =>
          Math.max(
            0,
            Math.min(pageCount - 1, page + (event.key === 'ArrowDown' ? 1 : -1))
          )
        );
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pageCount, resetTaskView, preferences?.keyboardShortcuts]);
  const showImportAction = hasImportedTasks === false;

  return (
    <section
      data-testid="task-workspace"
      aria-label={t('task.tasks')}
      className="task-workspace"
    >
      <details className="workspace-task-actions">
        <summary
          aria-label={t('common.moreOptions')}
          title={t('common.moreOptions')}
        >
          •••
        </summary>
        <div className="workspace-action-menu">
          <div className="flex items-center justify-end gap-1.5">
            {preferences?.vacationExtension && <VacationControl />}
            <IconButton
              label={t('common.archived')}
              title={t('common.archived')}
              size="sm"
              variant="secondary"
              onClick={() => setIsArchiveOpen(true)}
              className="h-8 w-8 !p-0"
            >
              <FaArchive size={11} />
            </IconButton>
            {showImportAction && (
              <IconButton
                label={t('task.import')}
                title={t('task.import')}
                size="sm"
                variant="secondary"
                onClick={() => setIsImportOpen(true)}
                disabled={isLoading}
                className="h-8 w-8 !p-0"
              >
                <FaFileImport size={11} />
              </IconButton>
            )}
          </div>
        </div>
      </details>
      <section
        aria-label={
          selectedList
            ? t('task.addToList', { title: selectedList.title })
            : t('task.capture')
        }
        className="workspace-capture"
      >
        {selectedList ? (
          <TaskQuickCreateRow
            autoFocus
            listId={selectedList.id}
            focusRequest={taskQuickCreateFocusRequest}
            onOpenAdvanced={initialTitle => {
              setCreateInitialTitle(initialTitle);
              setIsCreateOpen(true);
            }}
          />
        ) : (
          <TaskQuickCreateRow
            focusRequest={taskQuickCreateFocusRequest}
            createDefaults={{
              timerType: taskFormDefaultTimerType,
              intentionSlug: taskFormDefaultIntention?.intentionSlug ?? null,
              subIntentionSlug:
                taskFormDefaultIntention?.subIntentionSlug ?? null,
            }}
            assistantDefaults={{
              timerType: taskFormDefaultTimerType,
              intentionSlug: taskFormDefaultIntention?.intentionSlug ?? null,
              subIntentionSlug:
                taskFormDefaultIntention?.subIntentionSlug ?? null,
            }}
            onOpenAdvanced={initialTitle => {
              setCreateInitialTitle(initialTitle);
              setIsCreateOpen(true);
            }}
          />
        )}
      </section>

      <div className="workspace-toolbar">
        <div className="workspace-destination">
          <TaskIntentionFilterDropdown
            options={filterOptions}
            triggerContent={timerFilterLabel}
            lists={lists}
            selectedValue={
              selectedListId
                ? buildListFilterValue(selectedListId)
                : selectedIntentionFilter
            }
            onSelect={value => {
              setTaskMode('general');
              setSelectedListId(null);
              setSelectedIntentionFilter(value);
            }}
            onSelectList={listId => {
              setTaskMode('general');
              setSelectedIntentionFilter(null);
              setSelectedListId(listId);
            }}
            onToggleFavorite={toggleFavoriteIntention}
            onToggleFavoriteList={toggleFavoriteList}
            openRequest={intentionPickerOpenRequest}
          />
        </div>
        <div className="workspace-search">
          <TaskSearchInput
            value={taskSearchQuery}
            onChange={setTaskSearchQuery}
            inputRef={taskSearchInputRef}
          />
        </div>
        <TaskSortDropdown
          mode={taskSortMode}
          isOpen={isSortMenuOpen}
          onOpenChange={setIsSortMenuOpen}
          onChange={setTaskSortMode}
        />
        {!selectedList && (
          <TaskPropertyFilterMenu
            filters={propertyFilters}
            isOpen={isPropertyMenuOpen}
            onOpenChange={setIsPropertyMenuOpen}
            onChange={updatePropertyFilters}
          />
        )}
      </div>
      <div className="workspace-filter-summary">
        <span className="sr-only" data-testid="task-count">
          {taskCountLabel}
        </span>
        <div className="workspace-mode">
          <TaskModeToggle
            compact
            showShortcuts
            mode={selectedIntentionFilter || selectedListId ? null : taskMode}
            isIntentionDisabled={!hasTimerIntention}
            onModeChange={mode => {
              setSelectedIntentionFilter(null);
              setSelectedListId(null);
              setTaskMode(mode);
            }}
          />
        </div>
        {isDesktop && (
          <nav
            className="workspace-pagination"
            aria-label={t('common.pagination')}
          >
            <button
              type="button"
              disabled={visiblePage === 0}
              onClick={() => setTaskPage(visiblePage - 1)}
              aria-label={t('common.previousPage')}
              title={t('workspace.previousTasks')}
            >
              <FaChevronUp size={10} />
            </button>
            <button
              type="button"
              className="workspace-page-count text-[10px] text-slate-400"
              aria-label={`${visiblePage + 1} / ${pageCount}${visiblePage > 0 ? ` — ${t('workspace.firstTaskPage')}` : ''}`}
              title={visiblePage > 0 ? t('workspace.firstTaskPage') : undefined}
              disabled={visiblePage === 0}
              onClick={() => setTaskPage(0)}
            >
              <span className="workspace-page-number">
                {visiblePage + 1} / {pageCount}
              </span>
              <FaUndo
                className="workspace-page-reset"
                size={10}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              disabled={visiblePage >= pageCount - 1}
              onClick={() => setTaskPage(visiblePage + 1)}
              aria-label={t('common.nextPage')}
              title={t('workspace.nextTasks')}
            >
              <FaChevronDown size={10} />
            </button>
          </nav>
        )}
        <div className="workspace-filter-actions">
          <FavoriteDestinationShortcuts
            destinations={favoriteDestinations}
            selectedValue={
              taskMode === 'intention'
                ? null
                : selectedListId
                  ? buildListFilterValue(selectedListId)
                  : selectedIntentionFilter
            }
            onSelect={value => {
              setTaskMode('general');
              setSelectedListId(
                isListFilterValue(value) ? parseListFilterValue(value) : null
              );
              setSelectedIntentionFilter(
                isListFilterValue(value) ? null : value
              );
            }}
          />
          <IconButton
            size="sm"
            disabled={!hasActiveFilters && taskSortMode === 'default'}
            variant="secondary"
            label={`${t('common.clearFilters')} (Mod+Shift+F)`}
            onClick={resetTaskView}
          >
            <FaUndo />
            <KeyboardShortcut text="⇧F" />
          </IconButton>
        </div>
      </div>

      <div
        className={clsx(
          'workspace-task-rows app-scrollbar',
          isDesktop && 'workspace-task-rows-desktop'
        )}
      >
        {error && <Alert variant="error">{error}</Alert>}
        {intentionsError && <Alert variant="error">{intentionsError}</Alert>}

        {isLoading && (
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/35 px-5 py-8 text-center text-sm text-slate-400">
            {t('task.loading')}
          </div>
        )}

        {selectedList ? (
          <SelectedListItems
            list={selectedList}
            intentions={intentions}
            activeItems={
              isDesktop
                ? activeListItems.slice(
                    visiblePage * TASKS_PER_PAGE,
                    (visiblePage + 1) * TASKS_PER_PAGE
                  )
                : activeListItems
            }
            completedItems={completedListItems}
            archivedItems={archivedListItems}
            onEdit={setEditingListItem}
            completingItemIds={completingListItemIds}
            onComplete={completeListItem}
            onArchive={setArchivingListItem}
            onRestore={item =>
              updateListItem(item, { status: TASK_STATUSES.ACTIVE })
            }
            onReset={() => setIsResetListOpen(true)}
            onUpdate={updateListItem}
            onConvertToTask={convertListItemToTask}
          />
        ) : null}

        {!selectedList &&
          !isLoading &&
          mixedTaskItems.length === 0 &&
          !hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setCreateInitialTitle('');
                setIsCreateOpen(true);
              }}
              className="w-full rounded-xl border border-dashed border-slate-700/60 bg-slate-900/25 px-5 py-10 text-sm text-slate-400 transition hover:border-indigo-500/60 hover:bg-indigo-950/15 hover:text-slate-200"
            >
              {t('task.add')}
            </button>
          )}

        {!selectedList &&
          !isLoading &&
          mixedTaskItems.length === 0 &&
          hasActiveFilters && (
            <div className="rounded-lg border border-slate-800/60 bg-slate-900/35 px-5 py-8 text-center text-sm text-slate-400">
              {hasActiveFilters ? t('task.noMatching') : t('task.noTasks')}
            </div>
          )}

        {!selectedList && !isLoading && mixedTaskItems.length > 0 && (
          <MixedTaskList
            entries={
              isDesktop
                ? mixedTaskItems.slice(
                    visiblePage * TASKS_PER_PAGE,
                    (visiblePage + 1) * TASKS_PER_PAGE
                  )
                : mixedTaskItems
            }
            completingTaskIds={completingTaskIds}
            completingListItemIds={completingListItemIds}
            intentions={intentions}
            lists={lists}
            onEdit={setEditingTask}
            onEditListItem={setEditingListItem}
            onCompleteListItem={completeListItem}
            onArchiveListItem={setArchivingListItem}
            onUpdateListItem={updateListItem}
            onConvertListItemToTask={convertListItemToTask}
            onOpenDescription={setDescriptionTask}
            onUpdate={updateTaskWithPositionFeedback}
            onConvertToListItem={convertTaskToListItem}
            showTypeBadge={
              propertyFilters.timerTypes.length !== 1 || isTaskSearchActive
            }
            highlightedTaskId={highlightedTaskId}
          />
        )}
      </div>

      <TaskFormModal
        isOpen={isCreateOpen || editingTask !== null}
        task={editingTask}
        intentions={intentions}
        lists={lists}
        preferences={preferences}
        timer={timer}
        taskMode={taskMode}
        defaultIntentionSelection={taskFormDefaultIntention}
        defaultTimerType={taskFormDefaultTimerType}
        initialTitle={createInitialTitle}
        initialListId={selectedListId}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingTask(null);
          setCreateInitialTitle('');
        }}
        onCreate={createTaskWithViewFeedback}
        onUpdate={updateTaskWithPositionFeedback}
        onCreateListItem={createListItemFromEditor}
        onConvertToListItem={convertTaskToListItem}
        onArchive={task =>
          updateTask({ id: task.id, status: TASK_STATUSES.ARCHIVED })
        }
      />
      <TaskDescriptionModal
        task={descriptionTask}
        onClose={() => setDescriptionTask(null)}
      />
      <TaskImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImported={loadImportStatus}
      />
      <TaskArchiveModal
        isOpen={isArchiveOpen}
        tasks={archivedTasks}
        isLoading={isArchiveLoading}
        isLoadingMore={isArchiveLoadingMore}
        hasMore={archiveNextCursor !== null}
        error={archiveError}
        restoringTaskId={restoringTaskId}
        onClose={() => setIsArchiveOpen(false)}
        onRestore={restoreArchivedTask}
        onLoadMore={() => {
          if (archiveNextCursor) {
            void loadTaskArchive(archiveNextCursor);
          }
        }}
      />
      <ListItemEditModal
        item={editingListItem}
        onClose={() => setEditingListItem(null)}
        onArchive={item => setArchivingListItem(item)}
        onSave={async (item, updates) => {
          await updateListItem(item, updates);
          setEditingListItem(null);
        }}
      />
      <Modal
        isOpen={archivingListItem !== null}
        onClose={() => setArchivingListItem(null)}
        title={t('task.archiveListItem')}
        closeOnBackdropClick={true}
        closeOnEscape={true}
      >
        <p className="text-sm text-slate-300">
          {t('task.archiveListItemMessage', {
            title: archivingListItem?.title ?? '',
          })}
        </p>
        <div className="mt-5 flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setArchivingListItem(null)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              const item = archivingListItem;
              if (!item) return;
              void updateListItem(item, {
                status: TASK_STATUSES.ARCHIVED,
              }).then(() => {
                setArchivingListItem(null);
                if (editingListItem?.id === item.id) setEditingListItem(null);
              });
            }}
          >
            {t('common.archive')}
          </Button>
        </div>
      </Modal>
      <Modal
        isOpen={isResetListOpen}
        onClose={() => setIsResetListOpen(false)}
        title={t('task.resetList')}
        closeOnBackdropClick={true}
        closeOnEscape={true}
      >
        <p className="text-sm text-slate-300">
          {t('task.resetListMessage', {
            count: completedListItems.length,
            itemLabel: t(
              completedListItems.length === 1
                ? 'task.completedItem'
                : 'task.completedItems'
            ),
            title: selectedList?.title ?? '',
          })}
        </p>
        <div className="mt-5 flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setIsResetListOpen(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button className="flex-1" onClick={() => void resetSelectedList()}>
            {t('task.resetListAction')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function TaskSearchInput({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  const { t } = useI18n();
  return (
    <label data-testid="task-search-field" className="relative min-w-0">
      <span className="sr-only">{t('task.search')}</span>
      <FaSearch
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500"
      />
      <input
        ref={inputRef}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.currentTarget.blur();
          }
        }}
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={t('common.search')}
        className="h-9 w-full rounded-md border border-slate-800 bg-slate-900/70 py-0 pl-7 pr-8 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/70"
      />
      {value.trim().length === 0 && (
        <KeyboardShortcut text="K" showModIcon position="topRight" />
      )}
      {value.trim().length > 0 && (
        <button
          type="button"
          aria-label={t('task.clearSearch')}
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 z-20 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
        >
          <FaTimes size={10} />
        </button>
      )}
    </label>
  );
}

function TaskSortDropdown({
  mode,
  isOpen,
  onOpenChange,
  onChange,
}: {
  mode: TaskSortMode;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onChange: (mode: TaskSortMode) => void;
}) {
  const { t } = useI18n();
  const options: Array<{ mode: TaskSortMode; label: string }> = [
    { mode: 'default', label: t('task.sortDefault') },
    { mode: 'created-desc', label: t('task.sortNewest') },
    { mode: 'created-asc', label: t('task.sortOldest') },
  ];
  const label =
    mode === 'created-desc'
      ? t('task.sortByNewest')
      : mode === 'created-asc'
        ? t('task.sortByOldest')
        : t('task.sortDefaultOrder');

  return (
    <div className="relative">
      <IconButton
        variant={mode === 'default' ? 'secondary' : 'primary'}
        size="sm"
        onClick={() => onOpenChange(!isOpen)}
        className="h-7 w-7 !p-0"
        label={label}
        title={label}
        aria-expanded={isOpen}
      >
        {mode === 'created-desc' ? (
          <FaSortAmountDown size={11} />
        ) : mode === 'created-asc' ? (
          <FaSortAmountUp size={11} />
        ) : (
          <FaSort size={11} />
        )}
      </IconButton>
      {isOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-36 overflow-hidden rounded-md border border-slate-800 bg-slate-950 py-1 text-xs shadow-xl shadow-black/30">
          {options.map(option => (
            <button
              key={option.mode}
              type="button"
              onClick={() => {
                onChange(option.mode);
                onOpenChange(false);
              }}
              className={clsx(
                'flex w-full items-center justify-between px-3 py-2 text-left transition hover:bg-slate-800/80',
                option.mode === mode ? 'text-indigo-100' : 'text-slate-300'
              )}
            >
              <span>{option.label}</span>
              {option.mode === mode && (
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskIntentionFilterDropdown({
  triggerContent,
  options,
  lists,
  selectedValue,
  onSelect,
  onSelectList,
  onToggleFavorite,
  onToggleFavoriteList,
  openRequest,
}: {
  triggerContent?: import('react').ReactNode;
  options: TaskIntentionFilterOption[];
  lists: List[];
  selectedValue: TaskIntentionFilterValue;
  onSelect: (value: TaskIntentionFilterValue) => void;
  onSelectList: (listId: string) => void;
  onToggleFavorite: (intention: Intention) => void;
  onToggleFavoriteList: (list: List) => void;
  openRequest: number;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const lastOpenRequestRef = useRef(openRequest);
  const selectedOption =
    selectedValue === null
      ? null
      : (options.find(option => option.value === selectedValue) ?? null);
  const pickerOptions = useMemo(() => {
    return [
      ...buildTaskFilterPickerOptions(options),
      ...lists.map(list => ({
        value: buildListFilterValue(list.id),
        title: `List · ${list.title}`,
        emoji: list.emoji ?? '📋',
      })),
    ];
  }, [lists, options]);
  const subIntentionsByParent = useMemo(
    () => buildTaskFilterSubIntentionsByParent(options),
    [options]
  );
  const parentOptionsByValue = useMemo(
    () =>
      new Map(
        options
          .filter(option => !option.subIntention)
          .map(option => [option.value, option])
      ),
    [options]
  );
  const selectedParentValue = isListFilterValue(selectedValue)
    ? selectedValue
    : selectedOption
      ? selectedOption.parent
        ? buildTaskIntentionFilterValue(selectedOption.parent)
        : selectedOption.value
      : null;
  const selectedSubIntentions =
    selectedOption?.parent && selectedOption.subIntention && selectedParentValue
      ? { [selectedParentValue]: selectedOption.subIntention.slug }
      : {};

  useEffect(() => {
    if (openRequest === lastOpenRequestRef.current) {
      return;
    }
    lastOpenRequestRef.current = openRequest;
    setIsOpen(true);
  }, [openRequest]);

  const handlePickerChange = (change: IntentionAssignmentPickerChange) => {
    const parentValue = change.intentionSlugs[0];
    if (!parentValue) {
      onSelect(null);
      setIsOpen(false);
      return;
    }

    if (isListFilterValue(parentValue)) {
      onSelectList(parseListFilterValue(parentValue));
      setIsOpen(false);
      return;
    }

    const subSlug = change.subIntentions[parentValue];
    const nextValue = subSlug
      ? (options.find(
          option =>
            option.parent &&
            buildTaskIntentionFilterValue(option.parent) === parentValue &&
            option.subIntention?.slug === subSlug
        )?.value ?? parentValue)
      : parentValue;

    onSelect(nextValue === selectedValue ? null : nextValue);
    if (change.reason !== 'intention' || !subIntentionsByParent[parentValue]) {
      setIsOpen(false);
    }
  };

  return (
    <IntentionAssignmentPicker
      label={t('task.filterOpenList')}
      triggerContent={triggerContent}
      showLabel={false}
      options={pickerOptions}
      subIntentionsByParent={subIntentionsByParent}
      selectedIntentions={selectedParentValue ? [selectedParentValue] : []}
      selectedSubIntentions={selectedSubIntentions}
      mode="single"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      onChange={handlePickerChange}
      allowClear
      clearLabel={t('common.all')}
      emptyLabel={t('common.all')}
      noSelectionLabel={t('common.all')}
      shortcut="I"
      shortcutShowModIcon
      shortcutPosition="topRight"
      shortcutAlwaysShow={false}
      searchAriaLabel={t('intention.searchIntentionsLists')}
      maxHeight={264}
      triggerClassName="relative flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 text-left text-xs text-slate-100 outline-none transition-colors hover:bg-slate-800/80 focus:border-indigo-400/70 disabled:opacity-60"
      dropdownClassName="left-0 right-auto task-destination-dropdown"
      subIntentionDisplay="emoji"
      listTestId="task-intention-filter-list"
      triggerTestId="task-intention-filter-trigger"
      clearTestId="task-intention-filter-all"
      optionTestIdPrefix="task-intention-filter"
      renderOptionAction={(option: IntentionAssignmentOption) => {
        if (isListFilterValue(option.value)) {
          const list = lists.find(
            candidate => buildListFilterValue(candidate.id) === option.value
          );
          if (!list) return null;
          const actionLabel = list.isFavorite
            ? t('intention.unfavorite')
            : t('intention.favorite');
          return (
            <button
              type="button"
              aria-label={t('task.actionFor', {
                action: actionLabel,
                title: list.title,
              })}
              title={actionLabel}
              onClick={event => {
                event.stopPropagation();
                void onToggleFavoriteList(list);
              }}
              className={clsx(
                'relative inline-flex h-7 w-7 items-center justify-center rounded text-xs transition-colors',
                list.isFavorite
                  ? 'text-amber-300 hover:bg-amber-500/10'
                  : 'text-slate-600 hover:bg-slate-800 hover:text-amber-200'
              )}
            >
              {list.isFavorite ? <FaStar /> : <FaRegStar />}
            </button>
          );
        }
        const filterOption = parentOptionsByValue.get(option.value);
        if (!filterOption) {
          return null;
        }

        const isFavorite = filterOption.intention.isFavorite;
        const actionLabel = isFavorite
          ? t('intention.unfavorite')
          : t('intention.favorite');
        const ariaLabel = `${actionLabel} ${filterOption.title}`;
        return (
          <button
            type="button"
            aria-label={ariaLabel}
            title={actionLabel}
            onClick={event => {
              event.stopPropagation();
              void onToggleFavorite(filterOption.intention);
            }}
            className={clsx(
              'group/task-favorite relative inline-flex h-7 w-7 items-center justify-center rounded text-xs transition-colors',
              isFavorite
                ? 'text-amber-300 hover:bg-amber-500/10'
                : 'text-slate-600 hover:bg-slate-800 hover:text-amber-200'
            )}
          >
            {isFavorite ? <FaStar /> : <FaRegStar />}
          </button>
        );
      }}
    />
  );
}

function buildListFilterValue(listId: string) {
  return `list:${listId}`;
}

function isListFilterValue(value: string | null): value is string {
  return value?.startsWith('list:') ?? false;
}

function parseListFilterValue(value: string) {
  return value.slice('list:'.length);
}

function buildTaskFilterPickerOptions(
  options: TaskIntentionFilterOption[]
): IntentionAssignmentOption[] {
  return options
    .filter(option => !option.subIntention)
    .map(option => ({
      value: option.value,
      title: option.title,
      emoji: option.emoji,
    }));
}

function buildTaskFilterSubIntentionsByParent(
  options: TaskIntentionFilterOption[]
): Record<string, SubIntentionAssignmentOption[]> {
  return options.reduce<Record<string, SubIntentionAssignmentOption[]>>(
    (subIntentionsByParent, option) => {
      if (!option.parent || !option.subIntention) {
        return subIntentionsByParent;
      }

      const parentValue = buildTaskIntentionFilterValue(option.parent);
      subIntentionsByParent[parentValue] = [
        ...(subIntentionsByParent[parentValue] ?? []),
        {
          slug: option.subIntention.slug,
          title: option.subIntention.title,
          emoji: option.subIntention.emoji,
        },
      ];
      return subIntentionsByParent;
    },
    {}
  );
}

function TaskArchiveModal({
  isOpen,
  tasks,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  restoringTaskId,
  onClose,
  onRestore,
  onLoadMore,
}: {
  isOpen: boolean;
  tasks: Task[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  restoringTaskId: string | null;
  onClose: () => void;
  onRestore: (task: Task) => void;
  onLoadMore: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('task.archivedTasks')}
      closeOnBackdropClick
      closeOnEscape
      className="max-h-[82vh] overflow-hidden"
    >
      <div className="max-h-[calc(82vh-7rem)] space-y-2 overflow-y-auto pr-1">
        {error && <Alert variant="error">{error}</Alert>}
        {isLoading ? (
          <div className="rounded-md border border-slate-800/70 bg-slate-950/25 px-3 py-4 text-center text-xs text-slate-500">
            {t('task.loadingArchived')}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-md border border-slate-800/70 bg-slate-950/25 px-3 py-4 text-center text-xs text-slate-500">
            {t('task.noArchived')}
          </div>
        ) : (
          <>
            {tasks.map(task => (
              <div
                key={task.id}
                data-testid="task-archive-row"
                data-task-title={task.title}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-slate-800/70 bg-slate-950/25 px-3 py-2"
              >
                <div className="min-w-0">
                  {task.followUpParent && (
                    <TaskFollowUpContext
                      parentTitle={task.followUpParent.title}
                    />
                  )}
                  <div className="truncate text-xs font-medium text-slate-200">
                    {task.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] capitalize text-slate-500">
                    <span>{t(`common.${task.status}`)}</span>
                    <span>{t(`common.${task.priority}`)}</span>
                    <TaskTimerTypeBadge timerType={task.timerType} />
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => onRestore(task)}
                  isLoading={restoringTaskId === task.id}
                  loadingText={t('common.loading')}
                  className="h-7 gap-1.5 px-2 text-[11px]"
                >
                  <FaUndo size={10} />
                  {t('common.restore')}
                </Button>
              </div>
            ))}
            {hasMore && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onLoadMore}
                isLoading={isLoadingMore}
                loadingText={t('common.loading')}
                className="w-full"
              >
                {t('task.loadMore')}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function SelectedListItems({
  list,
  intentions,
  activeItems,
  completedItems,
  archivedItems,
  completingItemIds,
  onEdit,
  onComplete,
  onArchive,
  onRestore,
  onReset,
  onUpdate,
  onConvertToTask,
}: {
  list: List;
  intentions: Intention[];
  activeItems: ListItem[];
  completedItems: ListItem[];
  archivedItems: ListItem[];
  completingItemIds: string[];
  onEdit: (item: ListItem) => void;
  onComplete: (item: ListItem) => Promise<void>;
  onArchive: (item: ListItem) => void;
  onRestore: (item: ListItem) => Promise<void>;
  onReset: () => void;
  onUpdate: (
    item: ListItem,
    updates: {
      dueDate?: string | null;
      priority?: ListItem['priority'];
    }
  ) => Promise<void>;
  onConvertToTask: (
    itemId: string,
    intentionSlug: string,
    subIntentionSlug: string | null
  ) => Promise<boolean>;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4" data-testid="selected-list-items">
      <div>
        {activeItems.length > 0 && (
          <div className="relative overflow-visible rounded-xl border border-slate-800/75 bg-slate-900/30 shadow-sm shadow-black/15">
            {activeItems.map(item => (
              <div
                key={item.id}
                className="border-b border-slate-800/65 last:border-b-0"
              >
                <ListItemTaskRow
                  item={item}
                  list={list}
                  intentions={intentions}
                  isCompleting={completingItemIds.includes(item.id)}
                  onEdit={onEdit}
                  onComplete={onComplete}
                  onArchive={onArchive}
                  onUpdate={onUpdate}
                  onConvertToTask={onConvertToTask}
                />
              </div>
            ))}
          </div>
        )}
        {activeItems.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700/70 px-5 py-8 text-center text-sm text-slate-500">
            {t('task.noActiveItemsInList', { title: list.title })}
          </div>
        )}
      </div>

      {completedItems.length > 0 && (
        <section className="border-t border-slate-800/70 pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              {t('task.completedCount', { count: completedItems.length })}
            </h3>
            <Button size="xs" variant="secondary" onClick={onReset}>
              <FaUndo size={9} /> {t('task.resetListAction')}
            </Button>
          </div>
          <div className="space-y-2">
            {completedItems.map(item => (
              <ListItemTaskRow
                key={item.id}
                item={item}
                list={list}
                intentions={intentions}
                onEdit={onEdit}
                onComplete={onComplete}
                onArchive={onArchive}
                onRestore={onRestore}
                onUpdate={onUpdate}
                onConvertToTask={onConvertToTask}
              />
            ))}
          </div>
        </section>
      )}

      {archivedItems.length > 0 && (
        <section className="border-t border-slate-800/70 pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            {t('task.archivedCount', { count: archivedItems.length })}
          </h3>
          <div className="space-y-2">
            {archivedItems.map(item => (
              <ListItemTaskRow
                key={item.id}
                item={item}
                list={list}
                intentions={intentions}
                onEdit={onEdit}
                onComplete={onComplete}
                onArchive={onArchive}
                onRestore={onRestore}
                onUpdate={onUpdate}
                onConvertToTask={onConvertToTask}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ListItemTaskRow({
  item,
  list,
  intentions,
  isCompleting,
  onEdit,
  onComplete,
  onArchive,
  onRestore,
  onUpdate,
  onConvertToTask,
}: {
  item: ListItem;
  list: List;
  intentions: Intention[];
  isCompleting?: boolean;
  onEdit: (item: ListItem) => void;
  onComplete: (item: ListItem) => Promise<void>;
  onArchive: (item: ListItem) => void;
  onRestore?: (item: ListItem) => Promise<void>;
  onUpdate: (
    item: ListItem,
    updates: {
      dueDate?: string | null;
      priority?: ListItem['priority'];
    }
  ) => Promise<void>;
  onConvertToTask: (
    itemId: string,
    intentionSlug: string,
    subIntentionSlug: string | null
  ) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const isActive = item.status === TASK_STATUSES.ACTIVE;
  const isCompleted = item.status === TASK_STATUSES.COMPLETED;
  const isCompletionPending = isCompleting === true;
  const row = (
    <div
      data-testid="list-item-row"
      data-list-item-id={item.id}
      data-completing={isCompletionPending}
      className={clsx(
        'group/task-row relative transition-all duration-200 hover:bg-slate-800/25',
        (isCompleted || isCompletionPending) && 'opacity-50'
      )}
    >
      <div
        aria-hidden="true"
        className={clsx(
          'absolute inset-y-2 left-0 w-0.5 rounded-r-full',
          getTaskPriorityAccentClass(item.priority)
        )}
      />
      <div className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2 pl-3 pr-2.5">
        <CompletionButton
          label={item.title}
          isCompleted={!isActive}
          isCompleting={isCompletionPending}
          disabled={isCompletionPending}
          onClick={() => void (isActive ? onComplete(item) : onRestore?.(item))}
        />
        <div className="min-w-0">
          <p
            className={clsx(
              'truncate text-[13px] font-semibold text-slate-100',
              (isCompleted || isCompletionPending) &&
                'text-slate-500 line-through'
            )}
          >
            {item.title}
          </p>
          <div className="mt-1">
            <TaskInlineProperties
              task={item}
              intentions={intentions}
              currentList={list}
              onUpdate={async update => {
                try {
                  await onUpdate(item, {
                    ...(update.dueDate !== undefined
                      ? { dueDate: update.dueDate }
                      : {}),
                    ...(update.priority !== undefined
                      ? { priority: update.priority }
                      : {}),
                  });
                  return true;
                } catch {
                  return false;
                }
              }}
              onConvertListItemToTask={onConvertToTask}
              onOpenEditor={() => onEdit(item)}
              showIntention
              compact={false}
              isOverdue={isTaskOverdue({
                dueDate: item.dueDate,
                dueTime: null,
              })}
            />
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-80 transition-opacity group-hover/task-row:opacity-100 group-focus-within/task-row:opacity-100">
          <IconButton
            label={t('task.editFor', { title: item.title })}
            title={t('common.edit')}
            size="sm"
            variant="secondary"
            onClick={() => onEdit(item)}
            className="!rounded-full"
          >
            <FaEdit />
          </IconButton>
        </div>
      </div>
    </div>
  );
  return isMobile && isActive ? (
    <MobileSwipeActionRow
      disabled={false}
      onComplete={() => onComplete(item)}
      onArchive={() => onArchive(item)}
    >
      {row}
    </MobileSwipeActionRow>
  ) : (
    row
  );
}

function ListItemEditModal({
  item,
  onClose,
  onArchive,
  onSave,
}: {
  item: ListItem | null;
  onClose: () => void;
  onArchive: (item: ListItem) => void;
  onSave: (
    item: ListItem,
    updates: {
      title: string;
      dueDate: string | null;
      priority: ListItem['priority'];
      vacationEligible: boolean;
    }
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<ListItem['priority']>('normal');
  const [vacationEligible, setVacationEligible] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTitle(item?.title ?? '');
    setDueDate(item?.dueDate ?? '');
    setPriority(item?.priority ?? 'normal');
    setVacationEligible(item?.vacationEligible ?? false);
  }, [item]);
  return (
    <Modal
      isOpen={item !== null}
      onClose={onClose}
      title={t('task.editListItem')}
      headerActions={
        item?.status === TASK_STATUSES.ACTIVE ? (
          <button
            type="button"
            aria-label={t('task.archiveFor', { title: item.title })}
            title={t('common.archive')}
            onClick={() => onArchive(item)}
            disabled={saving}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
          >
            <FaArchive size={13} />
          </button>
        ) : null
      }
      closeOnBackdropClick={true}
      closeOnEscape={true}
      className="max-h-[88dvh] overflow-hidden"
    >
      <form
        className="flex min-h-0 max-h-[calc(88dvh-7rem)] flex-col overflow-hidden"
        onSubmit={event => {
          event.preventDefault();
          if (!item || !title.trim()) return;
          setSaving(true);
          void onSave(item, {
            title: title.trim(),
            dueDate: dueDate || null,
            priority,
            vacationEligible,
          }).finally(() => setSaving(false));
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3 pr-1">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-400">
              {t('common.title')}
            </span>
            <input
              autoFocus
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-ink outline-none focus:border-indigo-500"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-400">
                {t('task.priority')}
              </span>
              <select
                value={priority}
                onChange={event =>
                  setPriority(event.target.value as ListItem['priority'])
                }
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-ink"
              >
                <option value="low">{t('common.low')}</option>
                <option value="normal">{t('common.normal')}</option>
                <option value="high">{t('common.high')}</option>
                <option value="urgent">{t('common.urgent')}</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-400">
                {t('common.dueDate')}
              </span>
              <input
                type="date"
                value={dueDate}
                onChange={event => setDueDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-ink"
              />
            </label>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-950/35 px-3 py-2.5 text-xs text-slate-300">
            <span>
              <span className="block font-medium text-slate-200">
                {t('task.vacationCoverage')}
              </span>
              <span className="mt-0.5 block text-[10px] text-slate-500">
                {t('task.vacationCoverageDescription')}
              </span>
            </span>
            <input
              type="checkbox"
              aria-label={t('task.vacationCoverage')}
              checked={vacationEligible}
              onChange={event => setVacationEligible(event.target.checked)}
              className="h-4 w-4 accent-indigo-500"
            />
          </label>
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-slate-800 bg-slate-900/95 pt-3 backdrop-blur-sm">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={saving || !title.trim()}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MixedTaskList({
  entries,
  completingTaskIds,
  completingListItemIds,
  intentions,
  lists,
  onEdit,
  onEditListItem,
  onCompleteListItem,
  onArchiveListItem,
  onUpdateListItem,
  onConvertListItemToTask,
  onOpenDescription,
  onUpdate,
  onConvertToListItem,
  showTypeBadge,
  highlightedTaskId,
}: {
  entries: MixedTaskItem[];
  completingTaskIds: string[];
  completingListItemIds: string[];
  intentions: Intention[];
  lists: List[];
  onEdit: (task: Task) => void;
  onEditListItem: (item: ListItem) => void;
  onCompleteListItem: (item: ListItem) => Promise<void>;
  onArchiveListItem: (item: ListItem) => void;
  onUpdateListItem: (
    item: ListItem,
    updates: {
      dueDate?: string | null;
      priority?: ListItem['priority'];
    }
  ) => Promise<void>;
  onConvertListItemToTask: (
    itemId: string,
    intentionSlug: string,
    subIntentionSlug: string | null
  ) => Promise<boolean>;
  onOpenDescription: (task: Task) => void;
  onUpdate: (task: {
    id: string;
    status?: TaskStatus;
    pinned?: boolean;
    dueDate?: string | null;
    dueTime?: string | null;
    priority?: Task['priority'];
    intentionSlug?: string | null;
    subIntentionSlug?: string | null;
    recurrenceRule?: string | null;
    recurrenceInterval?: number | null;
    recurrenceAnchorMode?: Task['recurrenceAnchorMode'];
  }) => Promise<boolean>;
  onConvertToListItem: (
    taskId: string,
    listId: string,
    item: {
      title: string;
      dueDate: string | null;
      priority: ListItem['priority'];
      vacationEligible: boolean;
    }
  ) => Promise<boolean>;
  showTypeBadge: boolean;
  highlightedTaskId: string | null;
}) {
  return (
    <section
      data-testid="task-list"
      className="relative overflow-visible rounded-xl border border-slate-800/75 bg-slate-900/30 shadow-sm shadow-black/15"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {entries.map(entry => {
          if (entry.kind === 'listItem') {
            const isCompleting = completingListItemIds.includes(entry.item.id);
            return (
              <motion.div
                key={`list-item:${entry.item.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: isCompleting ? 0.5 : 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.07 }}
                className="border-b border-slate-800/65 last:border-b-0"
              >
                <ListItemTaskRow
                  item={entry.item}
                  list={entry.list}
                  intentions={intentions}
                  isCompleting={isCompleting}
                  onEdit={onEditListItem}
                  onComplete={onCompleteListItem}
                  onArchive={onArchiveListItem}
                  onUpdate={onUpdateListItem}
                  onConvertToTask={onConvertListItemToTask}
                />
              </motion.div>
            );
          }
          const task = entry.task;
          const isCompleting = completingTaskIds.includes(task.id);
          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0 }}
              animate={
                task.status === TASK_STATUSES.COMPLETED || isCompleting
                  ? { opacity: 0.5 }
                  : { opacity: 1 }
              }
              exit={{ opacity: 0 }}
              transition={{ duration: 0.07 }}
              className="border-b border-slate-800/65 last:border-b-0"
            >
              <TaskRow
                task={task}
                isCompleting={isCompleting}
                intentions={intentions}
                lists={lists}
                onEdit={onEdit}
                onOpenDescription={onOpenDescription}
                onUpdate={onUpdate}
                onConvertToListItem={onConvertToListItem}
                showTypeBadge={showTypeBadge}
                isHighlighted={highlightedTaskId === task.id}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </section>
  );
}

function TaskRow({
  task,
  isCompleting,
  intentions,
  lists,
  onEdit,
  onOpenDescription,
  onUpdate,
  onConvertToListItem,
  showTypeBadge,
  isHighlighted,
}: {
  task: Task;
  isCompleting: boolean;
  intentions: Intention[];
  lists: List[];
  onEdit: (task: Task) => void;
  onOpenDescription: (task: Task) => void;
  onUpdate: (task: {
    id: string;
    status?: TaskStatus;
    pinned?: boolean;
    dueDate?: string | null;
    dueTime?: string | null;
    priority?: Task['priority'];
    intentionSlug?: string | null;
    subIntentionSlug?: string | null;
    recurrenceRule?: string | null;
    recurrenceInterval?: number | null;
    recurrenceAnchorMode?: Task['recurrenceAnchorMode'];
  }) => Promise<boolean>;
  onConvertToListItem: (
    taskId: string,
    listId: string,
    item: {
      title: string;
      dueDate: string | null;
      priority: ListItem['priority'];
      vacationEligible: boolean;
    }
  ) => Promise<boolean>;
  showTypeBadge: boolean;
  isHighlighted: boolean;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const isPinned = task.pinnedAt !== null;
  const isOverdue = isTaskOverdue(task);
  const isCompleted = task.status === TASK_STATUSES.COMPLETED || isCompleting;
  const updateStatus = async (status: TaskStatus) => {
    if (status === TASK_STATUSES.COMPLETED) {
      return onUpdate({ id: task.id, status });
    }
    setSaving(true);
    try {
      return await onUpdate({ id: task.id, status });
    } finally {
      setSaving(false);
    }
  };
  const updatePinned = async () => {
    setSaving(true);
    try {
      return await onUpdate({ id: task.id, pinned: !isPinned });
    } finally {
      setSaving(false);
    }
  };

  const row = (
    <div
      data-testid="task-row"
      data-task-id={task.id}
      data-task-title={task.title}
      data-pinned={isPinned}
      data-overdue={isOverdue}
      data-completing={isCompleting}
      tabIndex={-1}
      className={clsx(
        'group/task-row relative transition-all duration-200',
        isPinned &&
          'bg-indigo-950/30 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.24)]',
        !isPinned && !isOverdue && 'bg-transparent hover:bg-slate-800/25',
        task.followUpParent && 'ml-4 border-l-2 border-indigo-500/40',
        isCompleted && 'opacity-50',
        isHighlighted &&
          'ring-2 ring-inset ring-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.18)]'
      )}
    >
      <div
        aria-hidden="true"
        className={clsx(
          'absolute inset-y-2 left-0 w-0.5 rounded-r-full',
          getTaskPriorityAccentClass(task.priority)
        )}
      />
      <div
        className={clsx(
          'grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2 pr-2.5',
          'pl-3'
        )}
      >
        <CompletionButton
          label={task.title}
          isCompleted={task.status === TASK_STATUSES.COMPLETED}
          isCompleting={isCompleting}
          disabled={saving || isCompleting}
          onClick={() =>
            void updateStatus(
              isCompleted ? TASK_STATUSES.ACTIVE : TASK_STATUSES.COMPLETED
            )
          }
        />
        <div data-testid="task-row-content" className="min-w-0">
          {task.followUpParent && (
            <div className="mb-0.5">
              <TaskFollowUpContext parentTitle={task.followUpParent.title} />
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2">
            {isPinned && (
              <FaThumbtack
                aria-hidden="true"
                className="shrink-0 text-xs text-indigo-200"
              />
            )}
            <OverflowTaskTitle
              title={task.title}
              maxLines={2}
              className={clsx(
                'text-[13px] font-semibold text-slate-100',
                isCompleted && 'line-through'
              )}
            />
            <TaskDescriptionButton task={task} onOpen={onOpenDescription} />
            {showTypeBadge && <TaskTimerTypeBadge timerType={task.timerType} />}
          </div>
          <div className="mt-1">
            <TaskInlineProperties
              task={task}
              intentions={intentions}
              lists={lists}
              onUpdate={onUpdate}
              onConvertToListItem={onConvertToListItem}
              onOpenEditor={() => onEdit(task)}
              showIntention
              compact={false}
              isOverdue={isOverdue}
            />
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-80 transition-opacity group-hover/task-row:opacity-100 group-focus-within/task-row:opacity-100">
          {!task.followUpParent && (
            <IconButton
              label={t(isPinned ? 'task.unpinFor' : 'task.pinFor', {
                title: task.title,
              })}
              title={t(isPinned ? 'task.unpin' : 'task.pin')}
              size="sm"
              variant={isPinned ? 'primary' : 'secondary'}
              onClick={() => void updatePinned()}
              disabled={saving}
              className="!rounded-full"
            >
              <FaThumbtack />
            </IconButton>
          )}
          <IconButton
            label={t('task.editFor', { title: task.title })}
            title={t('common.edit')}
            size="sm"
            variant="secondary"
            onClick={() => onEdit(task)}
            disabled={saving}
            className="!rounded-full"
          >
            <FaEdit />
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isMobile ? (
        <MobileSwipeActionRow
          disabled={saving || isCompleting}
          onComplete={
            isCompleted
              ? undefined
              : () => void updateStatus(TASK_STATUSES.COMPLETED)
          }
          onArchive={() => setShowArchiveConfirm(true)}
        >
          {row}
        </MobileSwipeActionRow>
      ) : (
        row
      )}
      <TaskArchiveConfirmationModal
        task={showArchiveConfirm ? task : null}
        isSaving={saving}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={() => {
          void updateStatus(TASK_STATUSES.ARCHIVED).then(didArchive => {
            if (didArchive) setShowArchiveConfirm(false);
          });
        }}
      />
    </>
  );
}

function sortTasksForMode(tasks: Task[], mode: TaskSortMode) {
  if (mode === 'default') {
    return tasks;
  }

  return [...tasks].sort((a, b) => {
    const createdCompare =
      mode === 'created-desc'
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt);
    return createdCompare || a.id.localeCompare(b.id);
  });
}

function rankTasksForSearch(
  tasks: Task[],
  selectedIntention: TaskIntentionFilterOption | null,
  hasSearch: boolean
) {
  if (!hasSearch) {
    return tasks;
  }
  return [...tasks].sort((a, b) => {
    const intentionRank = (task: Task) =>
      selectedIntention && doesTaskMatchIntentionFilter(task, selectedIntention)
        ? 0
        : 1;
    return (
      intentionRank(a) - intentionRank(b) ||
      Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) ||
      (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? '')
    );
  });
}

function buildTaskIntentionFilterOptions(
  intentions: Intention[]
): TaskIntentionFilterOption[] {
  const activeIntentions = intentions.filter(
    intention => !intention.isArchived
  );
  const topLevelIntentions = activeIntentions.filter(
    intention => !intention.parentIntentionId
  );
  const subIntentionsByParentId = activeIntentions
    .filter(intention => intention.parentIntentionId)
    .reduce((subIntentionsByParent, intention) => {
      const parentId = intention.parentIntentionId;
      if (!parentId) {
        return subIntentionsByParent;
      }

      subIntentionsByParent.set(parentId, [
        ...(subIntentionsByParent.get(parentId) ?? []),
        intention,
      ]);
      return subIntentionsByParent;
    }, new Map<string, Intention[]>());

  return topLevelIntentions.flatMap(parent => [
    {
      value: buildTaskIntentionFilterValue(parent),
      title: parent.title,
      emoji: parent.emoji,
      intention: parent,
      parent: null,
      subIntention: null,
    },
    ...(subIntentionsByParentId.get(parent.id) ?? []).map(subIntention => ({
      value: buildTaskIntentionFilterValue(parent, subIntention),
      title: subIntention.title,
      emoji: subIntention.emoji,
      intention: subIntention,
      parent,
      subIntention,
    })),
  ]);
}

function buildTaskIntentionFilterValue(parent: Intention, sub?: Intention) {
  return `${parent.type}:${parent.slug}${sub ? `::${sub.slug}` : ''}`;
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function doesTaskMatchIntentionFilter(
  task: Task,
  option: TaskIntentionFilterOption | null
) {
  if (!option) {
    return true;
  }
  if (task.timerType !== option.intention.type) {
    return false;
  }

  const parentSlug = option.parent?.slug ?? option.intention.slug;
  if (task.intentionSlug !== parentSlug) {
    return false;
  }

  if (!option.subIntention) {
    return true;
  }

  return task.subIntentionSlug === option.subIntention.slug;
}

function doesTaskMatchSearch(
  task: Task,
  query: string,
  intentions: Intention[]
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const parentIntention = intentions.find(
    intention =>
      intention.type === task.timerType &&
      !intention.parentIntentionId &&
      intention.slug === task.intentionSlug
  );
  const subIntention = intentions.find(
    intention =>
      intention.type === task.timerType &&
      intention.parentIntentionId &&
      intention.slug === task.subIntentionSlug
  );
  const candidates = [
    task.title,
    task.description ?? '',
    task.priority,
    task.dueDate ?? '',
    task.dueTime ?? '',
    parentIntention?.title ?? '',
    parentIntention?.emoji ?? '',
    subIntention?.title ?? '',
    subIntention?.emoji ?? '',
  ];

  return candidates.some(candidate =>
    candidate.toLocaleLowerCase().includes(normalizedQuery)
  );
}
