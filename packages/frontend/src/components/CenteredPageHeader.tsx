import type { ReactNode } from 'react';
import { BackButton } from './BackButton';

export function CenteredPageHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <BackButton
        targetTab="timer"
        className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-ink"
        wrapperClassName="shrink-0"
      />
      <h1 className="text-sm font-semibold tracking-tight text-slate-100">
        {title}
      </h1>
      <div className="flex justify-end">{action}</div>
    </div>
  );
}
