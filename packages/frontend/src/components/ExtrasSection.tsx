import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

interface ExtrasSectionProps {
  sectionId: 'general' | 'timer' | 'sessions' | 'intentions' | 'tasks';
  children: ReactNode;
  label?: string;
}

export function ExtrasSection({
  sectionId,
  children,
  label,
}: ExtrasSectionProps) {
  const { t } = useI18n();
  return (
    <details
      data-extras-section={sectionId}
      className="rounded-xl border border-slate-800/70 bg-slate-950/20 p-4"
    >
      <summary className="cursor-pointer text-sm font-medium text-slate-400">
        {label ?? t('common.moreOptions')}
      </summary>
      <div className="mt-4 space-y-5">{children}</div>
    </details>
  );
}
