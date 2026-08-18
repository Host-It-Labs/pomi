import clsx from 'clsx';
import { type ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
  className?: string;
  icon?: ReactNode;
}

export function SectionHeader({
  title,
  description,
  className,
  icon,
}: SectionHeaderProps) {
  return (
    <div className={clsx('space-y-1', className)}>
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-slate-400">{icon}</span>}
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
      </div>
      {description ? (
        <p className="text-sm text-slate-400">{description}</p>
      ) : null}
    </div>
  );
}
