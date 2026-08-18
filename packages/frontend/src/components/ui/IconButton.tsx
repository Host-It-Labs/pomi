import clsx from 'clsx';
import { type ButtonHTMLAttributes } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'primary' | 'secondary' | 'success';
  size?: 'sm' | 'md' | 'lg';
}

export function IconButton({
  children,
  className,
  label,
  variant = 'primary',
  size = 'md',
  disabled,
  title,
  ...props
}: IconButtonProps) {
  const tooltipLabel = title ?? label;
  const sizeClasses = {
    sm: 'p-2 text-xs',
    md: 'p-3 text-sm',
    lg: 'p-4 text-base',
  };

  return (
    <button
      {...props}
      disabled={disabled}
      aria-label={label}
      title={tooltipLabel}
      className={clsx(
        'z-10 inline-flex items-center justify-center rounded-full transition-all cursor-pointer relative',
        'hover:scale-110 focus:outline-none focus:ring-2',
        sizeClasses[size],
        {
          'text-white focus:ring-indigo-500/50 bg-indigo-600/90 hover:bg-indigo-500 shadow-sm shadow-indigo-600/20':
            variant === 'primary' && !disabled,
          'focus:ring-slate-500/50 bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700/40':
            variant === 'secondary' && !disabled,
          'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20 hover:bg-emerald-400 focus:ring-emerald-400/50':
            variant === 'success' && !disabled,
          'bg-slate-700 text-slate-500 cursor-not-allowed opacity-50 hover:scale-100':
            disabled,
        },
        className
      )}
    >
      {children}
    </button>
  );
}
