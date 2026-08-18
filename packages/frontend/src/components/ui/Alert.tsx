import clsx from 'clsx';
import { type ReactNode } from 'react';

type AlertVariant = 'error' | 'warning' | 'info' | 'success';

interface AlertProps {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Alert({ variant, title, children, className }: AlertProps) {
  const variantClasses = {
    error: 'border-red-300 bg-red-100 text-red-800',
    warning: 'border-amber-400/50 bg-amber-500/10 text-amber-200',
    info: 'border-blue-300/60 bg-blue-500/10 text-blue-200',
    success: 'border-emerald-300/60 bg-emerald-500/10 text-emerald-200',
  };

  return (
    <div
      role="alert"
      className={clsx(
        'w-full rounded-lg border px-4 py-3 text-sm',
        variantClasses[variant],
        className
      )}
    >
      {title ? <div className="text-sm font-semibold mb-1">{title}</div> : null}
      {children}
    </div>
  );
}
