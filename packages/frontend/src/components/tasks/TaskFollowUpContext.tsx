import clsx from 'clsx';
import { useI18n } from '../../i18n';

export function TaskFollowUpContext({
  parentTitle,
  compact = false,
}: {
  parentTitle: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="task-follow-up-context"
      className={clsx(
        'truncate font-medium uppercase tracking-wide text-indigo-300',
        compact ? 'text-[9px]' : 'text-[10px]'
      )}
    >
      {t('task.followUpFrom', { title: parentTitle })}
    </div>
  );
}
