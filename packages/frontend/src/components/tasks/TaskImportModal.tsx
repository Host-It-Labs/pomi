import { Intention, TaskPriority, TimerTypes } from '@pomi/shared';
import {
  TASK_PRIORITIES,
  TIMER_TYPES,
  TASK_IMPORT_SOURCES,
  TASK_STATUSES,
} from '@pomi/shared/src/constants';
import { strFromU8, unzipSync } from 'fflate';
import {
  ChangeEvent,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FaArrowDown,
  FaArrowLeft,
  FaArrowUp,
  FaCheck,
  FaCog,
  FaFileImport,
  FaPlus,
  FaRedo,
  FaRegSquare,
  FaTimes,
} from 'react-icons/fa';
import {
  IntentionAssignmentPicker,
  IntentionAssignmentPickerActionContext,
  IntentionAssignmentOption,
  IntentionAssignmentPickerChange,
} from '../intentions/IntentionAssignmentPicker';
import { apiClient } from '../../utils/apiClient';
import { submitUserMutation } from '../../utils/userActionQueue';
import { isDesktop } from '../../utils/osUtils';
import {
  formatCompactTaskRecurrence,
  formatTaskRecurrence,
} from '../../utils/taskUi';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { KeyboardShortcut } from '../ui/KeyboardShortcut';
import { Modal } from '../ui/Modal';
import { UnsavedChangesDialog } from '../ui/UnsavedChangesDialog';
import { useTasksStore } from '../../stores/tasksStore';
import { useI18n } from '../../i18n';

type ImportPreviewTask = {
  sourceId: string;
  title: string;
  projectTitle: string | null;
  labels: string[];
  dueDate: string | null;
  dueTime: string | null;
  priority: TaskPriority;
  timerType: TimerTypes;
  description: string | null;
  recurrenceRule: string | null;
  recurrenceInterval: number | null;
  recurrenceAnchorMode: 'planned' | 'completion';
  intentionSlug: string | null;
  subIntentionSlug: string | null;
  newIntentionTitle: string | null;
  newIntentionEmoji: string | null;
  newSubIntentionTitle: string | null;
  alreadyImported: boolean;
  include: boolean;
};

type TaskImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void | Promise<void>;
};

type VikunjaContext = {
  projectTitle: string | null;
};

type NewIntentionOption = {
  value: string;
  title: string;
  emoji: string;
  timerType: TimerTypes;
};

type ImportIntentionOption = NewIntentionOption & {
  isNew: boolean;
};

type ReplaceNewIntentionChoice = 'one' | 'all';

const NEW_INTENTION_PREFIX = 'new-intention:';
const CREATE_INTENTION_ACTION_VALUE = '__create-intention__';
const VIKUNJA_REPEAT_MODE_MONTH = 1;
const VIKUNJA_REPEAT_MODE_FROM_CURRENT_DATE = 2;

export function TaskImportModal({
  isOpen,
  onClose,
  onImported,
}: TaskImportModalProps) {
  const { t } = useI18n();
  const [previewTasks, setPreviewTasks] = useState<ImportPreviewTask[]>([]);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [pendingNewIntentionChange, setPendingNewIntentionChange] = useState<{
    sourceId: string;
    fromIntentionSlug: string;
    updates: Partial<ImportPreviewTask>;
  } | null>(null);
  const [
    rememberPendingNewIntentionChoice,
    setRememberPendingNewIntentionChoice,
  ] = useState(false);
  const [rememberedNewIntentionChoices, setRememberedNewIntentionChoices] =
    useState<Record<string, ReplaceNewIntentionChoice>>({});
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [settingsSourceId, setSettingsSourceId] = useState<string | null>(null);
  const [openIntentionSourceId, setOpenIntentionSourceId] = useState<
    string | null
  >(null);
  const [createIntentionTask, setCreateIntentionTask] =
    useState<ImportPreviewTask | null>(null);
  const [createIntentionTitle, setCreateIntentionTitle] = useState('');
  const [createIntentionEmoji, setCreateIntentionEmoji] = useState('');
  const createIntentionType = TIMER_TYPES.WORK;
  const [createParentIntentionId, setCreateParentIntentionId] = useState<
    string | null
  >(null);
  const [createIntentionInitialKey, setCreateIntentionInitialKey] =
    useState('');
  const [
    showCreateIntentionDiscardConfirm,
    setShowCreateIntentionDiscardConfirm,
  ] = useState(false);
  const [isCreatingIntention, setIsCreatingIntention] = useState(false);
  const [dismissedMessages, setDismissedMessages] = useState<Set<string>>(
    () => new Set()
  );
  const loadTasks = useTasksStore.use.loadTasks();
  const pageRef = useRef<HTMLDivElement>(null);
  const activeIntentions = useMemo(
    () => getTaskEligibleImportIntentions(intentions),
    [intentions]
  );
  const newIntentionOptions = useMemo(() => {
    const options = new Map<string, NewIntentionOption>();
    for (const task of previewTasks) {
      if (!task.newIntentionTitle) {
        continue;
      }
      if (
        findParentIntentionByTitle(
          activeIntentions,
          task.newIntentionTitle,
          task.timerType
        )
      ) {
        continue;
      }

      const value = buildNewIntentionValue(
        task.newIntentionTitle,
        task.timerType
      );
      if (!options.has(value)) {
        options.set(value, {
          value,
          title: task.newIntentionTitle,
          emoji:
            task.newIntentionEmoji ??
            getDefaultImportIntentionEmoji(task.newIntentionTitle),
          timerType: task.timerType,
        });
      }
    }

    return [...options.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [activeIntentions, previewTasks]);
  const duplicatePreviewTasks = useMemo(
    () => previewTasks.filter(task => task.alreadyImported),
    [previewTasks]
  );
  const createParentIntentionOptions = useMemo(
    () => getParentIntentionOptions(activeIntentions, createIntentionType),
    [activeIntentions, createIntentionType]
  );
  const fetchImportIntentions = useCallback(async () => {
    const response = await apiClient.intentions.list({
      query: { includeSubIntentions: true },
    });
    return response.status === 200 ? response.body : null;
  }, []);
  const refreshImportIntentions = useCallback(async () => {
    const nextIntentions = await fetchImportIntentions();
    if (nextIntentions) {
      setIntentions(nextIntentions);
    }
    return nextIntentions;
  }, [fetchImportIntentions]);

  useEffect(() => {
    if (!isOpen) {
      setError('');
      setPreviewTasks([]);
      setFileName('');
      setIsReviewing(false);
      setShowImportConfirm(false);
      setShowExitConfirm(false);
      setPendingNewIntentionChange(null);
      setRememberPendingNewIntentionChoice(false);
      setRememberedNewIntentionChoices({});
      setSelectedSourceId(null);
      setSettingsSourceId(null);
      setOpenIntentionSourceId(null);
      setCreateIntentionTask(null);
      setCreateIntentionTitle('');
      setCreateIntentionEmoji('');
      setCreateParentIntentionId(null);
      setCreateIntentionInitialKey('');
      setShowCreateIntentionDiscardConfirm(false);
      setIsCreatingIntention(false);
      setDismissedMessages(new Set());
      return;
    }

    let isCancelled = false;
    void loadTasks();
    fetchImportIntentions().then(nextIntentions => {
      if (!isCancelled && nextIntentions) {
        setIntentions(nextIntentions);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [fetchImportIntentions, isOpen, loadTasks]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    // The import review is a full-screen fixed surface; lock only the page
    // behind it so the app shell cannot show a useless second scrollbar.
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (previewTasks.length === 0 || activeIntentions.length === 0) {
      return;
    }

    setPreviewTasks(currentTasks =>
      currentTasks.map(task =>
        hydrateImportTaskIntention(task, activeIntentions)
      )
    );
  }, [activeIntentions, previewTasks.length]);

  useEffect(() => {
    if (!isOpen || previewTasks.length === 0) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        createIntentionTask ||
        pendingNewIntentionChange ||
        showImportConfirm ||
        showExitConfirm
      ) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (openIntentionSourceId) {
          setOpenIntentionSourceId(null);
          focusImportPage();
        }
        return;
      }

      if (openIntentionSourceId) {
        return;
      }

      if (isFormTarget(event.target)) {
        return;
      }

      const selectedTask =
        previewTasks.find(task => task.sourceId === selectedSourceId) ??
        previewTasks[0];
      if (!selectedTask) {
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusPreviewTask(-1);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusPreviewTask(1);
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        togglePreviewTask(selectedTask.sourceId);
        return;
      }
      const isModPressed = event.metaKey || event.ctrlKey;
      if (
        event.key.toLowerCase() === 'i' ||
        (isModPressed &&
          !event.altKey &&
          !event.shiftKey &&
          event.code === 'KeyI')
      ) {
        event.preventDefault();
        openImportIntentionPicker(selectedTask.sourceId);
        return;
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setSettingsSourceId(current =>
          current === selectedTask.sourceId ? null : selectedTask.sourceId
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void handleReviewImport();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  });

  useEffect(() => {
    if (!selectedSourceId) {
      return;
    }

    const selectedRow = [...document.querySelectorAll('[data-import-task-row]')]
      .filter(
        (element): element is HTMLElement => element instanceof HTMLElement
      )
      .find(element => element.dataset.importSourceId === selectedSourceId);
    selectedRow?.scrollIntoView({ block: 'nearest' });
  }, [selectedSourceId]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setError('');
      setDismissedMessages(new Set());
      setSettingsSourceId(null);
      setSelectedSourceId(null);
      setOpenIntentionSourceId(null);
      setCreateIntentionTask(null);
      setCreateIntentionTitle('');
      setCreateIntentionEmoji('');
      setCreateParentIntentionId(null);
      setIsCreatingIntention(false);
      setPendingNewIntentionChange(null);
      setRememberPendingNewIntentionChoice(false);
      setRememberedNewIntentionChoices({});
      setFileName(file.name);
      const parsed = await readVikunjaExportFile(
        file,
        t('task.vikunjaMissingData')
      );
      const tasks = parseVikunjaPreviewTasks(parsed);
      const existingSourceIds = await fetchExistingImportSourceIds();
      const nextTasks = tasks.map(task => {
        const alreadyImported = existingSourceIds.has(task.sourceId);
        return hydrateImportTaskIntention(
          {
            ...task,
            alreadyImported,
            include: alreadyImported ? false : task.include,
          },
          activeIntentions
        );
      });
      setPreviewTasks(nextTasks);
      setSelectedSourceId(nextTasks[0]?.sourceId ?? null);
      if (nextTasks.length === 0) {
        setError('No active Vikunja tasks found in this export.');
      }
    } catch (err) {
      console.error('Failed to parse Vikunja export:', err);
      setPreviewTasks([]);
      setError('Could not read this Vikunja export.');
    } finally {
      event.target.value = '';
    }
  };

  const focusPreviewTask = (direction: -1 | 1) => {
    if (previewTasks.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      previewTasks.findIndex(task => task.sourceId === selectedSourceId)
    );
    const nextIndex = Math.min(
      previewTasks.length - 1,
      Math.max(0, currentIndex + direction)
    );
    setSelectedSourceId(previewTasks[nextIndex].sourceId);
  };

  const togglePreviewTask = (sourceId: string) => {
    setPreviewTasks(currentTasks =>
      currentTasks.map(task =>
        task.sourceId === sourceId && !task.alreadyImported
          ? { ...task, include: !task.include }
          : task
      )
    );
    setSelectedSourceId(sourceId);
  };

  const updateTaskSettings = (
    sourceId: string,
    updates: Partial<ImportPreviewTask>
  ) => {
    setPreviewTasks(currentTasks =>
      currentTasks.map(task =>
        task.sourceId === sourceId
          ? hydrateImportTaskIntention(
              {
                ...task,
                ...updates,
                subIntentionSlug:
                  updates.subIntentionSlug ?? task.subIntentionSlug,
              },
              activeIntentions
            )
          : task
      )
    );
    setSelectedSourceId(sourceId);
  };

  const handleReviewImport = async () => {
    if (!previewTasks.some(task => task.include)) {
      setError('Choose at least one task to import.');
      return;
    }
    if (previewTasks.some(task => task.include && !task.title.trim())) {
      setError('Every selected Task needs a title.');
      return;
    }
    if (previewTasks.some(task => task.include && !task.intentionSlug)) {
      setError('Every selected Task needs an Intention.');
      return;
    }

    setShowImportConfirm(true);
  };

  const handleConfirmImport = async () => {
    setShowImportConfirm(false);

    await performImport();
  };

  const handleExitImport = () => {
    setShowExitConfirm(false);
    onClose();
  };

  const performImport = async () => {
    try {
      setIsReviewing(true);
      setError('');
      const rowsToImport = previewTasks
        .filter(task => task.include)
        .map(task => {
          const selectedNewIntention = getSelectedNewIntention(
            task,
            newIntentionOptions
          );

          return {
            sourceId: task.sourceId,
            title: task.title,
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            description: task.description,
            priority: task.priority,
            timerType: task.timerType,
            recurrenceRule: task.recurrenceRule,
            recurrenceInterval: task.recurrenceInterval,
            recurrenceAnchorMode: task.recurrenceAnchorMode,
            intentionSlug: selectedNewIntention ? null : task.intentionSlug,
            subIntentionSlug: selectedNewIntention
              ? null
              : task.subIntentionSlug,
            newIntentionTitle: selectedNewIntention?.title ?? null,
            newIntentionEmoji: selectedNewIntention?.emoji ?? null,
            newSubIntentionTitle: selectedNewIntention
              ? task.newSubIntentionTitle
              : null,
            include: true,
          };
        });

      const body = {
        source: TASK_IMPORT_SOURCES.VIKUNJA,
        tasks: rowsToImport,
      };
      const result = await submitUserMutation({
        kind: 'tasks',
        label: t('task.importTasks'),
        payload: {
          operation: 'import',
          importSource: body.source,
          rows: body.tasks,
        },
        reconcile: () => loadTasks(),
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: unknown })
          : { status: 200, body: result };

      if (response.status === 200) {
        await loadTasks();
        await onImported?.();
        onClose();
      } else {
        setError(t('task.importFailed'));
      }
    } catch (err) {
      console.error('Failed to import Vikunja tasks:', err);
      setError(t('task.importFailed'));
    } finally {
      setIsReviewing(false);
    }
  };

  const openImportIntentionPicker = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    void refreshImportIntentions();
    setOpenIntentionSourceId(sourceId);
  };

  const focusImportPage = () => {
    requestAnimationFrame(() => pageRef.current?.focus());
  };

  const setImportIntentionPickerOpen = (sourceId: string, open: boolean) => {
    if (open) {
      void refreshImportIntentions();
    }
    setOpenIntentionSourceId(open ? sourceId : null);
    if (!open) {
      focusImportPage();
    }
  };

  const handleImportIntentionChange = (
    sourceId: string,
    change: IntentionAssignmentPickerChange
  ) => {
    const task = previewTasks.find(item => item.sourceId === sourceId);
    const selectedValue = change.intentionSlugs[0];
    if (!task || !selectedValue) {
      return;
    }

    const option = getImportIntentionOptions(
      activeIntentions,
      task,
      newIntentionOptions
    ).find(item => item.value === selectedValue);
    if (!option) {
      return;
    }

    const updates = {
      ...getIntentionSelectionUpdates(option),
      subIntentionSlug: change.subIntentions[selectedValue] ?? null,
    };
    const keepPickerOpen =
      change.reason === 'intention' &&
      !option.isNew &&
      getSubIntentionOptions(activeIntentions, option.value).length > 0;

    requestImportIntentionUpdate(sourceId, updates, keepPickerOpen);
  };

  const handleImportIntentionAction = (
    sourceId: string,
    option: IntentionAssignmentOption,
    context?: IntentionAssignmentPickerActionContext
  ) => {
    if (option.value !== CREATE_INTENTION_ACTION_VALUE) {
      return;
    }

    const task = previewTasks.find(item => item.sourceId === sourceId);
    if (!task) {
      return;
    }

    const title =
      context?.searchText.trim() ||
      getActiveImportIntentionSearchText() ||
      getCreatableNewIntentionTitle(task);
    setSelectedSourceId(sourceId);
    setOpenIntentionSourceId(null);
    setCreateIntentionTask(task);
    setCreateIntentionTitle(title);
    const emoji =
      task.newIntentionEmoji ?? getDefaultImportIntentionEmoji(title);
    setCreateIntentionEmoji(emoji);
    setCreateParentIntentionId(null);
    setCreateIntentionInitialKey(
      serializeCreateIntentionForm({
        title,
        emoji,
        type: task.timerType,
        parentId: null,
      })
    );
  };

  const closeCreateImportIntentionModal = () => {
    setCreateIntentionTask(null);
    setCreateIntentionTitle('');
    setCreateIntentionEmoji('');
    setCreateParentIntentionId(null);
    setCreateIntentionInitialKey('');
    setShowCreateIntentionDiscardConfirm(false);
    setIsCreatingIntention(false);
    focusImportPage();
  };

  const requestCloseCreateImportIntentionModal = () => {
    if (isCreatingIntention) {
      return;
    }

    const currentKey = serializeCreateIntentionForm({
      title: createIntentionTitle,
      emoji: createIntentionEmoji,
      type: createIntentionType,
      parentId: createParentIntentionId,
    });
    if (currentKey !== createIntentionInitialKey) {
      setShowCreateIntentionDiscardConfirm(true);
      return;
    }

    closeCreateImportIntentionModal();
  };

  const assignCreatedImportIntention = (
    sourceId: string,
    createdIntention: Intention,
    intentionLookup: Intention[] = activeIntentions
  ) => {
    const currentTask =
      previewTasks.find(task => task.sourceId === sourceId) ??
      createIntentionTask;
    const parentIntention = createdIntention.parentIntentionId
      ? (intentionLookup.find(
          intention => intention.id === createdIntention.parentIntentionId
        ) ?? createdIntention.parentIntention)
      : null;
    const sharedNewIntentionSlug = currentTask?.intentionSlug?.startsWith(
      NEW_INTENTION_PREFIX
    )
      ? currentTask.intentionSlug
      : undefined;
    const updates: Partial<ImportPreviewTask> = parentIntention
      ? {
          intentionSlug: parentIntention.slug,
          subIntentionSlug: createdIntention.slug,
          newIntentionTitle: null,
          newIntentionEmoji: null,
          newSubIntentionTitle: null,
        }
      : getIntentionSelectionUpdates({
          value: createdIntention.slug,
          title: createdIntention.title,
          emoji: createdIntention.emoji,
          timerType: createdIntention.type,
          isNew: false,
        });

    applyImportIntentionUpdates(sourceId, updates, sharedNewIntentionSlug);
  };

  const handleSubmitCreateImportIntention = async (event: FormEvent) => {
    event.preventDefault();
    if (!createIntentionTask) {
      return;
    }

    const title = createIntentionTitle.trim();
    const emoji = createIntentionEmoji.trim();
    if (!title || !emoji) {
      setError(t('intention.titleEmojiRequired'));
      return;
    }

    try {
      setIsCreatingIntention(true);
      setError('');
      const body = {
        title,
        emoji,
        type: createIntentionType,
        hasCustomDuration: false,
        keepScreenAwake: false,
        isHabit: false,
        parentIntentionId: createParentIntentionId || undefined,
      };
      const result = await submitUserMutation({
        kind: 'intentions',
        label: t('task.createImportIntention'),
        payload: { operation: 'create', ...body },
        reconcile: async () => {
          await refreshImportIntentions();
        },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: Intention })
          : { status: 201, body: result as Intention };

      if (response.status === 201) {
        const nextIntentions = await refreshImportIntentions();
        const sourceId = createIntentionTask.sourceId;
        closeCreateImportIntentionModal();
        assignCreatedImportIntention(
          sourceId,
          response.body,
          nextIntentions ?? activeIntentions
        );
        return;
      }

      const nextIntentions = await refreshImportIntentions();
      const existingIntention = createParentIntentionId
        ? findSubIntentionByTitle(
            nextIntentions ?? activeIntentions,
            title,
            createParentIntentionId,
            createIntentionType
          )
        : findParentIntentionByTitle(
            nextIntentions ?? activeIntentions,
            title,
            createIntentionType
          );
      if (existingIntention) {
        const sourceId = createIntentionTask.sourceId;
        closeCreateImportIntentionModal();
        assignCreatedImportIntention(
          sourceId,
          existingIntention,
          nextIntentions ?? activeIntentions
        );
        return;
      }

      setError('Could not create Intention.');
    } catch (err) {
      console.error('Failed to create import Intention:', err);
      setError('Could not create Intention.');
    } finally {
      setIsCreatingIntention(false);
    }
  };

  const requestImportIntentionUpdate = (
    sourceId: string,
    updates: Partial<ImportPreviewTask>,
    keepPickerOpen = false
  ) => {
    const task = previewTasks.find(item => item.sourceId === sourceId);
    if (!task) {
      return;
    }

    const fromIntentionSlug = task.intentionSlug;
    if (
      fromIntentionSlug?.startsWith(NEW_INTENTION_PREFIX) &&
      fromIntentionSlug !== updates.intentionSlug &&
      previewTasks.filter(item => item.intentionSlug === fromIntentionSlug)
        .length > 1
    ) {
      const rememberedChoice = rememberedNewIntentionChoices[fromIntentionSlug];
      if (rememberedChoice === 'all') {
        applyImportIntentionUpdates(sourceId, updates, fromIntentionSlug);
        return;
      }
      if (rememberedChoice === 'one') {
        applyImportIntentionUpdates(sourceId, updates);
        return;
      }

      setPendingNewIntentionChange({
        sourceId,
        fromIntentionSlug,
        updates,
      });
      setRememberPendingNewIntentionChoice(false);
      setOpenIntentionSourceId(null);
      focusImportPage();
      return;
    }

    applyImportIntentionUpdates(sourceId, updates, undefined, keepPickerOpen);
  };

  const applyImportIntentionUpdates = (
    sourceId: string,
    updates: Partial<ImportPreviewTask>,
    fromIntentionSlug?: string,
    keepPickerOpen = false
  ) => {
    setPreviewTasks(currentTasks =>
      currentTasks.map(task => {
        if (fromIntentionSlug) {
          return task.intentionSlug === fromIntentionSlug
            ? { ...task, ...updates }
            : task;
        }

        return task.sourceId === sourceId ? { ...task, ...updates } : task;
      })
    );
    setSelectedSourceId(sourceId);
    if (keepPickerOpen) {
      setOpenIntentionSourceId(sourceId);
    } else {
      setOpenIntentionSourceId(null);
      focusImportPage();
    }
  };

  const includedCount = previewTasks.filter(task => task.include).length;
  const selectedTaskCount = previewTasks.length;
  const missingIntentionCount = previewTasks.filter(
    task => task.include && !task.intentionSlug
  ).length;
  const selectedTask =
    previewTasks.find(task => task.sourceId === selectedSourceId) ??
    previewTasks[0] ??
    null;
  const selectedTaskIndex = selectedTask
    ? previewTasks.findIndex(task => task.sourceId === selectedTask.sourceId)
    : -1;
  const pendingNewIntentionTaskCount = pendingNewIntentionChange
    ? previewTasks.filter(
        task =>
          task.intentionSlug === pendingNewIntentionChange.fromIntentionSlug
      ).length
    : 0;
  const pendingNewIntentionTitle = pendingNewIntentionChange
    ? getPendingNewIntentionTitle(
        previewTasks,
        pendingNewIntentionChange.fromIntentionSlug
      )
    : 'this new Intention';
  const pendingNewIntentionTargetTitle = pendingNewIntentionChange
    ? formatImportIntentionChangeTarget(
        pendingNewIntentionChange.updates,
        activeIntentions
      )
    : 'the selected Intention';
  const getPickerOptions = (task: ImportPreviewTask) => [
    ...getImportIntentionOptions(
      activeIntentions,
      task,
      newIntentionOptions
    ).map(option => ({
      value: option.value,
      title: option.title,
      emoji: option.emoji,
      isNew: option.isNew,
    })),
    {
      value: CREATE_INTENTION_ACTION_VALUE,
      title: t('intention.create'),
      emoji: '',
      icon: <FaPlus size={10} />,
      isAction: true,
    },
  ];
  const getPickerSubIntentions = (task: ImportPreviewTask) =>
    getSubIntentionsByParentForOptions(
      activeIntentions,
      getImportIntentionOptions(activeIntentions, task, newIntentionOptions)
    );
  const getPickerSelectedSubIntentions = (task: ImportPreviewTask) =>
    task.intentionSlug && task.subIntentionSlug
      ? { [task.intentionSlug]: task.subIntentionSlug }
      : {};
  const dismissMessage = (messageKey: string) => {
    setDismissedMessages(current => new Set(current).add(messageKey));
  };
  const isMessageDismissed = (messageKey: string) =>
    dismissedMessages.has(messageKey);

  const closePendingNewIntentionChange = () => {
    setPendingNewIntentionChange(null);
    setRememberPendingNewIntentionChoice(false);
    focusImportPage();
  };

  const rememberPendingNewIntentionDecision = (
    pending: NonNullable<typeof pendingNewIntentionChange>,
    choice: ReplaceNewIntentionChoice
  ) => {
    if (!rememberPendingNewIntentionChoice) {
      return;
    }

    setRememberedNewIntentionChoices(current => ({
      ...current,
      [pending.fromIntentionSlug]: choice,
    }));
  };

  const applyPendingNewIntentionToOne = () => {
    if (!pendingNewIntentionChange) {
      return;
    }

    const pending = pendingNewIntentionChange;
    rememberPendingNewIntentionDecision(pending, 'one');
    setPendingNewIntentionChange(null);
    setRememberPendingNewIntentionChoice(false);
    applyImportIntentionUpdates(pending.sourceId, pending.updates);
  };

  const applyPendingNewIntentionToAll = () => {
    if (!pendingNewIntentionChange) {
      return;
    }

    const pending = pendingNewIntentionChange;
    rememberPendingNewIntentionDecision(pending, 'all');
    setPendingNewIntentionChange(null);
    setRememberPendingNewIntentionChoice(false);
    applyImportIntentionUpdates(
      pending.sourceId,
      pending.updates,
      pending.fromIntentionSlug
    );
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      data-import-page
      role="region"
      aria-label={t('task.import')}
      className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 pb-3 pt-8">
        <IconButton
          label={t('common.back')}
          size="sm"
          variant="secondary"
          onClick={() => setShowExitConfirm(true)}
        >
          <FaArrowLeft />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{t('task.import')}</h1>
          <p className="truncate text-[11px] text-slate-500">
            {fileName
              ? `${fileName} · ${includedCount}/${selectedTaskCount} selected`
              : t('task.vikunjaExport')}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {previewTasks.length === 0 && (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700/70 bg-slate-950/40 px-4 py-5 text-sm font-medium text-slate-200 transition hover:border-indigo-500/60 hover:text-white">
              <FaFileImport size={14} />
              {t('task.chooseVikunjaExport')}
              <input
                type="file"
                accept="application/json,application/zip,application/x-zip-compressed,.json,.zip"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
          )}

          {error && !isMessageDismissed('error') && (
            <DismissibleAlert
              variant="error"
              onDismiss={() => dismissMessage('error')}
            >
              {error}
            </DismissibleAlert>
          )}
          {duplicatePreviewTasks.length > 0 &&
            !isMessageDismissed('duplicates') && (
              <DismissibleAlert
                variant="warning"
                title={`Already imported (${duplicatePreviewTasks.length})`}
                onDismiss={() => dismissMessage('duplicates')}
              >
                <ul className="space-y-1 text-xs">
                  {duplicatePreviewTasks.map(task => (
                    <li key={`${task.sourceId}-already-imported`}>
                      {task.title}{' '}
                      <span className="text-amber-100/65">
                        ({task.sourceId})
                      </span>
                    </li>
                  ))}
                </ul>
              </DismissibleAlert>
            )}
          {previewTasks.length > 0 && (
            <div className="space-y-2">
              {previewTasks.map(task => (
                <div
                  key={task.sourceId}
                  data-import-task-row
                  data-import-source-id={task.sourceId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedSourceId(task.sourceId)}
                  onFocus={() => setSelectedSourceId(task.sourceId)}
                  className={`rounded-lg border p-3 transition ${
                    selectedSourceId === task.sourceId
                      ? 'border-indigo-400/65 bg-indigo-950/20'
                      : 'border-slate-800/70 bg-slate-950/45'
                  } ${task.alreadyImported ? 'opacity-65' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-2">
                      <button
                        type="button"
                        aria-label={
                          task.include
                            ? `Skip ${task.title}`
                            : `Keep ${task.title}`
                        }
                        title={
                          task.include
                            ? `Skip ${task.title}`
                            : `Keep ${task.title}`
                        }
                        onClick={event => {
                          event.stopPropagation();
                          togglePreviewTask(task.sourceId);
                        }}
                        disabled={task.alreadyImported}
                        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] ${
                          task.include
                            ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-100'
                            : 'border-slate-700 text-slate-500'
                        } ${task.alreadyImported ? 'cursor-not-allowed' : 'hover:border-indigo-300/70'}`}
                      >
                        {task.include ? <FaCheck /> : <FaRegSquare />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 min-h-10 min-w-0 break-words text-sm font-semibold leading-5 text-slate-100">
                          {task.title}
                        </div>
                        <ImportTaskMetaLine
                          task={task}
                          intentions={activeIntentions}
                          showIntention={isDesktop}
                        />
                      </div>
                    </div>
                    {!isDesktop && (
                      <div
                        className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2"
                        onClick={event => event.stopPropagation()}
                      >
                        <IntentionAssignmentPicker
                          label={t('task.intention')}
                          showLabel={false}
                          allowClear={false}
                          options={getPickerOptions(task)}
                          subIntentionsByParent={getPickerSubIntentions(task)}
                          selectedIntentions={
                            task.intentionSlug ? [task.intentionSlug] : []
                          }
                          selectedSubIntentions={getPickerSelectedSubIntentions(
                            task
                          )}
                          mode="single"
                          isOpen={openIntentionSourceId === task.sourceId}
                          onOpenChange={open =>
                            setImportIntentionPickerOpen(task.sourceId, open)
                          }
                          onChange={change =>
                            handleImportIntentionChange(task.sourceId, change)
                          }
                          onAction={(option, context) =>
                            handleImportIntentionAction(
                              task.sourceId,
                              option,
                              context
                            )
                          }
                          disabled={!task.include}
                          returnFocusOnClose={false}
                          direction="down"
                          maxHeight={260}
                          triggerClassName="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-700/50 bg-slate-900 px-2 text-left text-xs text-slate-100 outline-none transition-colors hover:bg-slate-800 focus:border-indigo-400/60 disabled:opacity-60"
                          optionDataAttribute="data-import-intention-option"
                          listDataAttribute="data-import-intention-list"
                          triggerDataAttribute="data-import-intention-trigger"
                        />
                        <ToolbarButton
                          label={t('common.edit')}
                          shortcut="E"
                          onClick={() =>
                            setSettingsSourceId(current =>
                              current === task.sourceId ? null : task.sourceId
                            )
                          }
                          disabled={!task.include}
                          compact
                        >
                          <FaCog size={11} />
                        </ToolbarButton>
                      </div>
                    )}
                    {settingsSourceId === task.sourceId && (
                      <TaskImportSettings
                        task={task}
                        onUpdate={updates =>
                          updateTaskSettings(task.sourceId, updates)
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {previewTasks.length > 0 && (
        <div className="shrink-0 border-t border-slate-800 bg-slate-950 px-4 py-3">
          <div
            className={`mx-auto max-w-3xl gap-2 ${
              isDesktop
                ? 'grid md:grid-cols-[minmax(0,1fr)_auto]'
                : 'flex justify-end'
            }`}
          >
            {isDesktop && (
              <div
                className="min-w-0 rounded-md border border-slate-800/70 bg-slate-900/45 px-2.5 py-2"
                data-import-focus-bar
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-1.5">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {t('task.focus')}
                    </div>
                    <div className="truncate text-xs font-medium text-slate-100">
                      {selectedTask?.title ?? t('task.noSelected')}
                    </div>
                  </div>
                  <ToolbarButton
                    label={t('common.previous')}
                    shortcut="↑"
                    onClick={() => focusPreviewTask(-1)}
                    disabled={selectedTaskIndex <= 0}
                    compact
                  >
                    <FaArrowUp size={11} />
                  </ToolbarButton>
                  <ToolbarButton
                    label={t('common.next')}
                    shortcut="↓"
                    onClick={() => focusPreviewTask(1)}
                    disabled={
                      selectedTaskIndex < 0 ||
                      selectedTaskIndex >= previewTasks.length - 1
                    }
                    compact
                  >
                    <FaArrowDown size={11} />
                  </ToolbarButton>
                  <ToolbarButton
                    label={
                      selectedTask?.include ? t('task.keep') : t('task.skip')
                    }
                    shortcut="Space"
                    onClick={() =>
                      selectedTask
                        ? togglePreviewTask(selectedTask.sourceId)
                        : null
                    }
                    disabled={!selectedTask || selectedTask.alreadyImported}
                    compact
                  >
                    {selectedTask?.include ? (
                      <FaCheck size={11} />
                    ) : (
                      <FaRegSquare size={11} />
                    )}
                  </ToolbarButton>
                </div>

                <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                  {selectedTask && (
                    <IntentionAssignmentPicker
                      label={t('task.intention')}
                      showLabel={false}
                      allowClear={false}
                      options={getPickerOptions(selectedTask)}
                      subIntentionsByParent={getPickerSubIntentions(
                        selectedTask
                      )}
                      selectedIntentions={
                        selectedTask.intentionSlug
                          ? [selectedTask.intentionSlug]
                          : []
                      }
                      selectedSubIntentions={getPickerSelectedSubIntentions(
                        selectedTask
                      )}
                      mode="single"
                      isOpen={openIntentionSourceId === selectedTask.sourceId}
                      onOpenChange={open =>
                        setImportIntentionPickerOpen(
                          selectedTask.sourceId,
                          open
                        )
                      }
                      onChange={change =>
                        handleImportIntentionChange(
                          selectedTask.sourceId,
                          change
                        )
                      }
                      onAction={(option, context) =>
                        handleImportIntentionAction(
                          selectedTask.sourceId,
                          option,
                          context
                        )
                      }
                      disabled={!selectedTask}
                      returnFocusOnClose={false}
                      shortcut="I"
                      direction="up"
                      maxHeight={220}
                      triggerClassName="relative flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-700/50 bg-slate-950/70 px-2 text-left text-xs text-slate-100 outline-none transition-colors hover:bg-slate-900 focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/35 disabled:cursor-not-allowed disabled:opacity-60"
                      optionDataAttribute="data-import-intention-option"
                      listDataAttribute="data-import-intention-list"
                      triggerDataAttribute="data-import-intention-trigger"
                    />
                  )}

                  <ToolbarButton
                    label={t('common.edit')}
                    shortcut="E"
                    onClick={() =>
                      selectedTask
                        ? setSettingsSourceId(current =>
                            current === selectedTask.sourceId
                              ? null
                              : selectedTask.sourceId
                          )
                        : null
                    }
                    disabled={!selectedTask}
                    compact
                  >
                    <FaCog size={11} />
                  </ToolbarButton>
                </div>
              </div>
            )}

            <div className="flex items-end justify-end gap-1.5">
              <Button
                size="sm"
                isLoading={isReviewing}
                loadingText="..."
                onClick={handleReviewImport}
                disabled={
                  isReviewing ||
                  previewTasks.length === 0 ||
                  includedCount === 0 ||
                  missingIntentionCount > 0
                }
                className="relative h-8 gap-1.5 px-3 text-xs"
              >
                <FaFileImport size={11} />
                Import
                <KeyboardShortcut
                  text="↵"
                  showModIcon={false}
                  alwaysShow
                  position="topRight"
                />
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={Boolean(createIntentionTask)}
        onClose={requestCloseCreateImportIntentionModal}
        title={t('intention.new')}
        closeOnBackdropClick={!isCreatingIntention}
        closeOnEscape={!isCreatingIntention}
      >
        <form
          className="space-y-4"
          onSubmit={handleSubmitCreateImportIntention}
        >
          <p className="text-sm text-slate-300">
            Create an Intention for{' '}
            <span className="font-medium text-slate-100">
              {createIntentionTask?.title ?? 'this Task'}
            </span>
            .
          </p>
          <div className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {t('common.emoji')}
              <input
                type="text"
                value={createIntentionEmoji}
                onChange={event => setCreateIntentionEmoji(event.target.value)}
                maxLength={4}
                autoFocus
                className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-2 text-center text-lg normal-case tracking-normal text-slate-100 outline-none transition-colors focus:border-indigo-400/70"
              />
            </label>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {t('common.title')}
              <input
                type="text"
                value={createIntentionTitle}
                onChange={event => setCreateIntentionTitle(event.target.value)}
                className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition-colors focus:border-indigo-400/70"
              />
            </label>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:col-span-2">
              {t('intention.parent')}
              <select
                value={createParentIntentionId ?? ''}
                onChange={event =>
                  setCreateParentIntentionId(event.target.value || null)
                }
                className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition-colors focus:border-indigo-400/70"
              >
                <option value="">{t('common.topLevel')}</option>
                {createParentIntentionOptions.map(parent => (
                  <option key={parent.id} value={parent.id}>
                    {parent.emoji} {parent.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={requestCloseCreateImportIntentionModal}
              disabled={isCreatingIntention}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={isCreatingIntention}
              loadingText={t('common.creating')}
              disabled={
                !createIntentionTitle.trim() || !createIntentionEmoji.trim()
              }
            >
              {t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>

      <UnsavedChangesDialog
        isOpen={showCreateIntentionDiscardConfirm}
        title={t('intention.discardChanges')}
        message={t('intention.discardMessage')}
        stayLabel={t('common.stay')}
        discardLabel={t('common.discard')}
        onStay={() => setShowCreateIntentionDiscardConfirm(false)}
        onDiscard={closeCreateImportIntentionModal}
      />

      <Modal
        isOpen={showImportConfirm}
        onClose={() => setShowImportConfirm(false)}
        title={t('task.importSelected')}
        closeOnBackdropClick={!isReviewing}
        closeOnEscape={false}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            {t('task.importSelectedDescription', {
              count: includedCount,
              file: fileName,
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowImportConfirm(false)}
              disabled={isReviewing}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleConfirmImport}
              isLoading={isReviewing}
              loadingText={t('task.importing')}
            >
              {t('task.importAction')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(pendingNewIntentionChange)}
        onClose={closePendingNewIntentionChange}
        title={t('task.replaceIntention')}
        closeOnBackdropClick
        closeOnEscape
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            {t('task.replaceIntentionDescription', {
              title: pendingNewIntentionTitle,
              count: pendingNewIntentionTaskCount,
              target: pendingNewIntentionTargetTitle,
            })}
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={rememberPendingNewIntentionChoice}
              onChange={event =>
                setRememberPendingNewIntentionChoice(event.target.checked)
              }
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-400/50"
            />
            {t('task.dontAskAgain')}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={applyPendingNewIntentionToOne}>
              {t('task.onlyThis')}
            </Button>
            <Button onClick={applyPendingNewIntentionToAll}>
              {t('common.changeAll')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showExitConfirm}
        onClose={() => setShowExitConfirm(false)}
        title={t('task.leaveImport')}
        closeOnBackdropClick
        closeOnEscape={false}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            {t('task.leaveImportDescription')}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowExitConfirm(false)}
            >
              {t('common.stay')}
            </Button>
            <Button variant="danger" onClick={handleExitImport}>
              {t('common.leave')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ToolbarButton({
  label,
  shortcut,
  children,
  onClick,
  disabled,
  compact,
}: {
  label: string;
  shortcut: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={`relative h-8 gap-1.5 px-2 text-xs ${
        compact ? 'min-w-[3.15rem]' : ''
      }`}
    >
      {children}
      {label}
      <KeyboardShortcut
        text={shortcut}
        showModIcon={false}
        alwaysShow
        position="topRight"
      />
    </Button>
  );
}

function ImportTaskRecurrenceLabel({ task }: { task: ImportPreviewTask }) {
  const recurrence = getImportTaskRecurrenceMeta(task);
  if (!recurrence) {
    return null;
  }

  if (!recurrence.compactLabel) {
    return <span title={recurrence.label}>{recurrence.label}</span>;
  }

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 truncate text-cyan-300/85"
      title={recurrence.label}
    >
      <FaRedo aria-hidden="true" className="shrink-0 text-[10px]" />
      <span className="truncate">{recurrence.compactLabel}</span>
    </span>
  );
}

function getImportTaskRecurrenceMeta(task: ImportPreviewTask) {
  const label = formatTaskRecurrence(
    task.recurrenceRule,
    task.recurrenceAnchorMode,
    task.recurrenceInterval
  );
  if (!label) {
    return null;
  }

  return {
    label,
    compactLabel: formatCompactTaskRecurrence(
      task.recurrenceRule,
      task.recurrenceInterval
    ),
  };
}

function ImportTaskMetaLine({
  task,
  intentions,
  showIntention,
}: {
  task: ImportPreviewTask;
  intentions: Intention[];
  showIntention: boolean;
}) {
  const { t } = useI18n();
  const recurrence = getImportTaskRecurrenceMeta(task);
  const items: ReactNode[] = [
    showIntention ? (
      <span className="font-medium text-slate-300">
        {formatSelectedIntention(task, intentions)}
      </span>
    ) : null,
    task.dueDate ? (
      <span>
        {task.dueDate}
        {task.dueTime ? ` ${task.dueTime}` : ''}
      </span>
    ) : null,
    recurrence ? <ImportTaskRecurrenceLabel task={task} /> : null,
    <span className="capitalize">{task.priority}</span>,
    task.alreadyImported ? (
      <span className="rounded-full border border-amber-400/40 px-1.5 py-0.5 text-amber-200">
        {t('task.alreadyImported')}
      </span>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-y-1.5 text-[11px] leading-4 text-slate-400">
      {items.map((item, index) => (
        <span
          key={index}
          className="inline-flex min-w-0 items-center whitespace-nowrap"
        >
          {index > 0 ? (
            <span
              aria-hidden="true"
              className="mx-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-700"
            />
          ) : null}
          <span className="min-w-0 truncate">{item}</span>
        </span>
      ))}
    </div>
  );
}

function TaskImportSettings({
  task,
  onUpdate,
}: {
  task: ImportPreviewTask;
  onUpdate: (updates: Partial<ImportPreviewTask>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 grid gap-3 rounded-md border border-slate-800/70 bg-slate-950/55 p-3 sm:grid-cols-2">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:col-span-2">
        {t('common.title')}
        <input
          type="text"
          value={task.title}
          onChange={event => onUpdate({ title: event.target.value })}
          className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        />
      </label>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:col-span-2">
        {t('common.description')}
        <textarea
          value={task.description ?? ''}
          onChange={event =>
            onUpdate({ description: event.target.value || null })
          }
          rows={2}
          className="mt-1 w-full resize-y rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        />
      </label>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('task.priority')}
        <select
          value={task.priority}
          onChange={event =>
            onUpdate({ priority: event.target.value as TaskPriority })
          }
          className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        >
          <option value={TASK_PRIORITIES.LOW}>{t('common.low')}</option>
          <option value={TASK_PRIORITIES.NORMAL}>{t('common.normal')}</option>
          <option value={TASK_PRIORITIES.HIGH}>{t('common.high')}</option>
          <option value={TASK_PRIORITIES.URGENT}>{t('common.urgent')}</option>
        </select>
      </label>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('common.dueDate')}
        <input
          type="date"
          value={task.dueDate ?? ''}
          onChange={event => onUpdate({ dueDate: event.target.value || null })}
          className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        />
      </label>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('common.dueTime')}
        <input
          type="time"
          value={task.dueTime ?? ''}
          onChange={event => onUpdate({ dueTime: event.target.value || null })}
          className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        />
      </label>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('task.recurrence')}
        <input
          type="text"
          value={task.recurrenceRule ?? ''}
          onChange={event =>
            onUpdate({ recurrenceRule: event.target.value || null })
          }
          className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        />
      </label>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('task.recurrenceInterval')}
        <input
          type="number"
          min={1}
          step="any"
          value={task.recurrenceInterval ?? ''}
          onChange={event =>
            onUpdate({
              recurrenceInterval: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
          className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        />
      </label>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {t('task.repeatFrom')}
        <select
          value={task.recurrenceAnchorMode}
          onChange={event =>
            onUpdate({
              recurrenceAnchorMode: event.target
                .value as ImportPreviewTask['recurrenceAnchorMode'],
            })
          }
          className="mt-1 w-full rounded border border-slate-700/60 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-100"
        >
          <option value="planned">{t('common.dueDate')}</option>
          <option value="completion">{t('common.completion')}</option>
        </select>
      </label>
    </div>
  );
}

function DismissibleAlert({
  variant,
  title,
  children,
  onDismiss,
}: {
  variant: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  children: ReactNode;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <Alert variant={variant} title={title} className="pr-10">
        {children}
      </Alert>
      <button
        type="button"
        aria-label={t('task.dismissMessage')}
        title={t('common.dismiss')}
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded p-1 text-current opacity-70 transition hover:opacity-100"
      >
        <FaTimes size={12} />
      </button>
    </div>
  );
}

function serializeCreateIntentionForm(form: {
  title: string;
  emoji: string;
  type: TimerTypes;
  parentId: string | null;
}) {
  return JSON.stringify(form);
}

async function fetchExistingImportSourceIds() {
  const responses = await Promise.all([
    apiClient.tasks.list({ query: { status: TASK_STATUSES.ACTIVE } }),
    apiClient.tasks.list({ query: { status: TASK_STATUSES.COMPLETED } }),
    apiClient.tasks.list({ query: { status: TASK_STATUSES.ARCHIVED } }),
  ]);

  return new Set(
    responses
      .flatMap(response => (response.status === 200 ? response.body : []))
      .filter(
        task =>
          task.importSource === TASK_IMPORT_SOURCES.VIKUNJA &&
          task.importSourceTaskId
      )
      .map(task => task.importSourceTaskId as string)
  );
}

async function readVikunjaExportFile(file: File, missingDataMessage: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip =
    file.name.toLowerCase().endsWith('.zip') ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b);

  if (!isZip) {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }

  const entries = unzipSync(bytes);
  const dataEntry =
    entries['data.json'] ??
    Object.entries(entries).find(([path]) => path.endsWith('/data.json'))?.[1];

  if (!dataEntry) {
    throw new Error(missingDataMessage);
  }

  return JSON.parse(strFromU8(dataEntry)) as unknown;
}

function parseVikunjaPreviewTasks(source: unknown) {
  const tasks: ImportPreviewTask[] = [];
  const seen = new Set<string>();

  walkVikunjaExport(source, { projectTitle: null }, tasks, seen);

  return tasks;
}

function buildNewIntentionValue(title: string, timerType: TimerTypes) {
  return `${NEW_INTENTION_PREFIX}${timerType}:${normalizeNewIntentionTitle(title)}`;
}

function normalizeNewIntentionTitle(title: string) {
  return title.trim().toLowerCase();
}

function hydrateImportTaskIntention(
  task: ImportPreviewTask,
  intentions: Intention[]
): ImportPreviewTask {
  if (task.intentionSlug?.startsWith(NEW_INTENTION_PREFIX)) {
    const existingIntention = findParentIntentionByTitle(
      intentions,
      task.newIntentionTitle,
      task.timerType
    );
    if (existingIntention) {
      return {
        ...task,
        intentionSlug: existingIntention.slug,
        newIntentionTitle: null,
        newIntentionEmoji: null,
        newSubIntentionTitle: null,
      };
    }

    return task;
  }

  if (task.intentionSlug) {
    return task;
  }

  const existingIntention = findBestExistingIntention(task, intentions);
  if (existingIntention) {
    return {
      ...task,
      intentionSlug: existingIntention.slug,
      newIntentionTitle: null,
      newIntentionEmoji: null,
      newSubIntentionTitle: null,
    };
  }

  const newTitle = task.projectTitle ?? task.labels[0] ?? 'Imported Tasks';
  return {
    ...task,
    intentionSlug: buildNewIntentionValue(newTitle, task.timerType),
    newIntentionTitle: newTitle,
    newIntentionEmoji: getDefaultImportIntentionEmoji(newTitle),
    newSubIntentionTitle: null,
  };
}

function findBestExistingIntention(
  task: ImportPreviewTask,
  intentions: Intention[]
) {
  const candidates = [
    task.projectTitle,
    task.newIntentionTitle,
    ...task.labels,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const match = findParentIntentionByTitle(
      intentions,
      candidate,
      task.timerType
    );
    if (match) {
      return match;
    }
  }

  return null;
}

function findParentIntentionByTitle(
  intentions: Intention[],
  title: string | null,
  timerType: TimerTypes
) {
  if (!title) {
    return null;
  }

  const normalizedTitle = normalizeNewIntentionTitle(title);
  return (
    getParentIntentionOptions(intentions, timerType).find(
      intention =>
        normalizeNewIntentionTitle(intention.title) === normalizedTitle
    ) ?? null
  );
}

function findSubIntentionByTitle(
  intentions: Intention[],
  title: string | null,
  parentIntentionId: string,
  timerType: TimerTypes
) {
  if (!title) {
    return null;
  }

  const normalizedTitle = normalizeNewIntentionTitle(title);
  return (
    intentions.find(
      intention =>
        intention.parentIntentionId === parentIntentionId &&
        intention.type === timerType &&
        normalizeNewIntentionTitle(intention.title) === normalizedTitle
    ) ?? null
  );
}

function getImportIntentionOptions(
  intentions: Intention[],
  task: ImportPreviewTask,
  newIntentionOptions: NewIntentionOption[]
): ImportIntentionOption[] {
  const existingOptions = getParentIntentionOptions(
    intentions,
    task.timerType
  ).map(intention => ({
    value: intention.slug,
    title: intention.title,
    emoji: intention.emoji,
    timerType: intention.type,
    isNew: false,
  }));
  const newOptions = newIntentionOptions
    .filter(option => option.timerType === task.timerType)
    .map(option => ({ ...option, isNew: true }));

  const options = [...existingOptions, ...newOptions];
  if (
    task.intentionSlug?.startsWith(NEW_INTENTION_PREFIX) &&
    task.newIntentionTitle &&
    !options.some(option => option.value === task.intentionSlug)
  ) {
    options.push({
      value: task.intentionSlug,
      title: task.newIntentionTitle,
      emoji:
        task.newIntentionEmoji ??
        getDefaultImportIntentionEmoji(task.newIntentionTitle),
      timerType: task.timerType,
      isNew: true,
    });
  }

  return options;
}

function getIntentionSelectionUpdates(
  option: ImportIntentionOption
): Partial<ImportPreviewTask> {
  return {
    intentionSlug: option.value,
    subIntentionSlug: null,
    newIntentionTitle: option.isNew ? option.title : null,
    newIntentionEmoji: option.isNew ? option.emoji : null,
    newSubIntentionTitle: null,
  };
}

function getCreatableNewIntentionTitle(task: ImportPreviewTask) {
  return (
    task.newIntentionTitle ?? task.projectTitle ?? task.labels[0] ?? task.title
  );
}

function formatSelectedIntention(
  task: ImportPreviewTask,
  intentions: Intention[]
) {
  if (task.intentionSlug?.startsWith(NEW_INTENTION_PREFIX)) {
    return `New: ${task.newIntentionEmoji ?? ''} ${
      task.newIntentionTitle ?? 'Imported Tasks'
    }`;
  }

  const intention = intentions.find(item => item.slug === task.intentionSlug);
  const subIntention = intentions.find(
    item => item.slug === task.subIntentionSlug
  );
  if (!intention) {
    return 'No Intention';
  }

  return `${intention.emoji} ${intention.title}${
    subIntention ? ` / ${subIntention.emoji} ${subIntention.title}` : ''
  }`;
}

function formatImportIntentionChangeTarget(
  updates: Partial<ImportPreviewTask>,
  intentions: Intention[]
) {
  if (updates.intentionSlug?.startsWith(NEW_INTENTION_PREFIX)) {
    return `New: ${updates.newIntentionEmoji ?? ''} ${
      updates.newIntentionTitle ?? 'Imported Tasks'
    }`;
  }

  const intention = intentions.find(
    item => item.slug === updates.intentionSlug
  );
  if (!intention) {
    return 'No Intention';
  }

  return `${intention.emoji} ${intention.title}`;
}

function getActiveImportIntentionSearchText() {
  const input = document.querySelector(
    '[data-import-intention-list] input[type="search"]'
  );

  return input instanceof HTMLInputElement ? input.value.trim() : '';
}

function isFormTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)
  );
}

function getSelectedNewIntention(
  task: ImportPreviewTask,
  options: NewIntentionOption[]
) {
  if (!task.intentionSlug?.startsWith(NEW_INTENTION_PREFIX)) {
    return null;
  }

  return (
    options.find(option => option.value === task.intentionSlug) ??
    (task.newIntentionTitle
      ? {
          value: task.intentionSlug,
          title: task.newIntentionTitle,
          emoji:
            task.newIntentionEmoji ??
            getDefaultImportIntentionEmoji(task.newIntentionTitle),
          timerType: task.timerType,
        }
      : null)
  );
}

function getDefaultImportIntentionEmoji(title: string) {
  const normalizedTitle = title.toLowerCase();
  if (/(health|doctor|clinic|medical|sport|fitness)/.test(normalizedTitle)) {
    return '🏥';
  }
  if (/(home|house|clean|chores|groceries)/.test(normalizedTitle)) {
    return '🏠';
  }
  if (/(money|finance|bank|rent|tax|crypto)/.test(normalizedTitle)) {
    return '💰';
  }
  if (/(computer|code|pomi|work|project)/.test(normalizedTitle)) {
    return '💻';
  }
  return '✨';
}

function walkVikunjaExport(
  value: unknown,
  context: VikunjaContext,
  tasks: ImportPreviewTask[],
  seen: Set<string>
) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => walkVikunjaExport(item, context, tasks, seen));
    return;
  }

  const record = value as Record<string, unknown>;
  const nextContext = getNextContext(record, context);
  const task = toPreviewTask(record, nextContext);
  if (task && !seen.has(task.sourceId)) {
    seen.add(task.sourceId);
    tasks.push(task);
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === 'tasks' || key === 'list' || key === 'projects') {
      walkVikunjaExport(child, nextContext, tasks, seen);
    } else if (Array.isArray(child) || (child && typeof child === 'object')) {
      walkVikunjaExport(child, nextContext, tasks, seen);
    }
  }
}

function getNextContext(
  record: Record<string, unknown>,
  context: VikunjaContext
): VikunjaContext {
  const title = getString(record.title) ?? getString(record.name);
  const hasTaskChildren = Array.isArray(record.tasks);
  if (!hasTaskChildren || !title || isVikunjaTaskLike(record)) {
    return context;
  }

  return { projectTitle: title };
}

function toPreviewTask(
  record: Record<string, unknown>,
  context: VikunjaContext
): ImportPreviewTask | null {
  if (!isVikunjaTaskLike(record) || isDone(record)) {
    return null;
  }

  const title = getString(record.title) ?? getString(record.text);
  const sourceId = getStringOrNumber(record.id) ?? getString(record.identifier);
  if (!title || !sourceId) {
    return null;
  }

  const { dueDate, dueTime } = parseDueDate(record);
  const recurrenceRule = parseVikunjaRecurrenceRule(record);
  const recurrenceAnchorMode = parseRecurrenceAnchorMode(record);
  const labels = parseLabels(record.labels);
  const projectTitle =
    getString(record.projectTitle) ??
    getString(getNestedValue(record.project, 'title')) ??
    context.projectTitle;
  const description =
    getString(record.description) ??
    getString(record.notes) ??
    getString(getNestedValue(record.content, 'description'));
  const markdownDescription = normalizeVikunjaDescription(description);

  return {
    sourceId,
    title,
    projectTitle,
    labels,
    dueDate,
    dueTime,
    priority: mapVikunjaPriority(record.priority),
    description: markdownDescription,
    recurrenceRule,
    recurrenceInterval: null,
    recurrenceAnchorMode,
    timerType: TIMER_TYPES.WORK,
    intentionSlug: null,
    subIntentionSlug: null,
    newIntentionTitle: null,
    newIntentionEmoji: null,
    newSubIntentionTitle: null,
    alreadyImported: false,
    include: true,
  };
}

function parseRecurrenceAnchorMode(
  record: Record<string, unknown>
): 'planned' | 'completion' {
  if (
    parseNumber(record.repeat_mode) === VIKUNJA_REPEAT_MODE_FROM_CURRENT_DATE
  ) {
    return 'completion';
  }

  const repeatFrom = getString(record.repeat_from)?.toLowerCase();
  return repeatFrom === 'done' || repeatFrom === 'completion'
    ? 'completion'
    : 'planned';
}

function parseVikunjaRecurrenceRule(record: Record<string, unknown>) {
  const directRule = getString(record.rrule);
  if (directRule) {
    const normalized = normalizeVikunjaRRule(directRule);
    if (normalized) {
      return normalized;
    }
  }

  const repeatAfter = parseNumber(record.repeat_after);
  if (parseNumber(record.repeat_mode) === VIKUNJA_REPEAT_MODE_MONTH) {
    return 'FREQ=MONTHLY;INTERVAL=1';
  }

  if (repeatAfter !== null && repeatAfter > 0) {
    const daySeconds = 24 * 60 * 60;
    const weekSeconds = daySeconds * 7;

    if (repeatAfter % weekSeconds === 0) {
      return `FREQ=WEEKLY;INTERVAL=${Math.max(1, repeatAfter / weekSeconds)}`;
    }

    if (repeatAfter % daySeconds === 0) {
      return `FREQ=DAILY;INTERVAL=${Math.max(1, repeatAfter / daySeconds)}`;
    }
  }

  const repeatEvery = getString(record.repeat) ?? getString(record.repeatEvery);
  if (repeatEvery?.toLowerCase() === 'daily') {
    return 'FREQ=DAILY';
  }
  if (repeatEvery?.toLowerCase() === 'weekly') {
    return 'FREQ=WEEKLY';
  }
  if (repeatEvery?.toLowerCase() === 'monthly') {
    return 'FREQ=MONTHLY';
  }

  return null;
}

function normalizeVikunjaRRule(rule: string) {
  const normalized = rule.toUpperCase().trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('RRULE:')) {
    return normalized.slice('RRULE:'.length);
  }

  if (/^FREQ=(DAILY|WEEKLY|MONTHLY)(;[A-Z0-9=,_-]+)*$/.test(normalized)) {
    return normalized;
  }

  return null;
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function getSubIntentionOptions(
  intentions: Intention[],
  intentionSlug: string | null
) {
  const parent = intentions.find(intention => intention.slug === intentionSlug);
  if (!parent) {
    return [];
  }

  return intentions.filter(
    intention =>
      intention.parentIntentionId === parent.id &&
      intention.type === parent.type
  );
}

function getSubIntentionsByParentForOptions(
  intentions: Intention[],
  options: ImportIntentionOption[]
) {
  return Object.fromEntries(
    options
      .filter(option => !option.isNew)
      .map(option => [
        option.value,
        getSubIntentionOptions(intentions, option.value).map(subIntention => ({
          slug: subIntention.slug,
          title: subIntention.title,
          emoji: subIntention.emoji,
        })),
      ])
      .filter(([, subIntentions]) => subIntentions.length > 0)
  );
}

function getParentIntentionOptions(
  intentions: Intention[],
  timerType: TimerTypes
) {
  return intentions.filter(
    intention => !intention.parentIntentionId && intention.type === timerType
  );
}

export function getTaskEligibleImportIntentions(intentions: Intention[]) {
  const enabledParentIds = new Set(
    intentions
      .filter(
        intention =>
          !intention.parentIntentionId &&
          !intention.isArchived &&
          intention.allowsTasks !== false
      )
      .map(intention => intention.id)
  );
  return intentions.filter(
    intention =>
      !intention.isArchived &&
      intention.slug.trim().length > 0 &&
      intention.title.trim().length > 0 &&
      (intention.parentIntentionId
        ? enabledParentIds.has(intention.parentIntentionId)
        : intention.allowsTasks !== false)
  );
}

function isVikunjaTaskLike(record: Record<string, unknown>) {
  return (
    (typeof record.title === 'string' || typeof record.text === 'string') &&
    ('done' in record ||
      'due_date' in record ||
      'dueDate' in record ||
      'priority' in record ||
      'repeat_after' in record ||
      'labels' in record)
  );
}

function isDone(record: Record<string, unknown>) {
  if (record.done === false || record.is_done === false) {
    return false;
  }

  return (
    record.done === true ||
    record.is_done === true ||
    isMeaningfulVikunjaDate(getString(record.done_at)) ||
    getString(record.status)?.toLowerCase() === 'done'
  );
}

function getPendingNewIntentionTitle(
  tasks: ImportPreviewTask[],
  intentionSlug: string
) {
  const task = tasks.find(item => item.intentionSlug === intentionSlug);
  return task?.newIntentionTitle
    ? `New: ${task.newIntentionTitle}`
    : 'This new Intention';
}

function parseDueDate(record: Record<string, unknown>) {
  const rawDueDate =
    getString(record.due_date) ??
    getString(record.dueDate) ??
    getString(record.due);
  if (!rawDueDate || !isMeaningfulVikunjaDate(rawDueDate)) {
    return { dueDate: null, dueTime: null };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDueDate)) {
    return { dueDate: rawDueDate, dueTime: null };
  }

  const parsedDate = new Date(rawDueDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return { dueDate: rawDueDate.slice(0, 10), dueTime: null };
  }

  const hasTime = /T\d{2}:\d{2}/.test(rawDueDate);
  return {
    dueDate: parsedDate.toLocaleDateString('en-CA'),
    dueTime: hasTime ? parsedDate.toTimeString().slice(0, 5) : null,
  };
}

function isMeaningfulVikunjaDate(value: string | null) {
  if (!value) {
    return false;
  }

  return !/^0{4}-|^0001-01-01(?:T00:00:00(?:\.\d+)?Z?)?$/.test(value);
}

function parseLabels(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(label =>
      typeof label === 'string'
        ? label
        : (getString((label as Record<string, unknown>).title) ??
          getString((label as Record<string, unknown>).name))
    )
    .filter((label): label is string => Boolean(label));
}

function mapVikunjaPriority(value: unknown): TaskPriority {
  const priority = Number(value ?? 0);
  if (priority >= 5) return TASK_PRIORITIES.URGENT;
  if (priority >= 4) return TASK_PRIORITIES.HIGH;
  if (priority <= 1) return TASK_PRIORITIES.LOW;
  return TASK_PRIORITIES.NORMAL;
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeVikunjaDescription(description: string | null) {
  if (!description) {
    return null;
  }

  const trimmed = description.trim();
  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);
  const hasEntities = /&(?:[a-z]+|#\d+|#x[\da-f]+);/i.test(trimmed);

  if (!hasHtml) {
    return hasEntities ? decodeHtmlEntities(trimmed) : trimmed;
  }

  let markdown = trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text: string) => {
      return `\n# ${stripHtmlTags(text).trim()}\n`;
    })
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text: string) => {
      return `\n## ${stripHtmlTags(text).trim()}\n`;
    })
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text: string) => {
      return `\n### ${stripHtmlTags(text).trim()}\n`;
    })
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(
      /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, text: string) =>
        `[${stripHtmlTags(text).trim()}](${href.trim()})`
    )
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text: string) => {
      return `\n- ${stripHtmlTags(text).trim()}`;
    })
    .replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  markdown = stripHtmlTags(markdown)
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return markdown ? decodeHtmlEntities(markdown) : null;
}

function stripHtmlTags(value: string) {
  return value.replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (
      entity: string,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      named: string | undefined
    ) => {
      if (decimal) {
        return String.fromCodePoint(Number(decimal));
      }
      if (hexadecimal) {
        return String.fromCodePoint(parseInt(hexadecimal, 16));
      }

      const namedEntities: Record<string, string> = {
        amp: '&',
        apos: "'",
        gt: '>',
        lt: '<',
        nbsp: ' ',
        quot: '"',
      };

      return named ? (namedEntities[named.toLowerCase()] ?? entity) : entity;
    }
  );
}

function getStringOrNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return getString(value);
}

function getNestedValue(value: unknown, key: string) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return (value as Record<string, unknown>)[key];
}
