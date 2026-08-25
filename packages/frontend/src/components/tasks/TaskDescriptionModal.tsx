import type { Task } from '@pomi/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { TaskDescriptionMarkdown } from './TaskDescriptionMarkdown';
import { Modal } from '../ui/Modal';
import { useI18n } from '../../i18n';

/**
 * The API may add transcript metadata to Tasks independently of the shared
 * package version used by a running frontend. Keep the view tolerant of that
 * rollout boundary while still rendering the exact value when present.
 */
export type TaskWithTranscript = Task & {
  sourceTranscript?: string | null;
};

export function getTaskTranscript(task: Task): string | null {
  const transcript = (task as TaskWithTranscript).sourceTranscript;
  return typeof transcript === 'string' && transcript.trim().length > 0
    ? transcript
    : null;
}

export function hasTaskDescription(task: Task): boolean {
  return Boolean(task.description?.trim() || getTaskTranscript(task));
}

export function TaskDescriptionButton({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (task: Task) => void;
}) {
  const { t } = useI18n();
  if (!hasTaskDescription(task)) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label={t('description.readFor', { title: task.title })}
      title={t('description.read')}
      onClick={() => onOpen(task)}
      className="group/task-description relative shrink-0 overflow-visible rounded px-0.5 text-[11px] leading-none opacity-75 transition hover:opacity-100"
    >
      📝
    </button>
  );
}

export function TaskDescriptionModal({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const transcript = task ? getTaskTranscript(task) : null;
  const description = task?.description?.trim() || null;
  const scrollPositionRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!task) return;
    scrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
    return () => {
      const position = scrollPositionRef.current;
      if (position) window.scrollTo(position.x, position.y);
      scrollPositionRef.current = null;
    };
  }, [task?.id]);

  return (
    <Modal
      isOpen={task !== null}
      onClose={onClose}
      title={task?.title ?? t('task.descriptionTitle')}
      closeOnBackdropClick
      closeOnEscape
      className="max-h-[82vh] overflow-hidden"
    >
      <div className="max-h-[calc(82vh-7rem)] space-y-3 overflow-y-auto pr-1">
        {transcript && <TaskTranscriptSection transcript={transcript} />}
        {description && (
          <section aria-label={t('common.description')} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('common.description')}
            </h3>
            <TaskDescriptionMarkdown markdown={description} />
          </section>
        )}
      </div>
    </Modal>
  );
}

function TaskTranscriptSection({ transcript }: { transcript: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      data-testid="task-transcript"
      open={isOpen}
      onToggle={event => setIsOpen(event.currentTarget.open)}
      className="rounded-md border border-slate-800/80 bg-slate-950/40"
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-slate-300 [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block text-slate-500" aria-hidden="true">
          ▸
        </span>
        Transcript
      </summary>
      <div
        data-testid="task-transcript-content"
        className="whitespace-pre-wrap break-words border-t border-slate-800/70 px-3 py-2 text-xs leading-5 text-slate-400"
      >
        {transcript}
      </div>
    </details>
  );
}
