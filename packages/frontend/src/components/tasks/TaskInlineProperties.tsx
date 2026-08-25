import type {
  Intention,
  Task,
  TaskPriority,
  TaskRecurrenceAnchorMode,
} from '@pomi/shared';
import clsx from 'clsx';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { FaCalendarAlt, FaRedo } from 'react-icons/fa';
import {
  formatCompactTaskDue,
  formatCompactTaskRecurrence,
  formatTaskDue,
  formatTaskRecurrence,
  getTaskPriorityBadgeClass,
} from '../../utils/taskUi';
import { Button } from '../ui/Button';
import {
  IntentionAssignmentPicker,
  type IntentionAssignmentPickerChange,
} from '../intentions/IntentionAssignmentPicker';
import {
  parseSimpleTaskRecurrence,
  TaskRecurrenceFields,
  type TaskRecurrenceUnit,
} from './TaskRecurrenceFields';
import { TaskIntentionBadge } from './TaskIntentionBadge';
import { useI18n } from '../../i18n';

type TaskInlineUpdate = {
  id: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: TaskPriority;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
  recurrenceRule?: string | null;
  recurrenceInterval?: number | null;
  recurrenceAnchorMode?: TaskRecurrenceAnchorMode;
};

type Props = {
  task: Task;
  intentions: Intention[];
  onUpdate: (update: TaskInlineUpdate) => Promise<boolean>;
  onOpenEditor: () => void;
  showIntention: boolean;
  compact: boolean;
  isOverdue: boolean;
};

const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
type PriorityMutationStatus = 'pending' | 'checking' | 'confirmed' | 'failed';

export function TaskInlineProperties({
  task,
  intentions,
  onUpdate,
  onOpenEditor,
  showIntention,
  compact,
  isOverdue,
}: Props) {
  const recurrenceLabel = formatTaskRecurrence(
    task.recurrenceRule,
    task.recurrenceAnchorMode,
    task.recurrenceInterval
  );
  const compactRecurrenceLabel = formatCompactTaskRecurrence(
    task.recurrenceRule,
    task.recurrenceInterval
  );

  return (
    <div
      className={clsx(
        'flex min-w-0 items-center gap-y-1',
        compact
          ? 'flex-nowrap gap-x-1 overflow-visible whitespace-nowrap'
          : 'flex-wrap gap-x-2 text-[10px] text-slate-500'
      )}
    >
      {showIntention ? (
        <TaskIntentionControl
          task={task}
          intentions={intentions}
          onUpdate={onUpdate}
          compact={compact}
        />
      ) : null}
      <TaskDueDateControl
        task={task}
        onUpdate={onUpdate}
        compact={compact}
        isOverdue={isOverdue}
      />
      {compactRecurrenceLabel && recurrenceLabel ? (
        <TaskRecurrenceControl
          task={task}
          label={compactRecurrenceLabel}
          detail={recurrenceLabel}
          onUpdate={onUpdate}
          onOpenEditor={onOpenEditor}
          compact={compact}
        />
      ) : null}
      <TaskPriorityControl task={task} onUpdate={onUpdate} compact={compact} />
    </div>
  );
}

function TaskDueDateControl({
  task,
  onUpdate,
  compact,
  isOverdue,
}: {
  task: Task;
  onUpdate: Props['onUpdate'];
  compact: boolean;
  isOverdue: boolean;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(task.dueDate ?? '');
  const [saving, setSaving] = useState(false);
  const dueLabel = formatTaskDue(task);
  const compactDueLabel = formatCompactTaskDue(task);

  useEffect(() => {
    if (!isOpen) setDraftDate(task.dueDate ?? '');
  }, [isOpen, task.dueDate]);

  const saveOnDismiss = async () => {
    if (saving) return;
    if (
      draftDate === (task.dueDate ?? '') ||
      (!draftDate && task.recurrenceRule)
    ) {
      setIsOpen(false);
      return;
    }

    setSaving(true);
    const didSave = await onUpdate(
      draftDate
        ? { id: task.id, dueDate: draftDate }
        : { id: task.id, dueDate: null, dueTime: null }
    );
    setSaving(false);
    if (didSave) setIsOpen(false);
  };

  const clear = async () => {
    if (task.recurrenceRule || saving) return;
    setSaving(true);
    const didSave = await onUpdate({
      id: task.id,
      dueDate: null,
      dueTime: null,
    });
    setSaving(false);
    if (didSave) setIsOpen(false);
  };

  return (
    <InlinePopover
      isOpen={isOpen}
      onOpenChange={(next, reason) => {
        if (next) {
          setDraftDate(task.dueDate ?? '');
          setIsOpen(true);
          return;
        }
        if (reason === 'escape') {
          setIsOpen(false);
          return;
        }
        void saveOnDismiss();
      }}
      trigger={
        <span
          className={clsx(
            'inline-flex h-5 min-w-0 items-center gap-1 rounded-full border px-1.5 leading-none',
            compact ? 'max-w-[5.5rem] text-[9px]' : 'text-[10px]',
            isOverdue
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : 'border-slate-700/50 bg-slate-800/35 text-slate-400',
            !compactDueLabel && 'border-transparent bg-transparent px-1'
          )}
        >
          <FaCalendarAlt
            aria-hidden="true"
            className={clsx(
              'shrink-0 text-[9px]',
              !compactDueLabel && 'text-slate-600'
            )}
          />
          {compactDueLabel ? (
            <span className="truncate">{compactDueLabel}</span>
          ) : null}
        </span>
      }
      triggerLabel={t('task.changeDueDateFor', { title: task.title })}
      triggerTitle={dueLabel}
      direction={compact ? 'up' : 'auto'}
    >
      <div className="w-64 space-y-3" data-testid="task-due-date-popover">
        <label className="block space-y-1 text-xs text-slate-300">
          <span>{t('common.dueDate')}</span>
          <input
            type="date"
            value={draftDate}
            onChange={event => {
              if (!event.target.value && task.recurrenceRule) return;
              setDraftDate(event.target.value);
              event.currentTarget.blur();
            }}
            className="h-9 w-full rounded-md border border-slate-700/60 bg-slate-950 px-2 text-sm text-slate-100"
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <Button
            size="xs"
            variant="danger"
            onClick={() => void clear()}
            disabled={Boolean(task.recurrenceRule)}
            isLoading={saving}
            loadingText={t('task.removing')}
            title={
              task.recurrenceRule
                ? t('task.recurringDueRequired')
                : t('task.removeDueDateTitle')
            }
          >
            {t('task.removeDueDate')}
          </Button>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setIsOpen(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="xs"
              onClick={() => void saveOnDismiss()}
              isLoading={saving}
              disabled={draftDate === (task.dueDate ?? '')}
            >
              {t('common.apply')}
            </Button>
          </div>
        </div>
      </div>
    </InlinePopover>
  );
}

function TaskRecurrenceControl({
  task,
  label,
  detail,
  onUpdate,
  onOpenEditor,
  compact,
}: {
  task: Task;
  label: string;
  detail: string;
  onUpdate: Props['onUpdate'];
  onOpenEditor: () => void;
  compact: boolean;
}) {
  const { t } = useI18n();
  const simple = parseSimpleTaskRecurrence(
    task.recurrenceRule,
    task.recurrenceInterval
  );
  const [isOpen, setIsOpen] = useState(false);
  const [interval, setInterval] = useState(simple?.interval ?? '1');
  const [unit, setUnit] = useState<TaskRecurrenceUnit>(simple?.unit ?? 'DAILY');
  const [anchorMode, setAnchorMode] = useState<TaskRecurrenceAnchorMode>(
    task.recurrenceAnchorMode
  );
  const [saving, setSaving] = useState(false);

  const open = () => {
    if (!simple) {
      onOpenEditor();
      return;
    }
    setInterval(simple.interval);
    setUnit(simple.unit);
    setAnchorMode(task.recurrenceAnchorMode);
    setIsOpen(true);
  };

  const apply = async () => {
    const parsed = Number(interval);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    setSaving(true);
    const didSave = await onUpdate({
      id: task.id,
      recurrenceRule: Number.isInteger(parsed)
        ? parsed === 1
          ? `FREQ=${unit}`
          : `FREQ=${unit};INTERVAL=${parsed}`
        : `FREQ=${unit}`,
      recurrenceInterval: Number.isInteger(parsed) ? null : parsed,
      recurrenceAnchorMode: anchorMode,
    });
    setSaving(false);
    if (didSave) setIsOpen(false);
  };

  const removeRecurrence = async () => {
    setSaving(true);
    const didSave = await onUpdate({
      id: task.id,
      recurrenceRule: null,
      recurrenceInterval: null,
    });
    setSaving(false);
    if (didSave) setIsOpen(false);
  };

  return (
    <InlinePopover
      isOpen={isOpen}
      onOpenChange={next => (next ? open() : setIsOpen(false))}
      onTrigger={open}
      trigger={
        <span
          className={clsx(
            'inline-flex min-w-0 items-center gap-1 truncate text-cyan-300/85',
            compact &&
              'h-5 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-1.5 text-[9px] leading-none'
          )}
        >
          <FaRedo aria-hidden="true" className="shrink-0 text-[9px]" />
          <span className="truncate">{label}</span>
        </span>
      }
      triggerLabel={t('task.changeRecurrenceFor', { title: task.title })}
      triggerTitle={detail}
      direction={compact ? 'up' : 'auto'}
    >
      <div className="w-72 space-y-3" data-testid="task-recurrence-popover">
        <TaskRecurrenceFields
          interval={interval}
          unit={unit}
          anchorMode={anchorMode}
          onIntervalChange={setInterval}
          onUnitChange={setUnit}
          onAnchorModeChange={setAnchorMode}
          intervalAriaLabel={t('task.interval')}
          unitAriaLabel={t('task.unit')}
          compact
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            size="xs"
            variant="danger"
            onClick={() => void removeRecurrence()}
            isLoading={saving}
            loadingText={t('task.removing')}
          >
            {t('task.removeRecurrence')}
          </Button>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setIsOpen(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button size="xs" onClick={() => void apply()} isLoading={saving}>
              {t('common.apply')}
            </Button>
          </div>
        </div>
      </div>
    </InlinePopover>
  );
}

function TaskPriorityControl({
  task,
  onUpdate,
  compact,
}: {
  task: Task;
  onUpdate: Props['onUpdate'];
  compact: boolean;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [mutationStatus, setMutationStatus] =
    useState<PriorityMutationStatus | null>(null);
  const checkingTimeoutRef = useRef<number | null>(null);
  const clearStatusTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (checkingTimeoutRef.current !== null) {
        window.clearTimeout(checkingTimeoutRef.current);
      }
      if (clearStatusTimeoutRef.current !== null) {
        window.clearTimeout(clearStatusTimeoutRef.current);
      }
    },
    []
  );

  const selectPriority = async (next: TaskPriority) => {
    if (saving) return;
    if (next === task.priority) {
      setIsOpen(false);
      return;
    }
    if (clearStatusTimeoutRef.current !== null) {
      window.clearTimeout(clearStatusTimeoutRef.current);
      clearStatusTimeoutRef.current = null;
    }
    setSaving(true);
    setMutationStatus('pending');
    checkingTimeoutRef.current = window.setTimeout(
      () => setMutationStatus('checking'),
      150
    );
    const didSave = await onUpdate({ id: task.id, priority: next });
    if (checkingTimeoutRef.current !== null) {
      window.clearTimeout(checkingTimeoutRef.current);
      checkingTimeoutRef.current = null;
    }
    setSaving(false);
    setMutationStatus(didSave ? 'confirmed' : 'failed');
    if (didSave) setIsOpen(false);
    clearStatusTimeoutRef.current = window.setTimeout(
      () => setMutationStatus(null),
      1000
    );
  };

  const statusText =
    mutationStatus === 'pending'
      ? 'Priority update pending'
      : mutationStatus === 'checking'
        ? 'Checking priority update'
        : mutationStatus === 'confirmed'
          ? 'Priority update confirmed'
          : mutationStatus === 'failed'
            ? 'Priority update failed'
            : null;

  return (
    <span className="relative inline-flex shrink-0">
      <InlinePopover
        isOpen={isOpen}
        onOpenChange={next => {
          if (!saving || next) setIsOpen(next);
        }}
        trigger={
          <span
            data-testid={compact ? 'minimized-task-priority' : undefined}
            className={clsx(
              'inline-flex h-5 items-center rounded-full border capitalize',
              compact ? 'px-1 text-[9px] leading-none' : 'px-1.5 text-[10px]',
              getTaskPriorityBadgeClass(task.priority)
            )}
          >
            {t(`common.${task.priority}`)}
          </span>
        }
        triggerLabel={t('task.changePriorityFor', {
          title: task.title,
          priority: t(`common.${task.priority}`),
        })}
        direction={compact ? 'up' : 'auto'}
      >
        <div className="w-36 space-y-1" data-testid="task-priority-popover">
          {PRIORITY_OPTIONS.map(priority => (
            <button
              key={priority}
              type="button"
              onClick={() => void selectPriority(priority)}
              disabled={saving}
              aria-current={priority === task.priority ? 'true' : undefined}
              className={clsx(
                'flex h-8 w-full items-center rounded-md border px-2 text-xs capitalize transition hover:brightness-125 disabled:cursor-wait',
                getTaskPriorityBadgeClass(priority),
                priority === task.priority && 'ring-1 ring-indigo-300/60'
              )}
            >
              {priority}
            </button>
          ))}
          {mutationStatus === 'failed' ? (
            <p className="pt-1 text-[10px] text-red-300">
              {t('common.updateFailed')}
            </p>
          ) : null}
        </div>
      </InlinePopover>
      {statusText && (
        <span
          role="status"
          aria-live="polite"
          data-testid="task-priority-status"
          data-state={mutationStatus ?? undefined}
          className="sr-only"
        >
          {statusText}
        </span>
      )}
    </span>
  );
}

function TaskIntentionControl({
  task,
  intentions,
  onUpdate,
  compact,
}: {
  task: Task;
  intentions: Intention[];
  onUpdate: Props['onUpdate'];
  compact: boolean;
}) {
  const { t } = useI18n();
  const choices = useMemo(
    () => buildIntentionChoices(intentions, task.timerType),
    [intentions, task.timerType]
  );
  const selected = `${task.intentionSlug ?? ''}::${task.subIntentionSlug ?? ''}`;
  const initialDraft = choices.some(choice => choice.value === selected)
    ? selected
    : '';
  const [draft, setDraft] = useState(initialDraft);
  const [isOpen, setIsOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectedChoice = choices.find(choice => choice.value === selected);
  const linkedParent = intentions.find(
    intention =>
      intention.slug === task.intentionSlug && intention.type === task.timerType
  );
  const linkedChild = intentions.find(
    intention =>
      intention.slug === task.subIntentionSlug &&
      intention.type === task.timerType
  );
  const displayChoice = selectedChoice ?? {
    parentEmoji: linkedParent?.emoji,
    subEmoji: linkedChild?.emoji,
  };
  const pickerOptions = useMemo(
    () => buildIntentionPickerOptions(intentions, task.timerType),
    [intentions, task.timerType]
  );
  const pickerSubIntentions = useMemo(
    () => buildIntentionPickerSubIntentions(intentions, task.timerType),
    [intentions, task.timerType]
  );
  const [draftIntentionSlug, draftSubIntentionSlug = ''] = draft.split('::');

  const handlePickerChange = (change: IntentionAssignmentPickerChange) => {
    const parentSlug = change.intentionSlugs[0] ?? '';
    setDraft(
      parentSlug
        ? `${parentSlug}::${change.subIntentions[parentSlug] ?? ''}`
        : ''
    );
  };

  const apply = async () => {
    const choice = choices.find(item => item.value === draft);
    setSaving(true);
    const didSave = await onUpdate({
      id: task.id,
      intentionSlug: choice?.intentionSlug ?? null,
      subIntentionSlug: choice?.subIntentionSlug ?? null,
    });
    setSaving(false);
    if (didSave) setIsOpen(false);
  };

  return (
    <InlinePopover
      isOpen={isOpen}
      onOpenChange={next => {
        setDraft(initialDraft);
        setIsOpen(next);
        setIsPickerOpen(next);
      }}
      trigger={
        <TaskIntentionBadge
          parentEmoji={displayChoice.parentEmoji}
          subEmoji={displayChoice.subEmoji}
          compact={compact}
        />
      }
      triggerLabel={
        displayChoice.parentEmoji || displayChoice.subEmoji
          ? t('intention.changeFor', { title: task.title })
          : t('intention.setForUnlinkedTask', { title: task.title })
      }
      triggerTitle={
        displayChoice.parentEmoji || displayChoice.subEmoji
          ? t('intention.change')
          : t('intention.set')
      }
      direction={compact ? 'up' : 'auto'}
    >
      <div className="w-64 space-y-3" data-testid="task-intention-popover">
        <IntentionAssignmentPicker
          label={t('task.intention')}
          showLabel
          options={pickerOptions}
          subIntentionsByParent={pickerSubIntentions}
          selectedIntentions={draftIntentionSlug ? [draftIntentionSlug] : []}
          selectedSubIntentions={
            draftIntentionSlug && draftSubIntentionSlug
              ? { [draftIntentionSlug]: draftSubIntentionSlug }
              : {}
          }
          mode="single"
          isOpen={isPickerOpen}
          onOpenChange={setIsPickerOpen}
          onChange={handlePickerChange}
          allowClear
          emptyLabel={t('intention.choose')}
          noSelectionLabel={t('intention.choose')}
          searchAriaLabel={t('intention.searchTask')}
          maxHeight={208}
          triggerClassName="h-9 text-xs"
          dropdownClassName="w-full"
          embedded
        />
        <div className="flex justify-end gap-2">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => setIsOpen(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button size="xs" onClick={() => void apply()} isLoading={saving}>
            {t('common.apply')}
          </Button>
        </div>
      </div>
    </InlinePopover>
  );
}

type InlinePopoverCloseReason = 'outside' | 'escape' | 'trigger';

function InlinePopover({
  isOpen,
  onOpenChange,
  onTrigger,
  trigger,
  triggerLabel,
  triggerTitle,
  triggerClassName,
  direction,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean, reason?: InlinePopoverCloseReason) => void;
  onTrigger?: () => void;
  trigger: ReactNode;
  triggerLabel: string;
  triggerTitle?: string;
  triggerClassName?: string;
  direction: 'up' | 'auto';
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const gap = 6;
      const edge = 8;
      const opensUp =
        direction === 'up' ||
        (window.innerHeight - triggerRect.bottom < popoverRect.height + gap &&
          triggerRect.top >= popoverRect.height + gap);
      const preferredTop = opensUp
        ? triggerRect.top - popoverRect.height - gap
        : triggerRect.bottom + gap;
      setPosition({
        left: Math.max(
          edge,
          Math.min(
            triggerRect.left,
            window.innerWidth - popoverRect.width - edge
          )
        ),
        top: Math.max(
          edge,
          Math.min(preferredTop, window.innerHeight - popoverRect.height - edge)
        ),
      });
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (popoverRef.current) observer.observe(popoverRef.current);
    if (triggerRef.current) observer.observe(triggerRef.current);
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      const focusTarget = popoverRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), button:not([disabled])'
      );
      focusTarget?.focus({ preventScroll: true });
    });
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [direction, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        onOpenChange(false, 'outside');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onOpenChange(false, 'escape');
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen, onOpenChange]);

  return (
    <span ref={rootRef} className="relative inline-flex min-w-0">
      <button
        type="button"
        ref={triggerRef}
        data-swipe-start
        aria-label={triggerLabel}
        title={triggerTitle}
        aria-expanded={isOpen}
        onClick={() =>
          onTrigger ? onTrigger() : onOpenChange(!isOpen, 'trigger')
        }
        className={clsx(
          'min-w-0 rounded text-left outline-none transition hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-400/70',
          triggerClassName
        )}
      >
        {trigger}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[1200] block max-w-[calc(100vw-1rem)] rounded-lg border border-slate-700/70 bg-slate-900 p-3 text-left shadow-2xl shadow-black/50"
              style={position}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

type IntentionChoice = {
  value: string;
  label: string;
  intentionSlug: string;
  subIntentionSlug: string | null;
  parentEmoji: string;
  subEmoji?: string;
};

function buildIntentionChoices(
  intentions: Intention[],
  timerType: Task['timerType']
): IntentionChoice[] {
  const available = intentions.filter(
    intention => intention.type === timerType && !intention.isArchived
  );
  const parents = available.filter(intention => !intention.parentIntentionId);
  return parents.reduce<IntentionChoice[]>((choices, parent) => {
    const children = available.filter(
      intention => intention.parentIntentionId === parent.id
    );
    if (children.length === 0) {
      choices.push({
        value: `${parent.slug}::`,
        label: `${parent.emoji} ${parent.title}`,
        intentionSlug: parent.slug,
        subIntentionSlug: null,
        parentEmoji: parent.emoji,
        subEmoji: undefined,
      });
      return choices;
    }
    choices.push(
      ...children.map(child => ({
        value: `${parent.slug}::${child.slug}`,
        label: `${parent.emoji} ${parent.title} / ${child.emoji} ${child.title}`,
        intentionSlug: parent.slug,
        subIntentionSlug: child.slug,
        parentEmoji: parent.emoji,
        subEmoji: child.emoji,
      }))
    );
    return choices;
  }, []);
}

function buildIntentionPickerOptions(
  intentions: Intention[],
  timerType: Task['timerType']
) {
  return intentions
    .filter(
      intention =>
        intention.type === timerType &&
        !intention.isArchived &&
        !intention.parentIntentionId
    )
    .map(intention => ({
      value: intention.slug,
      title: intention.title,
      emoji: intention.emoji,
    }));
}

function buildIntentionPickerSubIntentions(
  intentions: Intention[],
  timerType: Task['timerType']
) {
  const available = intentions.filter(
    intention => intention.type === timerType && !intention.isArchived
  );
  const parentSlugById = new Map(
    available
      .filter(intention => !intention.parentIntentionId)
      .map(intention => [intention.id, intention.slug])
  );
  return available.reduce<
    Record<string, Array<{ slug: string; title: string; emoji: string }>>
  >((childrenByParent, intention) => {
    const parentSlug = intention.parentIntentionId
      ? parentSlugById.get(intention.parentIntentionId)
      : undefined;
    if (!parentSlug) return childrenByParent;
    childrenByParent[parentSlug] = [
      ...(childrenByParent[parentSlug] ?? []),
      {
        slug: intention.slug,
        title: intention.title,
        emoji: intention.emoji,
      },
    ];
    return childrenByParent;
  }, {});
}
