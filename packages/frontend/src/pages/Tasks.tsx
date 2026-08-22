import {
  Intention,
  List,
  ListItem,
  Task,
  type TaskPageViewMode,
  type TaskSortMode,
  TaskStatus,
  TimerTypes,
} from '@pomi/shared';
import {
  TASK_MANUAL_ORDER_BOTTOM,
  TASK_STATUSES,
  TIMER_TYPES,
} from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import {
  FaArchive,
  FaCalendarAlt,
  FaCheck,
  FaEdit,
  FaFileImport,
  FaFilter,
  FaGripVertical,
  FaListUl,
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
import { BackButton } from '../components/BackButton';
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
import { TaskTimerTypeBadge } from '../components/tasks/TaskTimerTypeBadge';
import { TaskImportModal } from '../components/tasks/TaskImportModal';
import { TaskQuickCreateRow } from '../components/tasks/TaskQuickCreateRow';
import { OverflowTaskTitle } from '../components/tasks/OverflowTaskTitle';
import { TaskInlineProperties } from '../components/tasks/TaskInlineProperties';
import { TaskCalendarNavigator } from '../components/tasks/TaskCalendarNavigator';
import { TaskArchiveConfirmationModal } from '../components/tasks/TaskArchiveConfirmationModal';
import { CompletionButton } from '../components/tasks/CompletionButton';
import { MobileSwipeActionRow } from '../components/tasks/MobileSwipeActionRow';
import { FavoriteIntentionFilters } from '../components/tasks/FavoriteIntentionFilters';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { KeyboardShortcut } from '../components/ui/KeyboardShortcut';
import { Modal } from '../components/ui/Modal';
import { PageContainer } from '../components/ui/PageContainer';
import { PageShell } from '../components/ui/PageShell';
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
} from '../utils/taskUi';
import {
  applyIntentionFamilyManualOrder,
  buildTaskView,
  type TaskOrderingClock,
} from '../utils/taskView';
import { showToastFromStore } from '../components/toast/ToastContext';
import { VacationControl } from '../components/vacation/VacationControl';
import { isMobile } from '../utils/osUtils';
import {
  requestListRefresh,
  subscribeToListRefresh,
} from '../utils/listRefresh';
import {
  mixTaskAndListItems,
  type MixedTaskItem,
} from '../utils/mixedTaskItems';
import { useI18n } from '../i18n';
import { useDefaultTaskSort } from './taskDefaultSort';
import { useDefaultTaskView } from './taskDefaultView';
import { shouldHideVacationCoveredTasks } from '../utils/vacationVisibility';
import { isTaskInTimerTypeSearchScope } from '../utils/taskSearchScope';
import {
  filterCalendarEntries,
  getTodayDateKey,
  type TaskCalendarScale,
} from '../utils/taskCalendar';

type TaskIntentionFilterValue = string | null;
type TaskDropPlacement = 'before' | 'after';
type TaskTimerTypeFilter = 'all' | TimerTypes;
type TaskIntentionFilterOption = {
  value: string;
  title: string;
  emoji: string;
  intention: Intention;
  parent: Intention | null;
  subIntention: Intention | null;
};

export function Tasks() {
  const { t } = useI18n();
  const tasks = useTasksStore.use.tasks();
  const completingTaskIds = useTasksStore.use.completingTaskIds();
  const isLoading = useTasksStore.use.isLoading();
  const error = useTasksStore.use.error();
  const loadTasks = useTasksStore.use.loadTasks();
  const createTask = useTasksStore.use.createTask();
  const updateTask = useTasksStore.use.updateTask();
  const reorderTasks = useTasksStore.use.reorderTasks();
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
  const taskCreateRequested = useUiStore.use.taskCreateRequested();
  const taskCreateInitialTitle = useUiStore.use.taskCreateInitialTitle();
  const clearTaskCreateRequest = useUiStore.use.clearTaskCreateRequest();
  const intentionPickerOpenRequest =
    useUiStore.use.intentionPickerOpenRequest();
  const taskSearchFocusRequest = useUiStore.use.taskSearchFocusRequest();
  const taskQuickCreateFocusRequest =
    useUiStore.use.taskQuickCreateFocusRequest();
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListEmoji, setNewListEmoji] = useState('');
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListItemTitle, setNewListItemTitle] = useState('');
  const [isSavingListItem, setIsSavingListItem] = useState(false);
  const [editingListItem, setEditingListItem] = useState<ListItem | null>(null);
  const [completingListItemIds, setCompletingListItemIds] = useState<string[]>(
    []
  );
  const [archivingListItem, setArchivingListItem] = useState<ListItem | null>(
    null
  );
  const [isResetListOpen, setIsResetListOpen] = useState(false);
  const [intentionsLoaded, setIntentionsLoaded] = useState(false);
  const [reserveFavoriteRow, setReserveFavoriteRow] = useState(() =>
    readFavoriteRowMemory(null)
  );
  const [intentionsError, setIntentionsError] = useState<string | null>(null);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [selectedIntentionFilter, setSelectedIntentionFilter] =
    useState<TaskIntentionFilterValue>(null);
  const [timerTypeFilter, setTimerTypeFilter] =
    useState<TaskTimerTypeFilter>('all');
  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false);
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
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [restoringTaskId, setRestoringTaskId] = useState<string | null>(null);
  const [descriptionTask, setDescriptionTask] = useState<Task | null>(null);
  const [taskSortMode, setTaskSortMode] = useState<TaskSortMode>('default');
  const [taskPageViewMode, setTaskPageViewMode] =
    useState<TaskPageViewMode>('list');
  const [taskCalendarScale, setTaskCalendarScale] =
    useState<TaskCalendarScale>('month');
  const [taskCalendarAnchor, setTaskCalendarAnchor] = useState(getTodayDateKey);
  const [taskCalendarDate, setTaskCalendarDate] = useState<string | null>(
    getTodayDateKey
  );
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
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

  useDefaultTaskView({
    userId: user?.id,
    configuredMode: preferences?.taskDefaultViewMode,
    preferencesLoaded: preferences !== null,
    onApply: setTaskPageViewMode,
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
        const hasFavorites = activeIntentions.some(
          intention => intention.isFavorite
        );
        setReserveFavoriteRow(hasFavorites);
        writeFavoriteRowMemory(user?.id ?? null, hasFavorites);
        setIntentionsLoaded(true);
        setIntentionsError(null);
        return;
      }
      setIntentionsLoaded(true);
      setIntentionsError(t('intention.loadFailed'));
    };

    void loadIntentions();
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
    setReserveFavoriteRow(readFavoriteRowMemory(user?.id ?? null));
  }, [user?.id]);

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
    const availableIntentions =
      timerTypeFilter === 'all'
        ? intentions
        : intentions.filter(intention => intention.type === timerTypeFilter);
    return buildTaskIntentionFilterOptions(availableIntentions);
  }, [intentions, timerTypeFilter]);
  const selectedFilterOption = useMemo(
    () =>
      selectedIntentionFilter
        ? (filterOptions.find(
            option => option.value === selectedIntentionFilter
          ) ?? null)
        : null,
    [filterOptions, selectedIntentionFilter]
  );
  const favoriteFilterOptions = useMemo(
    () => [
      ...filterOptions
        .filter(option => option.intention.isFavorite)
        .map(option => ({
          value: option.value,
          title: option.title,
          emoji: getFilterOptionEmojiText(option),
        })),
      ...lists
        .filter(list => list.isFavorite)
        .map(list => ({
          value: buildListFilterValue(list.id),
          title: list.title,
          emoji: list.emoji ?? '📋',
        })),
    ],
    [filterOptions, lists]
  );
  const taskFormDefaultIntention = useMemo(() => {
    if (!selectedFilterOption) {
      return null;
    }

    return {
      intentionSlug:
        selectedFilterOption.parent?.slug ??
        selectedFilterOption.intention.slug,
      subIntentionSlug: selectedFilterOption.subIntention?.slug ?? null,
    };
  }, [selectedFilterOption]);
  const taskFormDefaultTimerType =
    selectedFilterOption?.intention.type ??
    (timerTypeFilter === 'all' ? TIMER_TYPES.WORK : timerTypeFilter);

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
          const hasFavorites = next.some(item => item.isFavorite);
          setReserveFavoriteRow(hasFavorites);
          writeFavoriteRowMemory(user?.id ?? null, hasFavorites);
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

  const createList = useCallback(async () => {
    const title = newListTitle.trim();
    if (!title || isCreatingList) return;
    setIsCreatingList(true);
    try {
      const result = await submitUserMutation({
        kind: 'lists',
        label: t('task.createList'),
        payload: {
          operation: 'create',
          title,
          emoji: newListEmoji.trim() || null,
        },
        reconcile: loadLists,
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: List })
          : { status: 201, body: result as List };
      if (response.status === 201 && response.body.id) {
        setNewListTitle('');
        setNewListEmoji('');
        setIsCreateListOpen(false);
        setSelectedIntentionFilter(null);
        setSelectedListId(response.body.id);
        await loadLists();
        requestListRefresh();
      }
    } finally {
      setIsCreatingList(false);
    }
  }, [isCreatingList, loadLists, newListEmoji, newListTitle, t]);

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
  }, [hideVacationCovered, selectedListItems, taskSearchQuery, taskSortMode]);
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

  const createListItem = useCallback(async () => {
    if (!selectedList || !newListItemTitle.trim() || isSavingListItem) return;
    setIsSavingListItem(true);
    try {
      await submitUserMutation({
        kind: 'lists',
        label: t('task.addToList', { title: selectedList.title }),
        payload: {
          operation: 'createItem',
          listId: selectedList.id,
          title: newListItemTitle.trim(),
        },
        reconcile: loadLists,
      });
      setNewListItemTitle('');
      await loadLists();
    } finally {
      setIsSavingListItem(false);
    }
  }, [isSavingListItem, loadLists, newListItemTitle, selectedList, t]);

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

  const loadTaskArchive = useCallback(async () => {
    setIsArchiveLoading(true);
    try {
      const [archivedResponse, completedResponse] = await Promise.all([
        apiClient.tasks.list({ query: { status: TASK_STATUSES.ARCHIVED } }),
        apiClient.tasks.list({ query: { status: TASK_STATUSES.COMPLETED } }),
      ]);

      if (archivedResponse.status !== 200 || completedResponse.status !== 200) {
        setArchiveError(t('task.archiveLoadFailed'));
        return;
      }

      setArchivedTasks(
        [...archivedResponse.body, ...completedResponse.body].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
      );
      setArchiveError(null);
    } finally {
      setIsArchiveLoading(false);
    }
  }, [t]);

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
      return didUpdate;
    },
    [
      createOrResumeTimer,
      preferences,
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
      .filter(task =>
        isTaskInTimerTypeSearchScope(
          task.timerType,
          timerTypeFilter,
          isTaskSearchActive
        )
      )
      .filter(task =>
        isTaskSearchActive
          ? true
          : doesTaskMatchIntentionFilter(task, selectedFilterOption)
      )
      .filter(task => doesTaskMatchSearch(task, taskSearchQuery, intentions));
    const sorted = sortTasksForMode(filteredTasks, taskSortMode);
    const ranked = rankTasksForSearch(
      sorted,
      selectedFilterOption,
      isTaskSearchActive
    );
    const intentionOrdered =
      selectedFilterOption && taskSortMode === 'default' && !isTaskSearchActive
        ? applyIntentionFamilyManualOrder(ranked)
        : ranked;
    return intentionOrdered;
  }, [
    intentions,
    isTaskSearchActive,
    selectedFilterOption,
    taskSortMode,
    taskSearchQuery,
    taskView.tasks,
    timerTypeFilter,
  ]);
  const eligibleMixedListItems = useMemo(() => {
    const query = normalizeSearchText(taskSearchQuery);
    if (
      selectedList !== null ||
      preferences?.listsExtension !== true ||
      (!query &&
        (selectedFilterOption !== null ||
          (timerTypeFilter !== 'all' && timerTypeFilter !== TIMER_TYPES.WORK)))
    ) {
      return [];
    }

    const listsById = new Map(lists.map(list => [list.id, list]));
    return listItems
      .filter(item => item.status === TASK_STATUSES.ACTIVE)
      .filter(item => !hideVacationCovered || !item.vacationEligible)
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
    selectedFilterOption,
    selectedList,
    taskSearchQuery,
    timerTypeFilter,
  ]);
  const mixedTaskItems = useMemo<MixedTaskItem[]>(
    () =>
      mixTaskAndListItems(visibleTasks, eligibleMixedListItems, taskSortMode),
    [eligibleMixedListItems, taskSortMode, visibleTasks]
  );
  const displayedTaskItems = useMemo(
    () =>
      taskPageViewMode === 'calendar' && selectedList === null
        ? filterCalendarEntries(mixedTaskItems, taskCalendarDate)
        : mixedTaskItems,
    [mixedTaskItems, selectedList, taskCalendarDate, taskPageViewMode]
  );
  const orderedIntentionFamilyTasks = useMemo(() => {
    if (!selectedFilterOption) return [];
    const parentSlug =
      selectedFilterOption.parent?.slug ?? selectedFilterOption.intention.slug;
    const familyTasks = getAutomaticUnpinnedTasks(
      tasks.filter(
        task =>
          task.status === TASK_STATUSES.ACTIVE &&
          task.pinnedAt === null &&
          task.timerType === selectedFilterOption.intention.type &&
          task.intentionSlug === parentSlug
      ),
      orderingClock
    );
    return applyIntentionFamilyManualOrder(familyTasks);
  }, [orderingClock, selectedFilterOption, tasks]);

  useLayoutEffect(() => {
    if (!pinnedTaskDestinationId) return;
    const destination = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')
    ).find(row => row.dataset.taskId === pinnedTaskDestinationId);
    if (!destination) return;
    destination.scrollIntoView({ behavior: 'auto', block: 'center' });
    destination.focus({ preventScroll: true });
    setPinnedTaskDestinationId(null);
  }, [displayedTaskItems, pinnedTaskDestinationId]);
  const hasActiveFilters =
    taskSearchQuery.trim().length > 0 ||
    selectedFilterOption !== null ||
    selectedList !== null ||
    timerTypeFilter !== 'all';
  const taskCountLabel = selectedList
    ? taskSearchQuery.trim()
      ? `${activeListItems.length} of ${visibleActiveSelectedListItemCount}`
      : `${activeListItems.length}`
    : taskPageViewMode === 'calendar'
      ? `${displayedTaskItems.length} of ${mixedTaskItems.length}`
      : hasActiveFilters
        ? `${mixedTaskItems.length} of ${
            taskView.tasks.length +
            (selectedFilterOption === null &&
            preferences?.listsExtension === true &&
            (isTaskSearchActive ||
              timerTypeFilter === 'all' ||
              timerTypeFilter === TIMER_TYPES.WORK)
              ? listItems.filter(
                  item =>
                    item.status === TASK_STATUSES.ACTIVE &&
                    (!hideVacationCovered || !item.vacationEligible)
                ).length
              : 0)
          }`
        : `${mixedTaskItems.length}`;
  const showImportAction = hasImportedTasks === false;
  const hideTasksTitle =
    showImportAction &&
    preferences?.vacationExtension === true &&
    preferences?.listsExtension === true;

  const reorderVisibleTasks = useCallback(
    async (
      draggedTaskId: string,
      targetTaskId: string,
      placement: TaskDropPlacement
    ) => {
      if (!selectedFilterOption) {
        return false;
      }
      const visibleFamilyTasks = orderedIntentionFamilyTasks.filter(
        task =>
          doesTaskMatchIntentionFilter(task, selectedFilterOption) &&
          (!hideVacationCovered || !task.vacationEligible)
      );
      const reorderedVisibleTasks = moveTaskInList(
        visibleFamilyTasks,
        draggedTaskId,
        targetTaskId,
        placement
      );
      if (!reorderedVisibleTasks) {
        return false;
      }

      let visibleIndex = 0;
      const reorderedFamilyTasks = orderedIntentionFamilyTasks.map(task => {
        const isVisibleFamilyTask =
          doesTaskMatchIntentionFilter(task, selectedFilterOption) &&
          (!hideVacationCovered || !task.vacationEligible);
        return isVisibleFamilyTask
          ? reorderedVisibleTasks[visibleIndex++]!
          : task;
      });
      const naturalDraggedIndex = getAutomaticUnpinnedTasks(
        reorderedFamilyTasks,
        orderingClock
      ).findIndex(task => task.id === draggedTaskId);
      const droppedIndex = reorderedFamilyTasks.findIndex(
        task => task.id === draggedTaskId
      );
      const draggedUsesManualOrder = droppedIndex !== naturalDraggedIndex;

      return reorderTasks(
        reorderedFamilyTasks.map((task, index) => {
          const manualOrderOverride =
            task.id === draggedTaskId
              ? draggedUsesManualOrder
              : task.manualOrderOverride;
          const keepsBottomAnchor =
            index === reorderedFamilyTasks.length - 1 &&
            manualOrderOverride &&
            (task.id === draggedTaskId
              ? draggedUsesManualOrder
              : task.manualOrder === TASK_MANUAL_ORDER_BOTTOM);
          return {
            id: task.id,
            manualOrder: keepsBottomAnchor ? TASK_MANUAL_ORDER_BOTTOM : index,
            manualOrderOverride,
          };
        })
      );
    },
    [
      orderedIntentionFamilyTasks,
      hideVacationCovered,
      orderingClock,
      reorderTasks,
      selectedFilterOption,
    ]
  );

  return (
    <PageShell className="overflow-x-clip">
      <PageContainer className="relative min-w-0 overflow-x-clip pb-24 md:pb-8">
        <header className="sticky top-0 z-30 -mx-4 border-b border-slate-800/70 bg-slate-950/94 px-4 pb-3 pt-5 shadow-[0_10px_24px_rgba(2,6,23,0.34)] backdrop-blur-md">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <BackButton
              targetTab="timer"
              isModalOpen={descriptionTask !== null}
              onModalClose={() => setDescriptionTask(null)}
              className="flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-white"
              wrapperClassName="shrink-0"
            />
            <div className="min-w-0 text-center">
              {!hideTasksTitle && (
                <h1 className="text-sm font-semibold tracking-tight text-slate-100">
                  {t('task.tasks')}
                </h1>
              )}
            </div>
            <div className="flex items-center justify-end gap-1.5">
              {preferences?.vacationExtension && <VacationControl />}
              {preferences?.listsExtension && (
                <IconButton
                  label={t('task.newList')}
                  title={t('task.newList')}
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsCreateListOpen(true)}
                  className="h-8 w-8 !p-0"
                >
                  <FaListUl size={11} />
                </IconButton>
              )}
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
        </header>

        {!selectedList && (
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg border border-slate-800/70 bg-slate-900/35 p-1">
            <button
              type="button"
              aria-pressed={taskPageViewMode === 'list'}
              onClick={() => setTaskPageViewMode('list')}
              className={clsx(
                'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
                taskPageViewMode === 'list'
                  ? 'bg-indigo-500/25 text-indigo-100'
                  : 'text-slate-500 hover:bg-slate-800/80 hover:text-slate-200'
              )}
            >
              <FaListUl size={10} />
              {t('common.list')}
            </button>
            <button
              type="button"
              aria-pressed={taskPageViewMode === 'calendar'}
              onClick={() => setTaskPageViewMode('calendar')}
              className={clsx(
                'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
                taskPageViewMode === 'calendar'
                  ? 'bg-indigo-500/25 text-indigo-100'
                  : 'text-slate-500 hover:bg-slate-800/80 hover:text-slate-200'
              )}
            >
              <FaCalendarAlt size={10} />
              {t('common.calendar')}
            </button>
          </div>
        )}

        {taskPageViewMode === 'calendar' && !selectedList && (
          <TaskCalendarNavigator
            entries={mixedTaskItems}
            scale={taskCalendarScale}
            anchorDate={taskCalendarAnchor}
            selectedDate={taskCalendarDate}
            onScaleChange={setTaskCalendarScale}
            onAnchorDateChange={setTaskCalendarAnchor}
            onSelectedDateChange={setTaskCalendarDate}
          />
        )}

        <section
          aria-label={
            selectedList ? `Add to ${selectedList.title}` : 'Capture a Task'
          }
          className="mt-4 rounded-xl border border-indigo-500/25 bg-linear-to-br from-indigo-950/40 via-slate-900/65 to-slate-950/75 p-2.5 shadow-sm shadow-indigo-950/30"
        >
          {selectedList ? (
            <form
              className="flex items-center gap-2"
              onSubmit={event => {
                event.preventDefault();
                void createListItem();
              }}
            >
              <span className="shrink-0 text-lg" aria-hidden="true">
                {selectedList.emoji ?? '📋'}
              </span>
              <input
                autoFocus
                value={newListItemTitle}
                onChange={event => setNewListItemTitle(event.target.value)}
                placeholder={`Add to ${selectedList.title}`}
                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-500"
              />
              <Button
                type="submit"
                size="sm"
                disabled={isSavingListItem || !newListItemTitle.trim()}
              >
                {t('common.add')}
              </Button>
            </form>
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

        <section
          aria-label={t('task.filter')}
          className="mt-3 rounded-xl border border-slate-800/70 bg-slate-900/35 p-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <TaskSearchInput
              value={taskSearchQuery}
              onChange={setTaskSearchQuery}
              inputRef={taskSearchInputRef}
            />
            <TaskIntentionFilterDropdown
              options={filterOptions}
              lists={lists}
              selectedValue={
                selectedListId
                  ? buildListFilterValue(selectedListId)
                  : selectedIntentionFilter
              }
              onSelect={value => {
                setSelectedListId(null);
                setSelectedIntentionFilter(value);
              }}
              onSelectList={listId => {
                setSelectedIntentionFilter(null);
                setSelectedListId(listId);
              }}
              onToggleFavorite={toggleFavoriteIntention}
              onToggleFavoriteList={toggleFavoriteList}
              openRequest={intentionPickerOpenRequest}
            />
          </div>

          <FavoriteIntentionFilters
            items={favoriteFilterOptions}
            selectedValue={
              selectedListId
                ? buildListFilterValue(selectedListId)
                : selectedIntentionFilter
            }
            onSelect={value => {
              if (isListFilterValue(value)) {
                const listId = parseListFilterValue(value);
                setSelectedIntentionFilter(null);
                setSelectedListId(current =>
                  current === listId ? null : listId
                );
                return;
              }
              setSelectedListId(null);
              setSelectedIntentionFilter(current =>
                current === value ? null : value
              );
            }}
            reserveWhileLoading={!intentionsLoaded && reserveFavoriteRow}
          />
        </section>

        <div className="mt-4 flex min-h-7 items-center justify-between gap-3 px-0.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
              {t('common.active')}
            </h2>
            <span
              className="text-[10px] tabular-nums text-slate-600"
              data-testid="task-count"
            >
              {taskCountLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setTaskSearchQuery('');
                  setSelectedIntentionFilter(null);
                  setSelectedListId(null);
                  setTimerTypeFilter('all');
                }}
                className="text-[11px] text-slate-500 transition-colors hover:text-slate-200"
              >
                {t('common.clearFilters')}
              </button>
            )}
            {!selectedList && (
              <TaskTimerTypeFilterDropdown
                value={timerTypeFilter}
                isOpen={isTypeMenuOpen}
                onOpenChange={setIsTypeMenuOpen}
                onChange={nextType => {
                  const selectedType = selectedFilterOption?.intention.type;
                  if (
                    nextType !== 'all' &&
                    selectedType &&
                    selectedType !== nextType
                  ) {
                    setSelectedIntentionFilter(null);
                    showToastFromStore(t('intention.filterCleared'), 'info');
                  }
                  setTimerTypeFilter(nextType);
                }}
              />
            )}
            <TaskSortDropdown
              mode={taskSortMode}
              isOpen={isSortMenuOpen}
              onOpenChange={setIsSortMenuOpen}
              onChange={mode => {
                setTaskSortMode(mode);
              }}
            />
          </div>
        </div>

        <div className="mt-2 space-y-2.5">
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
              activeItems={activeListItems}
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
                Add task
              </button>
            )}

          {!selectedList &&
            !isLoading &&
            mixedTaskItems.length === 0 &&
            hasActiveFilters && (
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/35 px-5 py-8 text-center text-sm text-slate-400">
                {hasActiveFilters ? 'No matching tasks' : 'No tasks'}
              </div>
            )}

          {!selectedList &&
            !isLoading &&
            mixedTaskItems.length > 0 &&
            (taskPageViewMode === 'calendar' &&
            displayedTaskItems.length === 0 ? (
              <div className="rounded-lg border border-slate-800/60 bg-slate-900/35 px-5 py-8 text-center text-sm text-slate-400">
                {t('task.noTasksForDate')}
              </div>
            ) : (
              <MixedTaskList
                entries={displayedTaskItems}
                completingTaskIds={completingTaskIds}
                completingListItemIds={completingListItemIds}
                orderedUndatedTaskIds={orderedIntentionFamilyTasks.map(
                  task => task.id
                )}
                canReorder={
                  taskPageViewMode === 'list' &&
                  selectedFilterOption !== null &&
                  taskSortMode === 'default' &&
                  normalizeSearchText(taskSearchQuery).length === 0
                }
                intentions={intentions}
                onEdit={setEditingTask}
                onEditListItem={setEditingListItem}
                onCompleteListItem={completeListItem}
                onArchiveListItem={setArchivingListItem}
                onOpenDescription={setDescriptionTask}
                onUpdate={updateTaskWithPositionFeedback}
                onReorder={reorderVisibleTasks}
                showTypeBadge={timerTypeFilter === 'all' || isTaskSearchActive}
              />
            ))}
        </div>

        <TaskFormModal
          isOpen={isCreateOpen || editingTask !== null}
          task={editingTask}
          activeTasks={tasks}
          intentions={intentions}
          lists={lists}
          preferences={preferences}
          timer={timer}
          taskMode="general"
          defaultIntentionSelection={taskFormDefaultIntention}
          defaultTimerType={taskFormDefaultTimerType}
          initialTitle={createInitialTitle}
          onClose={() => {
            setIsCreateOpen(false);
            setEditingTask(null);
            setCreateInitialTitle('');
          }}
          onCreate={createTask}
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
          error={archiveError}
          restoringTaskId={restoringTaskId}
          onClose={() => setIsArchiveOpen(false)}
          onRestore={restoreArchivedTask}
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
        <Modal
          isOpen={isCreateListOpen}
          onClose={() => setIsCreateListOpen(false)}
          title={t('task.newList')}
          closeOnBackdropClick={!isCreatingList}
          closeOnEscape={!isCreatingList}
        >
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              void createList();
            }}
          >
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-400">
                  {t('common.emoji')}
                </span>
                <input
                  value={newListEmoji}
                  onChange={event => setNewListEmoji(event.target.value)}
                  maxLength={16}
                  placeholder="📋"
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-center text-lg text-white outline-none focus:border-indigo-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-400">
                  {t('common.name')}
                </span>
                <input
                  autoFocus
                  value={newListTitle}
                  onChange={event => setNewListTitle(event.target.value)}
                  maxLength={120}
                  placeholder={t('task.groceriesPlaceholder')}
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-500"
                />
              </label>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isCreatingList || !newListTitle.trim()}
            >
              {isCreatingList ? t('common.creating') : t('task.createList')}
            </Button>
          </form>
        </Modal>
      </PageContainer>
    </PageShell>
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

function TaskTimerTypeFilterDropdown({
  value,
  isOpen,
  onOpenChange,
  onChange,
}: {
  value: TaskTimerTypeFilter;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onChange: (value: TaskTimerTypeFilter) => void;
}) {
  const { t } = useI18n();
  const options: Array<{ value: TaskTimerTypeFilter; label: string }> = [
    { value: 'all', label: t('common.all') },
    { value: TIMER_TYPES.WORK, label: t('common.work') },
    { value: TIMER_TYPES.BREAK, label: t('common.break') },
    { value: TIMER_TYPES.LONG_BREAK, label: t('common.longBreak') },
  ];
  const activeLabel = options.find(option => option.value === value)?.label;
  return (
    <div className="relative">
      <IconButton
        label={`${t('task.timerType')}: ${activeLabel}`}
        title={`${t('task.timerType')}: ${activeLabel}`}
        size="sm"
        variant={value === 'all' ? 'secondary' : 'primary'}
        onClick={() => onOpenChange(!isOpen)}
        aria-expanded={isOpen}
        className="h-7 w-7 !p-0"
      >
        <FaFilter size={11} />
      </IconButton>
      {isOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-32 overflow-hidden rounded-md border border-slate-800 bg-slate-950 py-1 text-xs shadow-xl shadow-black/30">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
              className={clsx(
                'flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-800/80',
                option.value === value ? 'text-indigo-100' : 'text-slate-300'
              )}
            >
              {option.label}
              {option.value === value && <FaCheck size={9} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskIntentionFilterDropdown({
  options,
  lists,
  selectedValue,
  onSelect,
  onSelectList,
  onToggleFavorite,
  onToggleFavoriteList,
  openRequest,
}: {
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
  const pickerOptions = useMemo(
    () => [
      ...buildTaskFilterPickerOptions(options),
      ...lists.map(list => ({
        value: buildListFilterValue(list.id),
        title: `List · ${list.title}`,
        emoji: list.emoji ?? '📋',
      })),
    ],
    [lists, options]
  );
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

    onSelect(nextValue);
    if (change.reason !== 'intention' || !subIntentionsByParent[parentValue]) {
      setIsOpen(false);
    }
  };

  return (
    <IntentionAssignmentPicker
      label={t('task.filterOpenList')}
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
      clearLabel={t('navigation.allTasks')}
      emptyLabel={t('navigation.allTasks')}
      noSelectionLabel={t('navigation.allTasks')}
      shortcut="I"
      shortcutShowModIcon
      shortcutPosition="topRight"
      shortcutAlwaysShow={false}
      searchAriaLabel={t('intention.searchIntentionsLists')}
      maxHeight={264}
      triggerClassName="relative flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 text-left text-xs text-slate-100 outline-none transition-colors hover:bg-slate-800/80 focus:border-indigo-400/70 disabled:opacity-60"
      dropdownClassName="right-0 w-[min(75vw,42rem)] max-w-[calc(100vw-1rem)]"
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
              aria-label={`${actionLabel} ${list.title}`}
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

function getFilterOptionEmojiText(option: TaskIntentionFilterOption) {
  return [
    option.parent?.emoji ?? option.intention.emoji,
    option.subIntention?.emoji,
  ]
    .filter(Boolean)
    .join('');
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
  error,
  restoringTaskId,
  onClose,
  onRestore,
}: {
  isOpen: boolean;
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
  restoringTaskId: string | null;
  onClose: () => void;
  onRestore: (task: Task) => void;
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
          tasks.map(task => (
            <div
              key={task.id}
              data-testid="task-archive-row"
              data-task-title={task.title}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-slate-800/70 bg-slate-950/25 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-slate-200">
                  {task.title}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] capitalize text-slate-500">
                  <span>{task.status}</span>
                  <span>{task.priority}</span>
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
                Restore
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function SelectedListItems({
  list,
  activeItems,
  completedItems,
  archivedItems,
  completingItemIds,
  onEdit,
  onComplete,
  onArchive,
  onRestore,
  onReset,
}: {
  list: List;
  activeItems: ListItem[];
  completedItems: ListItem[];
  archivedItems: ListItem[];
  completingItemIds: string[];
  onEdit: (item: ListItem) => void;
  onComplete: (item: ListItem) => Promise<void>;
  onArchive: (item: ListItem) => void;
  onRestore: (item: ListItem) => Promise<void>;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="selected-list-items">
      <div className="space-y-2.5">
        {activeItems.map(item => (
          <ListItemTaskRow
            key={item.id}
            item={item}
            list={list}
            isCompleting={completingItemIds.includes(item.id)}
            onEdit={onEdit}
            onComplete={onComplete}
            onArchive={onArchive}
          />
        ))}
        {activeItems.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700/70 px-5 py-8 text-center text-sm text-slate-500">
            No active items in {list.title}.
          </div>
        )}
      </div>

      {completedItems.length > 0 && (
        <section className="border-t border-slate-800/70 pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Completed ({completedItems.length})
            </h3>
            <Button size="xs" variant="secondary" onClick={onReset}>
              <FaUndo size={9} /> Reset List
            </Button>
          </div>
          <div className="space-y-2">
            {completedItems.map(item => (
              <ListItemTaskRow
                key={item.id}
                item={item}
                list={list}
                onEdit={onEdit}
                onComplete={onComplete}
                onArchive={onArchive}
                onRestore={onRestore}
              />
            ))}
          </div>
        </section>
      )}

      {archivedItems.length > 0 && (
        <section className="border-t border-slate-800/70 pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            Archived ({archivedItems.length})
          </h3>
          <div className="space-y-2">
            {archivedItems.map(item => (
              <ListItemTaskRow
                key={item.id}
                item={item}
                list={list}
                onEdit={onEdit}
                onComplete={onComplete}
                onArchive={onArchive}
                onRestore={onRestore}
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
  isCompleting,
  onEdit,
  onComplete,
  onArchive,
  onRestore,
}: {
  item: ListItem;
  list: List;
  isCompleting?: boolean;
  onEdit: (item: ListItem) => void;
  onComplete: (item: ListItem) => Promise<void>;
  onArchive: (item: ListItem) => void;
  onRestore?: (item: ListItem) => Promise<void>;
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
        'group/list-item relative flex min-h-14 items-center gap-3 border-l-2 border-indigo-400/70 bg-slate-900/75 px-3 py-2 transition-all duration-200',
        (isCompleted || isCompletionPending) && 'opacity-50'
      )}
    >
      <CompletionButton
        label={item.title}
        isCompleted={!isActive}
        isCompleting={isCompletionPending}
        disabled={isCompletionPending}
        onClick={() => void (isActive ? onComplete(item) : onRestore?.(item))}
        compact
      />
      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            'truncate text-sm font-medium text-slate-100',
            (isCompleted || isCompletionPending) &&
              'text-slate-500 line-through'
          )}
        >
          {item.title}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
          <span className="truncate text-indigo-200/75">
            {list.emoji ?? '📋'} {list.title}
          </span>
          <span className="capitalize">{item.priority}</span>
          {item.dueDate && <time data-swipe-start>{item.dueDate}</time>}
        </div>
      </div>
      <IconButton
        label={`Edit ${item.title}`}
        title={t('common.edit')}
        size="sm"
        variant="secondary"
        onClick={() => onEdit(item)}
        className="!rounded-full opacity-80 transition-opacity group-hover/list-item:opacity-100 group-focus-within/list-item:opacity-100"
      >
        <FaEdit />
      </IconButton>
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
            aria-label={`Archive ${item.title}`}
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
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-500"
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
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white"
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
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white"
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
  orderedUndatedTaskIds,
  canReorder,
  intentions,
  onEdit,
  onEditListItem,
  onCompleteListItem,
  onArchiveListItem,
  onOpenDescription,
  onUpdate,
  onReorder,
  showTypeBadge,
}: {
  entries: MixedTaskItem[];
  completingTaskIds: string[];
  completingListItemIds: string[];
  orderedUndatedTaskIds: string[];
  canReorder: boolean;
  intentions: Intention[];
  onEdit: (task: Task) => void;
  onEditListItem: (item: ListItem) => void;
  onCompleteListItem: (item: ListItem) => Promise<void>;
  onArchiveListItem: (item: ListItem) => void;
  onOpenDescription: (task: Task) => void;
  onUpdate: (task: {
    id: string;
    status?: TaskStatus;
    manualOrderOverride?: boolean;
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
  onReorder: (
    draggedTaskId: string,
    targetTaskId: string,
    placement: TaskDropPlacement
  ) => Promise<boolean>;
  showTypeBadge: boolean;
}) {
  const tasks = entries
    .filter(
      (entry): entry is Extract<MixedTaskItem, { kind: 'task' }> =>
        entry.kind === 'task'
    )
    .map(entry => entry.task);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    placement: TaskDropPlacement;
  } | null>(null);
  const draggingTaskIdRef = useRef<string | null>(null);
  const lastDropTargetRef = useRef<{
    id: string;
    placement: TaskDropPlacement;
  } | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    dragPointerYRef.current = null;
  }, []);

  const clearDragState = useCallback(() => {
    draggingTaskIdRef.current = null;
    lastDropTargetRef.current = null;
    stopAutoScroll();
    setDraggingTaskId(null);
    setDropTarget(null);
  }, [stopAutoScroll]);

  const clearDropTarget = useCallback(() => {
    if (!lastDropTargetRef.current) {
      return;
    }

    lastDropTargetRef.current = null;
    setDropTarget(null);
  }, []);

  const updateDropTargetFromPoint = useCallback(
    (clientY: number) => {
      const activeTaskId = draggingTaskIdRef.current;
      if (!activeTaskId) {
        return;
      }

      const nextTarget = getDropTargetFromPoint(tasks, clientY);
      if (
        !nextTarget ||
        doesDropTargetKeepOrder(
          orderedUndatedTaskIds,
          activeTaskId,
          nextTarget.id,
          nextTarget.placement
        )
      ) {
        clearDropTarget();
        return;
      }

      lastDropTargetRef.current = nextTarget;
      setDropTarget(nextTarget);
    },
    [clearDropTarget, orderedUndatedTaskIds, tasks]
  );

  const runAutoScroll = useCallback(() => {
    const pointerY = dragPointerYRef.current;
    if (!draggingTaskIdRef.current || pointerY === null) {
      autoScrollFrameRef.current = null;
      return;
    }

    const scrollDelta = getDragAutoScrollDelta(pointerY, window.innerHeight);
    if (scrollDelta !== 0) {
      window.scrollBy(0, scrollDelta);
      updateDropTargetFromPoint(pointerY);
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  }, [updateDropTargetFromPoint]);

  const startAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      return;
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  }, [runAutoScroll]);

  useEffect(() => {
    if (!canReorder) {
      clearDragState();
    }
  }, [canReorder, clearDragState]);

  const startDrag = useCallback(
    (task: Task, clientY: number) => {
      draggingTaskIdRef.current = task.id;
      dragPointerYRef.current = clientY;
      setDraggingTaskId(task.id);
      setDropTarget(null);
      startAutoScroll();
    },
    [startAutoScroll]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, task: Task) => {
      if (task.pinnedAt || event.button !== 0) {
        return;
      }

      event.preventDefault();
      startDrag(task, event.clientY);
    },
    [startDrag]
  );

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>, task: Task) => {
      if (task.pinnedAt || event.button !== 0) {
        return;
      }

      event.preventDefault();
      startDrag(task, event.clientY);
    },
    [startDrag]
  );

  const finishDragAtPoint = useCallback(
    async (clientY: number) => {
      dragPointerYRef.current = clientY;
      updateDropTargetFromPoint(clientY);
      const activeTaskId = draggingTaskIdRef.current;
      const target = lastDropTargetRef.current;
      if (!activeTaskId || !target) {
        clearDragState();
        return;
      }

      const draggedTaskId = activeTaskId;
      clearDragState();
      await onReorder(draggedTaskId, target.id, target.placement);
    },
    [clearDragState, onReorder, updateDropTargetFromPoint]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      dragPointerYRef.current = event.clientY;
      updateDropTargetFromPoint(event.clientY);
    };
    const handleMouseMove = (event: MouseEvent) => {
      dragPointerYRef.current = event.clientY;
      updateDropTargetFromPoint(event.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => {
      void finishDragAtPoint(event.clientY);
    };
    const handleMouseUp = (event: MouseEvent) => {
      void finishDragAtPoint(event.clientY);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', clearDragState);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', clearDragState);
    };
  }, [clearDragState, finishDragAtPoint, updateDropTargetFromPoint]);

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  return (
    <section
      data-testid="task-list"
      data-dragging-task-id={draggingTaskId ?? undefined}
      data-drop-target-id={dropTarget?.id ?? undefined}
      data-drop-placement={dropTarget?.placement ?? undefined}
      className="overflow-visible rounded-xl border border-slate-800/75 bg-slate-900/30 shadow-sm shadow-black/15"
    >
      <AnimatePresence initial={false}>
        {entries.map(entry => {
          if (entry.kind === 'listItem') {
            const isCompleting = completingListItemIds.includes(entry.item.id);
            return (
              <motion.div
                key={`list-item:${entry.item.id}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: isCompleting ? 0.5 : 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
                className="border-b border-slate-800/65 last:border-b-0"
              >
                <ListItemTaskRow
                  item={entry.item}
                  list={entry.list}
                  isCompleting={isCompleting}
                  onEdit={onEditListItem}
                  onComplete={onCompleteListItem}
                  onArchive={onArchiveListItem}
                />
              </motion.div>
            );
          }
          const task = entry.task;
          const isCompleting = completingTaskIds.includes(task.id);
          return (
            <motion.div
              key={task.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={
                task.status === TASK_STATUSES.COMPLETED || isCompleting
                  ? { opacity: 0.5, y: 0 }
                  : { opacity: 1, y: 0 }
              }
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="border-b border-slate-800/65 last:border-b-0"
            >
              <TaskRow
                task={task}
                isCompleting={isCompleting}
                intentions={intentions}
                onEdit={onEdit}
                onOpenDescription={onOpenDescription}
                onUpdate={onUpdate}
                canReorder={canReorder && !task.pinnedAt && !isCompleting}
                isDragging={draggingTaskId === task.id}
                dropPlacement={
                  dropTarget?.id === task.id ? dropTarget.placement : null
                }
                onPointerDown={event => handlePointerDown(event, task)}
                onMouseDown={event => handleMouseDown(event, task)}
                showTypeBadge={showTypeBadge}
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
  onEdit,
  onOpenDescription,
  onUpdate,
  canReorder,
  isDragging,
  dropPlacement,
  onPointerDown,
  onMouseDown,
  showTypeBadge,
}: {
  task: Task;
  isCompleting: boolean;
  intentions: Intention[];
  onEdit: (task: Task) => void;
  onOpenDescription: (task: Task) => void;
  onUpdate: (task: {
    id: string;
    status?: TaskStatus;
    manualOrderOverride?: boolean;
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
  canReorder: boolean;
  isDragging: boolean;
  dropPlacement: TaskDropPlacement | null;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  showTypeBadge: boolean;
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
        isDragging && 'opacity-40',
        isPinned &&
          'bg-indigo-950/30 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.24)]',
        !isPinned && isOverdue && 'bg-red-950/20',
        !isPinned && !isOverdue && 'bg-transparent hover:bg-slate-800/25',
        isCompleted && 'opacity-50'
      )}
    >
      <div
        aria-hidden="true"
        className={clsx(
          'absolute inset-y-2 left-0 w-0.5 rounded-r-full',
          getTaskPriorityAccentClass(task.priority)
        )}
      />
      {dropPlacement && (
        <div
          aria-hidden="true"
          className={clsx(
            'pointer-events-none absolute left-2 right-2 z-10 h-0.5 rounded-full bg-indigo-300 shadow shadow-indigo-300/40',
            dropPlacement === 'before' ? 'top-0' : 'bottom-0'
          )}
        />
      )}
      <div
        className={clsx(
          'grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2 pr-2.5',
          'pl-3'
        )}
      >
        {canReorder ? (
          <div className="absolute -left-3 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center">
            {task.manualOrderOverride && (
              <button
                type="button"
                aria-label={t('task.resetAutomaticOrderFor', {
                  title: task.title,
                })}
                title={t('task.resetAutomaticOrder')}
                onClick={() =>
                  void onUpdate({ id: task.id, manualOrderOverride: false })
                }
                disabled={saving}
                className="z-10 -mb-1 flex h-4 w-4 items-center justify-center rounded-full border border-indigo-300/60 bg-indigo-950 text-indigo-100 shadow-md shadow-black/40 hover:bg-indigo-900 disabled:opacity-50"
              >
                <FaUndo size={7} />
              </button>
            )}
            <button
              type="button"
              aria-label={`Drag ${task.title}`}
              onPointerDown={onPointerDown}
              onMouseDown={onMouseDown}
              className={clsx(
                'group/task-drag flex h-7 w-4 cursor-grab touch-none select-none items-center justify-center rounded border bg-slate-950/95 shadow-sm shadow-black/35 transition active:cursor-grabbing',
                task.manualOrderOverride
                  ? 'border-indigo-400/70 text-indigo-200 hover:bg-indigo-950 hover:text-indigo-100'
                  : 'border-slate-700/80 text-slate-400 hover:border-slate-500 hover:bg-slate-800/60 hover:text-slate-100'
              )}
            >
              <FaGripVertical size={13} />
            </button>
          </div>
        ) : null}
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
              onUpdate={onUpdate}
              onOpenEditor={() => onEdit(task)}
              showIntention
              compact={false}
              isOverdue={isOverdue}
            />
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-80 transition-opacity group-hover/task-row:opacity-100 group-focus-within/task-row:opacity-100">
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
          <IconButton
            label={`Edit ${task.title}`}
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

function getAutomaticUnpinnedTasks(
  tasks: Task[],
  orderingClock: TaskOrderingClock
) {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  return buildTaskView({
    tasks: tasks.map(task => ({
      ...task,
      manualOrder: null,
      manualOrderOverride: false,
    })),
    mode: 'general',
    filterTimerType: false,
    hideVacationCovered: false,
    today: orderingClock.today,
    currentTime: orderingClock.currentTime,
  }).tasks.map(task => tasksById.get(task.id)!);
}

function getFavoriteRowStorageKey(userId: string | null) {
  return `pomi.tasks.favorite-row.${userId ?? 'unknown'}`;
}

function readFavoriteRowMemory(userId: string | null) {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(getFavoriteRowStorageKey(userId)) === '1';
}

function writeFavoriteRowMemory(userId: string | null, hasFavorites: boolean) {
  if (typeof window === 'undefined') return;
  const key = getFavoriteRowStorageKey(userId);
  if (hasFavorites) window.localStorage.setItem(key, '1');
  else window.localStorage.removeItem(key);
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

function getDropTargetFromPoint(
  tasks: Task[],
  clientY: number
): { id: string; placement: TaskDropPlacement } | null {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')
  )
    .map(row => {
      const task = tasks.find(candidate => candidate.id === row.dataset.taskId);
      return task
        ? {
            row,
            task,
            rect: row.getBoundingClientRect(),
          }
        : null;
    })
    .filter((entry): entry is { row: HTMLElement; task: Task; rect: DOMRect } =>
      Boolean(entry)
    );
  const unpinnedRows = rows.filter(entry => entry.task.pinnedAt === null);
  if (unpinnedRows.length === 0) {
    return null;
  }

  const firstUnpinnedRow = unpinnedRows[0];
  const lastUnpinnedRow = unpinnedRows[unpinnedRows.length - 1];
  if (clientY < firstUnpinnedRow.rect.top) {
    return { id: firstUnpinnedRow.task.id, placement: 'before' };
  }
  if (clientY > lastUnpinnedRow.rect.bottom) {
    return { id: lastUnpinnedRow.task.id, placement: 'after' };
  }

  for (const [index, entry] of unpinnedRows.entries()) {
    if (clientY < entry.rect.top + entry.rect.height / 2) {
      return index === 0
        ? { id: entry.task.id, placement: 'before' }
        : { id: unpinnedRows[index - 1].task.id, placement: 'after' };
    }
  }

  return { id: lastUnpinnedRow.task.id, placement: 'after' };
}

const DRAG_AUTO_SCROLL_EDGE_PX = 80;
const DRAG_AUTO_SCROLL_MAX_DELTA_PX = 18;

function getDragAutoScrollDelta(clientY: number, viewportHeight: number) {
  if (clientY < DRAG_AUTO_SCROLL_EDGE_PX) {
    return -Math.ceil(
      ((DRAG_AUTO_SCROLL_EDGE_PX - clientY) / DRAG_AUTO_SCROLL_EDGE_PX) *
        DRAG_AUTO_SCROLL_MAX_DELTA_PX
    );
  }

  const bottomDistance = viewportHeight - clientY;
  if (bottomDistance < DRAG_AUTO_SCROLL_EDGE_PX) {
    return Math.ceil(
      ((DRAG_AUTO_SCROLL_EDGE_PX - bottomDistance) / DRAG_AUTO_SCROLL_EDGE_PX) *
        DRAG_AUTO_SCROLL_MAX_DELTA_PX
    );
  }

  return 0;
}

function doesDropTargetKeepOrder(
  taskIds: string[],
  draggedTaskId: string,
  targetTaskId: string,
  placement: TaskDropPlacement
) {
  const reorderedTaskIds = moveTaskIdInList(
    taskIds,
    draggedTaskId,
    targetTaskId,
    placement
  );

  return (
    reorderedTaskIds === null ||
    reorderedTaskIds.every((taskId, index) => taskId === taskIds[index])
  );
}

function moveTaskInList(
  tasks: Task[],
  draggedTaskId: string,
  targetTaskId: string,
  placement: TaskDropPlacement
) {
  const taskIds = moveTaskIdInList(
    tasks.map(task => task.id),
    draggedTaskId,
    targetTaskId,
    placement
  );
  if (!taskIds) {
    return null;
  }

  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const reorderedTasks = taskIds
    .map(taskId => tasksById.get(taskId))
    .filter((task): task is Task => Boolean(task));

  if (reorderedTasks.every((task, index) => task.id === tasks[index]?.id)) {
    return null;
  }

  return reorderedTasks;
}

function moveTaskIdInList(
  taskIds: string[],
  draggedTaskId: string,
  targetTaskId: string,
  placement: TaskDropPlacement
) {
  const draggedIndex = taskIds.indexOf(draggedTaskId);
  const targetIndex = taskIds.indexOf(targetTaskId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return null;
  }

  const withoutDragged = taskIds.filter(taskId => taskId !== draggedTaskId);
  const adjustedTargetIndex = withoutDragged.indexOf(targetTaskId);
  if (adjustedTargetIndex < 0) {
    return null;
  }

  const insertIndex =
    placement === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  const reorderedTaskIds = [...withoutDragged];
  reorderedTaskIds.splice(insertIndex, 0, draggedTaskId);

  return reorderedTaskIds;
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
