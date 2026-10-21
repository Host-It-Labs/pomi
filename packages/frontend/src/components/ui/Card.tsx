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
        'rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--hairline)]',
        className
      )}
    >
      {children}
    </div>
  );
}
