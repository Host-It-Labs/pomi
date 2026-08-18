import type {
  Intention,
  List,
  Preferences,
  Task,
  TaskPriority,
  TaskRecurrenceAnchorMode,
  Timer,
  TimerTypes,
} from '@pomi/shared';
import {
  TASK_FOLLOW_UP_DELAY_MAX_DAYS,
  TASK_PRIORITIES,
  TIMER_TYPES,
} from '@pomi/shared/src/constants';
import clsx from 'clsx';
import { FaArchive } from 'react-icons/fa';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { UnsavedChangesDialog } from '../ui/UnsavedChangesDialog';
import { showToastFromStore } from '../toast/ToastContext';
import { useI18n } from '../../i18n';
import {
  buildSimpleTaskRecurrence,
  parseSimpleTaskRecurrence,
  TaskRecurrenceFields,
  type TaskRecurrenceUnit,
} from './TaskRecurrenceFields';
import { TaskArchiveConfirmationModal } from './TaskArchiveConfirmationModal';

const TASK_PRIORITY_OPTIONS: Array<{ value: TaskPriority }> = [
  { value: TASK_PRIORITIES.LOW },
  { value: TASK_PRIORITIES.NORMAL },
  { value: TASK_PRIORITIES.HIGH },
  { value: TASK_PRIORITIES.URGENT },
];

type TaskMode = 'intention' | 'general';

const selectClassName =
  'h-[42px] w-full rounded border border-slate-700/40 bg-slate-800/40 px-3 py-2 text-sm text-white disabled:opacity-50';

const getDefaultDueDate = (preferences: Preferences | null | undefined) => {
  const mode = preferences?.taskDefaultDueDateMode ?? 'tomorrow';
  if (mode === 'off') return '';
  const days =
    mode === 'week'
      ? 7
      : mode === 'custom'
        ? (preferences?.taskDefaultDueDateDays ?? 1)
        : 1;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
};

type ListItemFormPayload = {
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  vacationEligible: boolean;
};
type TaskFormPayload = {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  timerType?: TimerTypes;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
  recurrenceRule?: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
  followUpTaskId?: string | null;
  followUpDelayDays?: number | null;
  vacationEligible?: boolean;
};

type TaskFormUpdatePayload = Partial<TaskFormPayload> & {
  id: string;
};

interface TaskFormModalProps {
  isOpen: boolean;
  task: Task | null;
  activeTasks?: Task[];
  intentions: Intention[];
  lists?: List[];
  preferences: Preferences | null | undefined;
  timer: Timer | null | undefined;
  taskMode: TaskMode;
  defaultIntentionSelection?: {
    intentionSlug: string;
    subIntentionSlug: string | null;
  } | null;
  defaultTimerType?: TimerTypes;
  initialTitle?: string;
  onClose: () => void;
  onCreate: (task: TaskFormPayload) => Promise<boolean>;
  onUpdate: (task: TaskFormUpdatePayload) => Promise<boolean>;
  onArchive: (task: Task) => Promise<boolean>;
  onCreateListItem?: (
    listId: string,
    item: ListItemFormPayload
  ) => Promise<boolean>;
  onConvertToListItem?: (
    taskId: string,
    listId: string,
    item: ListItemFormPayload
  ) => Promise<boolean>;
}

export function TaskFormModal({
  isOpen,
  task,
  activeTasks,
  intentions,
  lists,
  preferences,
  timer,
  taskMode,
  defaultIntentionSelection,
  defaultTimerType,
  initialTitle,
  onClose,
  onCreate,
  onUpdate,
  onArchive,
  onCreateListItem,
  onConvertToListItem,
}: TaskFormModalProps) {
  const { t } = useI18n();
  const availableLists = lists ?? [];
  const currentTimerType = timer?.type;
  const currentTimerFocusedTaskCount = timer?.focusedTaskIds?.length ?? 0;
  const currentTimerIntention = timer?.intention ?? '';
  const currentTimerSubIntention = timer?.subIntention ?? '';
  const currentTimerIntentionSlugs = timer?.intentionSlugs;
  const currentTimerSubIntentions = timer?.subIntentions;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(() => getDefaultDueDate(preferences));
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(
    TASK_PRIORITIES.NORMAL
  );
  const [timerType, setTimerType] = useState<TimerTypes>(
    defaultTimerType ?? TIMER_TYPES.WORK
  );
  const [intentionSlug, setIntentionSlug] = useState('');
  const [subIntentionSlug, setSubIntentionSlug] = useState('');
  const [selectedListId, setSelectedListId] = useState('');
  const [recurrenceInterval, setRecurrenceInterval] = useState('');
  const [recurrenceUnit, setRecurrenceUnit] =
    useState<TaskRecurrenceUnit>('DAILY');
  const [recurrenceAnchorMode, setRecurrenceAnchorMode] =
    useState<TaskRecurrenceAnchorMode>('planned');
  const [recurrenceTouched, setRecurrenceTouched] = useState(false);
  const [followUpTaskId, setFollowUpTaskId] = useState('');
  const [followUpDelayDays, setFollowUpDelayDays] = useState('');
  const [vacationEligible, setVacationEligible] = useState(false);
  const [vacationEligibleTouched, setVacationEligibleTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialFormKey, setInitialFormKey] = useState('');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [dueDateError, setDueDateError] = useState('');
  const initializedFormKeyRef = useRef<string | null>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);

  const eligibleIntentions = useMemo(
    () =>
      intentions.filter(
        intention =>
          intention.type === timerType &&
          !intention.parentIntentionId &&
          intention.allowsTasks !== false
      ),
    [intentions, timerType]
  );
  const subIntentionsByParent = useMemo(
    () =>
      intentions
        .filter(
          intention =>
            intention.type === timerType &&
            Boolean(intention.parentIntention?.slug) &&
            eligibleIntentions.some(
              parent => parent.id === intention.parentIntentionId
            )
        )
        .reduce(
          (childrenByParent, intention) => {
            const parentSlug = intention.parentIntention?.slug;
            if (!parentSlug) {
              return childrenByParent;
            }

            childrenByParent[parentSlug] = [
              ...(childrenByParent[parentSlug] ?? []),
              {
                slug: intention.slug,
                title: intention.title,
                emoji: intention.emoji,
              },
            ];
            return childrenByParent;
          },
          {} as Record<
            string,
            Array<{ slug: string; title: string; emoji: string }>
          >
        ),
    [eligibleIntentions, intentions, timerType]
  );
  const followUpTaskOptions = useMemo(() => {
    const availableTasks = activeTasks ?? [];
    const selectedId = task?.followUpTaskId;
    return availableTasks.filter(
      candidate =>
        candidate.status === 'active' &&
        candidate.itemKind === 'task' &&
        candidate.id !== task?.id &&
        (candidate.id === selectedId ||
          (!candidate.followUpTaskId && !candidate.followUpSourceTaskId))
    );
  }, [activeTasks, task?.followUpTaskId, task?.id]);
  const selectedList =
    availableLists.find(list => list.id === selectedListId) ?? null;
  const isListDestination = selectedList !== null;
  const destinationValue = selectedListId
    ? `list:${selectedListId}`
    : intentionSlug
      ? `intention:${intentionSlug}:${subIntentionSlug}`
      : 'general';

  useEffect(() => {
    if (!isOpen) {
      initializedFormKeyRef.current = null;
      return;
    }

    const normalizedInitialTitle = initialTitle?.trim() ?? '';
    const initializationKey = task
      ? `task:${task.id}`
      : `create:${normalizedInitialTitle}`;
    if (initializedFormKeyRef.current === initializationKey) {
      return;
    }
    initializedFormKeyRef.current = initializationKey;
    setDueDateError('');

    if (task) {
      const recurrence = parseSimpleTaskRecurrence(
        task.recurrenceRule,
        task.recurrenceInterval
      ) ?? { interval: '', unit: 'DAILY' as TaskRecurrenceUnit };
      setTitle(task.title);
      setDescription(task.description ?? '');
      setDueDate(task.dueDate ?? '');
      setDueDateTouched(false);
      setDueTime(task.dueTime ?? '');
      setPriority(task.priority);
      setTimerType(task.timerType);
      setIntentionSlug(task.intentionSlug ?? '');
      setSubIntentionSlug(task.subIntentionSlug ?? '');
      setSelectedListId('');
      setRecurrenceInterval(recurrence.interval);
      setRecurrenceUnit(recurrence.unit);
      setRecurrenceAnchorMode(task.recurrenceAnchorMode);
      setRecurrenceTouched(false);
      setFollowUpTaskId(task.followUpTaskId ?? '');
      setFollowUpDelayDays(
        task.followUpDelayDays === null || task.followUpDelayDays === undefined
          ? ''
          : String(task.followUpDelayDays)
      );
      setVacationEligible(task.vacationEligible);
      setVacationEligibleTouched(false);
      setInitialFormKey(
        serializeTaskFormState({
          title: task.title,
          description: task.description ?? '',
          dueDate: task.dueDate ?? '',
          dueDateTouched: false,
          dueTime: task.dueTime ?? '',
          priority: task.priority,
          timerType: task.timerType,
          intentionSlug: task.intentionSlug ?? '',
          subIntentionSlug: task.subIntentionSlug ?? '',
          recurrenceInterval: recurrence.interval,
          recurrenceUnit: recurrence.unit,
          recurrenceAnchorMode: task.recurrenceAnchorMode,
          recurrenceTouched: false,
          followUpTaskId: task.followUpTaskId ?? '',
          followUpDelayDays:
            task.followUpDelayDays === null ||
            task.followUpDelayDays === undefined
              ? ''
              : String(task.followUpDelayDays),
          selectedListId: '',
          vacationEligible: task.vacationEligible,
          vacationEligibleTouched: false,
        })
      );
      return;
    }

    const nextTimerType =
      defaultTimerType ?? currentTimerType ?? TIMER_TYPES.WORK;
    const shouldDefaultToTimerIntention =
      !defaultIntentionSelection &&
      (taskMode === 'intention' || currentTimerFocusedTaskCount > 0);
    const defaultIntention =
      defaultIntentionSelection?.intentionSlug ??
      (shouldDefaultToTimerIntention && currentTimerType === nextTimerType
        ? (currentTimerIntentionSlugs?.[0] ?? currentTimerIntention)
        : '');
    const hasDefaultIntention =
      Boolean(defaultIntention) &&
      (intentions.length === 0 ||
        intentions.some(
          intention =>
            intention.slug === defaultIntention &&
            intention.type === nextTimerType &&
            !intention.parentIntentionId &&
            intention.allowsTasks !== false
        ));
    const defaultSubIntention = defaultIntentionSelection
      ? (defaultIntentionSelection.subIntentionSlug ?? '')
      : hasDefaultIntention
        ? (currentTimerSubIntentions?.[defaultIntention] ??
          (currentTimerIntention === defaultIntention
            ? currentTimerSubIntention
            : ''))
        : '';

    setTitle(normalizedInitialTitle);
    setDescription('');
    const defaultDueDate = getDefaultDueDate(preferences);
    setDueDate(defaultDueDate);
    setDueDateTouched(false);
    setDueTime('');
    setPriority(TASK_PRIORITIES.NORMAL);
    setTimerType(nextTimerType);
    setIntentionSlug(hasDefaultIntention ? defaultIntention : '');
    setSubIntentionSlug(defaultSubIntention);
    setSelectedListId('');
    setRecurrenceInterval('');
    setRecurrenceUnit('DAILY');
    setRecurrenceAnchorMode('planned');
    setRecurrenceTouched(false);
    setFollowUpTaskId('');
    setFollowUpDelayDays('');
    const inheritedVacationCoverage =
      intentions.find(
        intention =>
          intention.slug === defaultIntention && !intention.parentIntentionId
      )?.vacationDefault === true;
    setVacationEligible(inheritedVacationCoverage);
    setVacationEligibleTouched(false);
    setInitialFormKey(
      serializeTaskFormState({
        title: normalizedInitialTitle,
        description: '',
        dueDate: defaultDueDate,
        dueDateTouched: false,
        dueTime: '',
        priority: TASK_PRIORITIES.NORMAL,
        timerType: nextTimerType,
        intentionSlug: hasDefaultIntention ? defaultIntention : '',
        subIntentionSlug: defaultSubIntention,
        recurrenceInterval: '',
        recurrenceUnit: 'DAILY',
        recurrenceAnchorMode: 'planned',
        recurrenceTouched: false,
        followUpTaskId: '',
        followUpDelayDays: '',
        selectedListId: '',
        vacationEligible: inheritedVacationCoverage,
        vacationEligibleTouched: false,
      })
    );
  }, [
    currentTimerFocusedTaskCount,
    currentTimerIntention,
    currentTimerIntentionSlugs,
    currentTimerSubIntention,
    currentTimerSubIntentions,
    currentTimerType,
    defaultIntentionSelection,
    defaultTimerType,
    initialTitle,
    intentions,
    isOpen,
    preferences,
    task,
    taskMode,
  ]);

  useEffect(() => {
    if (!isOpen) {
      setShowDiscardConfirm(false);
      setShowArchiveConfirm(false);
      setShowConvertConfirm(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || task || vacationEligibleTouched) return;
    if (selectedList) {
      setVacationEligible(selectedList.vacationDefault);
      return;
    }
    const parent = eligibleIntentions.find(
      intention => intention.slug === intentionSlug
    );
    setVacationEligible(parent?.vacationDefault === true);
  }, [
    eligibleIntentions,
    intentionSlug,
    isOpen,
    selectedList,
    task,
    vacationEligibleTouched,
  ]);

  const saveForm = async (conversionConfirmed?: boolean) => {
    if (!title.trim()) return;

    if (task && selectedListId && conversionConfirmed !== true) {
      setShowConvertConfirm(true);
      return;
    }

    const recurrence =
      task && !recurrenceTouched
        ? {
            rule: task.recurrenceRule,
            interval: task.recurrenceInterval,
          }
        : buildSimpleTaskRecurrence(recurrenceInterval, recurrenceUnit);
    if (!selectedListId && recurrence.rule && !dueDate) {
      setDueDateError(t('task.recurringDueRequired'));
      requestAnimationFrame(() => {
        dueDateInputRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
        dueDateInputRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    const normalizedFollowUpTaskId =
      task?.followUpSourceTaskId || !followUpTaskId ? null : followUpTaskId;
    const normalizedFollowUpDelayDays = normalizedFollowUpTaskId
      ? Number(followUpDelayDays || '0')
      : null;
    if (
      normalizedFollowUpTaskId &&
      (normalizedFollowUpDelayDays === null ||
        !Number.isInteger(normalizedFollowUpDelayDays) ||
        normalizedFollowUpDelayDays < 0 ||
        normalizedFollowUpDelayDays > TASK_FOLLOW_UP_DELAY_MAX_DAYS)
    ) {
      showToastFromStore(
        `Follow-up delay must be a whole number of days from 0 to ${TASK_FOLLOW_UP_DELAY_MAX_DAYS}.`,
        'error'
      );
      return;
    }
    const taskPayload = {
      title: title.trim(),
      description: description.trim() || null,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      priority,
      timerType,
      intentionSlug: intentionSlug || null,
      subIntentionSlug: subIntentionSlug || null,
      recurrenceRule: recurrence.rule,
      recurrenceInterval: recurrence.interval,
      recurrenceAnchorMode,
      followUpTaskId: normalizedFollowUpTaskId,
      followUpDelayDays: normalizedFollowUpDelayDays,
      vacationEligible,
    };
    const listItemPayload: ListItemFormPayload = {
      title: title.trim(),
      dueDate: !task && !dueDateTouched ? null : dueDate || null,
      priority,
      vacationEligible,
    };

    setSaving(true);
    let didSave = false;
    try {
      didSave = selectedListId
        ? task
          ? ((await onConvertToListItem?.(
              task.id,
              selectedListId,
              listItemPayload
            )) ?? false)
          : ((await onCreateListItem?.(selectedListId, listItemPayload)) ??
            false)
        : task
          ? await onUpdate({ id: task.id, ...taskPayload })
          : await onCreate(taskPayload);
    } finally {
      setSaving(false);
    }
    if (didSave) onClose();
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void saveForm();
  };

  const currentFormKey = serializeTaskFormState({
    title,
    description,
    dueDate,
    dueDateTouched,
    dueTime,
    priority,
    timerType,
    intentionSlug,
    subIntentionSlug,
    recurrenceInterval,
    recurrenceUnit,
    recurrenceAnchorMode,
    recurrenceTouched,
    followUpTaskId,
    followUpDelayDays,
    selectedListId,
    vacationEligible,
    vacationEligibleTouched,
  });
  const hasUnsavedChanges = isOpen && currentFormKey !== initialFormKey;
  const closeForm = () => {
    if (saving) {
      return;
    }
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  };
  const discardFormChanges = () => {
    setShowDiscardConfirm(false);
    onClose();
  };
  const archiveTask = async () => {
    if (!task || archiving) return;
    setArchiving(true);
    const didArchive = await onArchive(task);
    setArchiving(false);
    if (didArchive) {
      setShowArchiveConfirm(false);
      onClose();
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={closeForm}
        title={task ? t('task.editTask') : t('task.addTask')}
        ariaLabel={task ? t('task.editTask') : t('task.addTask')}
        showCloseButton
        headerActions={
          task ? (
            <button
              type="button"
              aria-label={`Archive ${task.title}`}
              title={t('common.archive')}
              onClick={() => setShowArchiveConfirm(true)}
              disabled={saving || archiving}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
            >
              <FaArchive size={13} />
            </button>
          ) : null
        }
        closeOnBackdropClick={!saving}
        closeOnEscape={!saving && !showArchiveConfirm && !showConvertConfirm}
        className="max-h-[88vh] overflow-hidden !max-w-2xl"
      >
        <form
          className="flex min-h-0 max-h-[calc(88vh-8rem)] flex-col overflow-hidden"
          onSubmit={handleSubmit}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3 pr-1">
            <section className="space-y-3 rounded-xl border border-indigo-500/20 bg-indigo-950/15 p-3.5">
              <h3 className="text-sm font-semibold text-slate-100">
                {t('task.whatNeedsDoing')}
              </h3>
              <Input
                aria-label={t('task.taskTitle')}
                placeholder={t('task.taskTitle')}
                value={title}
                onChange={event => setTitle(event.target.value)}
                autoFocus
              />
              {!isListDestination && (
                <Field
                  label={t('common.description')}
                  help={t('task.markdownSupported')}
                >
                  <textarea
                    aria-label={t('task.taskDescription')}
                    placeholder={t('common.description')}
                    value={description}
                    onChange={event => setDescription(event.target.value)}
                    rows={3}
                    className="min-h-20 w-full resize-y rounded-md border border-slate-700/50 bg-slate-950/35 px-3 py-2 text-sm text-white transition-colors placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none"
                  />
                </Field>
              )}
            </section>

            <div className="grid grid-cols-1 items-start gap-3">
              <section className="space-y-3 rounded-xl border border-slate-800/75 bg-slate-950/20 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
                  {t('task.plan')}
                </h3>

                <Field
                  label={t('task.intentionOrList')}
                  help={t('task.chooseGeneralIntentionList')}
                >
                  <select
                    aria-label={t('task.intentionOrList')}
                    data-testid="task-intention-dropdown"
                    value={destinationValue}
                    disabled={saving}
                    className={selectClassName}
                    onChange={event => {
                      const value = event.target.value;
                      if (value.startsWith('list:')) {
                        setSelectedListId(value.slice('list:'.length));
                        setIntentionSlug('');
                        setSubIntentionSlug('');
                        return;
                      }
                      setSelectedListId('');
                      if (value === 'general') {
                        setIntentionSlug('');
                        setSubIntentionSlug('');
                        return;
                      }
                      const [, parentSlug, childSlug = ''] = value.split(':');
                      setIntentionSlug(parentSlug ?? '');
                      setSubIntentionSlug(childSlug);
                    }}
                  >
                    <option value="general">{t('task.general')}</option>
                    {eligibleIntentions.length > 0 && (
                      <optgroup label={t('intention.intentions')}>
                        {eligibleIntentions.flatMap(intention => {
                          const children =
                            subIntentionsByParent[intention.slug] ?? [];
                          return children.length > 0
                            ? children.map(child => (
                                <option
                                  key={`${intention.slug}:${child.slug}`}
                                  value={`intention:${intention.slug}:${child.slug}`}
                                >
                                  {intention.emoji} {intention.title} ›{' '}
                                  {child.emoji} {child.title}
                                </option>
                              ))
                            : [
                                <option
                                  key={intention.slug}
                                  value={`intention:${intention.slug}:`}
                                >
                                  {intention.emoji} {intention.title}
                                </option>,
                              ];
                        })}
                      </optgroup>
                    )}
                    {availableLists.length > 0 && (
                      <optgroup label={t('intention.lists')}>
                        {availableLists.map(list => (
                          <option key={list.id} value={`list:${list.id}`}>
                            {list.emoji ?? '📋'} {list.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </Field>

                {!isListDestination && (
                  <Field label={t('task.timerType')}>
                    <select
                      aria-label={t('task.timerType')}
                      value={timerType}
                      onChange={event => {
                        const nextType = event.target.value as TimerTypes;
                        if (intentionSlug) {
                          setIntentionSlug('');
                          setSubIntentionSlug('');
                          showToastFromStore(
                            t('task.intentionCleared'),
                            'info'
                          );
                        }
                        setTimerType(nextType);
                      }}
                      className={selectClassName}
                    >
                      <option value={TIMER_TYPES.WORK}>
                        {t('common.work')}
                      </option>
                      <option value={TIMER_TYPES.BREAK}>
                        {t('common.break')}
                      </option>
                      <option value={TIMER_TYPES.LONG_BREAK}>
                        {t('common.longBreak')}
                      </option>
                    </select>
                  </Field>
                )}

                <div className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
                  <Field
                    label={t('task.due')}
                    help={t('task.dueHelp')}
                    error={dueDateError}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Input
                        ref={dueDateInputRef}
                        aria-label={t('task.taskDueDate')}
                        aria-invalid={dueDateError ? true : undefined}
                        aria-describedby={
                          dueDateError ? 'task-due-date-error' : undefined
                        }
                        type="date"
                        value={dueDate}
                        onChange={event => {
                          setDueDate(event.target.value);
                          setDueDateTouched(true);
                          if (!event.target.value) setDueTime('');
                          if (event.target.value) setDueDateError('');
                        }}
                        className={clsx(
                          dueDateError &&
                            '!border-red-500/80 focus:!border-red-400'
                        )}
                      />
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                          setDueDate('');
                          setDueDateTouched(true);
                          setDueTime('');
                          setDueDateError('');
                        }}
                        disabled={Boolean(
                          recurrenceInterval ||
                          (task?.recurrenceRule && !recurrenceTouched)
                        )}
                        title={
                          recurrenceInterval ||
                          (task?.recurrenceRule && !recurrenceTouched)
                            ? t('task.recurringRequiresDueDate')
                            : t('task.clearDueDateTime')
                        }
                      >
                        {t('common.clear')}
                      </Button>
                    </div>
                  </Field>
                  {!isListDestination && (
                    <Field label={t('task.time')}>
                      <Input
                        aria-label={t('task.taskDueTime')}
                        type="time"
                        value={dueTime}
                        onChange={event => setDueTime(event.target.value)}
                      />
                    </Field>
                  )}
                </div>

                <Field label={t('task.priority')}>
                  <select
                    aria-label={t('task.priority')}
                    value={priority}
                    onChange={event =>
                      setPriority(event.target.value as TaskPriority)
                    }
                    className={selectClassName}
                  >
                    {TASK_PRIORITY_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {t(`common.${option.value}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-900/45 px-3 py-2.5 text-xs text-slate-300 transition hover:border-slate-700">
                  <span>
                    <span className="block font-medium text-slate-200">
                      {t('task.vacationCoverage')}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      {t('task.vacationCoverageDescription')}
                    </span>
                  </span>
                  <input
                    aria-label={t('task.vacationCoverage')}
                    type="checkbox"
                    checked={vacationEligible}
                    onChange={event => {
                      setVacationEligible(event.target.checked);
                      setVacationEligibleTouched(true);
                    }}
                    className="h-4 w-4 accent-indigo-500"
                  />
                </label>
              </section>

              {!isListDestination && (
                <section className="space-y-3 rounded-xl border border-slate-800/75 bg-slate-950/20 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
                    {t('task.repeat')}
                  </h3>
                  <Field label={t('task.cadence')} help={t('task.cadenceHelp')}>
                    <TaskRecurrenceFields
                      interval={recurrenceInterval}
                      unit={recurrenceUnit}
                      anchorMode={recurrenceAnchorMode}
                      onIntervalChange={value => {
                        setRecurrenceInterval(value);
                        setRecurrenceTouched(true);
                        if (!value) setDueDateError('');
                      }}
                      onUnitChange={value => {
                        setRecurrenceUnit(value);
                        setRecurrenceTouched(true);
                      }}
                      onAnchorModeChange={value => {
                        setRecurrenceAnchorMode(value);
                        setRecurrenceTouched(true);
                      }}
                      intervalAriaLabel={t('task.recurrenceInterval')}
                      unitAriaLabel={t('task.recurrenceUnit')}
                      compact={false}
                    />
                  </Field>
                </section>
              )}

              {!isListDestination && !task?.followUpSourceTaskId && (
                <section className="space-y-3 rounded-xl border border-slate-800/75 bg-slate-950/20 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
                    {t('task.afterCompletion')}
                  </h3>
                  <Field
                    label={t('task.followUp')}
                    help={t('task.followUpHelp')}
                  >
                    <select
                      aria-label={t('task.followUp')}
                      value={followUpTaskId}
                      disabled={saving}
                      className={selectClassName}
                      onChange={event => {
                        const nextTaskId = event.target.value;
                        setFollowUpTaskId(nextTaskId);
                        if (nextTaskId && !followUpDelayDays) {
                          setFollowUpDelayDays('0');
                        }
                        if (!nextTaskId) setFollowUpDelayDays('');
                      }}
                    >
                      <option value="">{t('common.noFollowUp')}</option>
                      {followUpTaskOptions.length > 0 && (
                        <optgroup label={t('task.activeTasks')}>
                          {followUpTaskOptions.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.title}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </Field>
                  {followUpTaskId && (
                    <Field
                      label={t('task.followUpDueAfter')}
                      help={t('task.followUpDueAfterHelp')}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={t('task.followUpDelay')}
                          type="number"
                          min={0}
                          max={TASK_FOLLOW_UP_DELAY_MAX_DAYS}
                          step={1}
                          value={followUpDelayDays}
                          disabled={saving}
                          onChange={event =>
                            setFollowUpDelayDays(event.target.value)
                          }
                          className="max-w-32"
                        />
                        <span className="text-xs text-slate-400">
                          {t('common.days')}
                        </span>
                      </div>
                    </Field>
                  )}
                </section>
              )}

              {!isListDestination && task?.followUpSourceTaskId && (
                <section className="space-y-2 rounded-xl border border-slate-800/75 bg-slate-950/20 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
                    {t('task.followUp')}
                  </h3>
                  <p className="text-xs leading-5 text-slate-400">
                    {t('task.followUpGeneratedNotice')}
                  </p>
                </section>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-slate-800 bg-slate-900/95 pt-3 backdrop-blur-sm">
            <Button variant="secondary" onClick={closeForm} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              isLoading={saving}
              loadingText={t('common.save')}
            >
              {task ? t('common.save') : t('common.create')}
            </Button>
          </div>
        </form>
      </Modal>
      <UnsavedChangesDialog
        isOpen={showDiscardConfirm}
        title={t('task.discardChanges')}
        message={t('task.discardChangesMessage')}
        stayLabel={t('common.stay')}
        discardLabel={t('common.discard')}
        onStay={() => setShowDiscardConfirm(false)}
        onDiscard={discardFormChanges}
      />
      <TaskArchiveConfirmationModal
        task={showArchiveConfirm ? task : null}
        isSaving={archiving}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={() => void archiveTask()}
      />
      <Modal
        isOpen={showConvertConfirm}
        onClose={() => setShowConvertConfirm(false)}
        title={t('task.moveToList')}
        closeOnBackdropClick={!saving}
        closeOnEscape={!saving}
      >
        <p className="text-sm leading-6 text-slate-300">
          {t('task.moveToListMessage')}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            onClick={() => setShowConvertConfirm(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setShowConvertConfirm(false);
              void saveForm(true);
            }}
            isLoading={saving}
            loadingText={t('task.moving')}
          >
            {t('task.moveToListAction')}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function serializeTaskFormState(state: {
  title: string;
  description: string;
  dueDate: string;
  dueDateTouched: boolean;
  dueTime: string;
  priority: TaskPriority;
  timerType: TimerTypes;
  intentionSlug: string;
  subIntentionSlug: string;
  recurrenceInterval: string;
  recurrenceUnit: TaskRecurrenceUnit;
  recurrenceAnchorMode: TaskRecurrenceAnchorMode;
  recurrenceTouched: boolean;
  followUpTaskId: string;
  followUpDelayDays: string;
  selectedListId: string;
  vacationEligible: boolean;
  vacationEligibleTouched: boolean;
}) {
  return JSON.stringify(state);
}

function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative space-y-1">
      <div className="flex items-center gap-1 text-xs font-medium text-slate-300">
        <span>{label}</span>
        {help && (
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-400 hover:border-indigo-500/60 hover:text-indigo-200"
            aria-label={`${label} help`}
            title={`${label} help`}
          >
            ?
          </button>
        )}
      </div>
      {children}
      {error && (
        <p
          id="task-due-date-error"
          role="alert"
          className="text-xs text-red-300"
        >
          {error}
        </p>
      )}
      {open && help && (
        <p
          role="note"
          className="absolute left-0 top-6 z-30 w-64 rounded-md border border-slate-700/70 bg-slate-950/95 px-3 py-2 text-xs leading-5 text-slate-300 shadow-xl shadow-black/30 backdrop-blur-sm"
        >
          {help}
        </p>
      )}
    </div>
  );
}
