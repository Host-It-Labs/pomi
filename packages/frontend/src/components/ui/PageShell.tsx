import clsx from 'clsx';
import { type ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
  className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={clsx('min-h-dvh bg-slate-950', className)}>{children}</div>
  );
}
