import type { Intention, Task, TaskPriority, TaskStatus } from '@pomi/shared';
import { TASK_STATUSES } from '@pomi/shared/src/constants';
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export type TaskBulkAction = 'complete' | 'archive' | 'priority' | 'intention';

export type TaskBulkAssignmentOption = {
  value: string;
  label: string;
  intentionSlug: string | null;
  subIntentionSlug: string | null;
};

export type TaskBulkUpdate = {
  id: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
};

export async function runTaskBulkUpdates(
  updates: TaskBulkUpdate[],
  updateTask: (update: TaskBulkUpdate) => Promise<boolean>
) {
  const outcomes = await Promise.all(
    updates.map(async update => {
      try {
        return await updateTask(update);
      } catch {
        return false;
      }
    })
  );
  return updates
    .filter((_, index) => !outcomes[index])
    .map(update => update.id);
}

export function buildTaskBulkAssignmentOptions(
  intentions: Intention[],
  timerType: Task['timerType'] | null,
  noIntentionLabel: string
): TaskBulkAssignmentOption[] {
  const noIntention = {
    value: 'none',
    label: noIntentionLabel,
    intentionSlug: null,
    subIntentionSlug: null,
  };
  if (!timerType) return [noIntention];

  const available = intentions.filter(
    intention => intention.type === timerType && !intention.isArchived
  );
  const parents = available.filter(intention => !intention.parentIntentionId);
  return parents.reduce<TaskBulkAssignmentOption[]>(
    (options, parent) => {
      const children = available.filter(
        intention => intention.parentIntentionId === parent.id
      );
      if (children.length === 0) {
        options.push({
          value: `${parent.slug}::`,
          label: `${parent.emoji} ${parent.title}`,
          intentionSlug: parent.slug,
          subIntentionSlug: null,
        });
        return options;
      }
      options.push(
        ...children.map(child => ({
          value: `${parent.slug}::${child.slug}`,
          label: `${parent.emoji} ${parent.title} / ${child.emoji} ${child.title}`,
          intentionSlug: parent.slug,
          subIntentionSlug: child.slug,
        }))
      );
      return options;
    },
    [noIntention]
  );
}

export function buildTaskBulkUpdate({
  taskId,
  action,
  priority,
  assignment,
}: {
  taskId: string;
  action: TaskBulkAction;
  priority: TaskPriority;
  assignment: TaskBulkAssignmentOption;
}): TaskBulkUpdate {
  if (action === 'complete') {
    return { id: taskId, status: TASK_STATUSES.COMPLETED };
  }
  if (action === 'archive') {
    return { id: taskId, status: TASK_STATUSES.ARCHIVED };
  }
  if (action === 'priority') {
    return { id: taskId, priority };
  }
  return {
    id: taskId,
    intentionSlug: assignment.intentionSlug,
    subIntentionSlug: assignment.subIntentionSlug,
  };
}

export function TaskBulkActionModal({
  isOpen,
  selectedTasks,
  assignmentOptions,
  assignmentUnavailableReason,
  isSaving,
  error,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  selectedTasks: Task[];
  assignmentOptions: TaskBulkAssignmentOption[];
  assignmentUnavailableReason: string | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (updates: TaskBulkUpdate[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<TaskBulkAction>('complete');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignmentValue, setAssignmentValue] = useState('none');

  useEffect(() => {
    if (!isOpen) return;
    setAction('complete');
    setPriority('normal');
    setAssignmentValue('none');
  }, [isOpen]);

  const assignment =
    assignmentOptions.find(option => option.value === assignmentValue) ??
    assignmentOptions[0];
  const canConfirm =
    selectedTasks.length > 0 &&
    (action !== 'intention' || Boolean(assignment)) &&
    !(
      action === 'intention' &&
      assignmentUnavailableReason &&
      assignment?.intentionSlug
    );
  const actionLabel =
    action === 'complete'
      ? t('task.bulkComplete')
      : action === 'archive'
        ? t('task.bulkArchive')
        : action === 'priority'
          ? t('task.bulkPriority')
          : t('task.bulkIntention');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('task.bulkManage')}
      closeOnBackdropClick={!isSaving}
      closeOnEscape={!isSaving}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-300">
          {t('task.bulkScope', { count: selectedTasks.length })}
        </p>
        <label className="block space-y-1 text-xs text-slate-400">
          <span>{t('common.update')}</span>
          <select
            value={action}
            onChange={event => setAction(event.target.value as TaskBulkAction)}
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
          >
            <option value="complete">{t('task.bulkComplete')}</option>
            <option value="archive">{t('task.bulkArchive')}</option>
            <option value="priority">{t('task.bulkPriority')}</option>
            <option value="intention">{t('task.bulkIntention')}</option>
          </select>
        </label>
        {action === 'priority' ? (
          <label className="block space-y-1 text-xs text-slate-400">
            <span>{t('task.priority')}</span>
            <select
              value={priority}
              onChange={event =>
                setPriority(event.target.value as TaskPriority)
              }
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm capitalize text-slate-100"
            >
              {(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map(
                value => (
                  <option key={value} value={value}>
                    {t(`common.${value}`)}
                  </option>
                )
              )}
            </select>
          </label>
        ) : null}
        {action === 'intention' ? (
          <div className="space-y-2">
            <label className="block space-y-1 text-xs text-slate-400">
              <span>{t('task.intention')}</span>
              <select
                value={assignmentValue}
                onChange={event => setAssignmentValue(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100"
              >
                {assignmentOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {assignmentUnavailableReason ? (
              <Alert variant="warning">{assignmentUnavailableReason}</Alert>
            ) : null}
          </div>
        ) : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {t('task.bulkConfirm', {
            action: actionLabel,
            count: selectedTasks.length,
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              if (!assignment || !canConfirm) return;
              void onConfirm(
                selectedTasks.map(task =>
                  buildTaskBulkUpdate({
                    taskId: task.id,
                    action,
                    priority,
                    assignment,
                  })
                )
              );
            }}
            disabled={!canConfirm || isSaving}
            isLoading={isSaving}
          >
            {t('common.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
