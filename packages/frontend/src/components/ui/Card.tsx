import clsx from 'clsx';
import { type HTMLAttributes, type ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={clsx(
        'rounded-lg border border-slate-800 bg-slate-900',
        className
      )}
    >
      {children}
    </div>
  );
}
