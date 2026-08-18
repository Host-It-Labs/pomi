import type { ReactNode } from 'react';

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
  return (
    <section
      data-extras-section={sectionId}
      className="rounded-xl border border-slate-800/70 bg-slate-950/20 p-4"
    >
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label ?? 'Personalize'}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
