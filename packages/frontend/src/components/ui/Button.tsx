import clsx from 'clsx';
import { type ButtonHTMLAttributes } from 'react';
import { useI18n } from '../../i18n';
import { Spinner } from './Spinner.tsx';

type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'link';

type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  loadingText?: string;
}

export function Button({
  variant,
  size,
  isLoading,
  loadingText,
  className,
  children,
  type,
  disabled,
  ...props
}: ButtonProps) {
  const { t } = useI18n();
  const resolvedVariant = variant ?? 'primary';
  const resolvedSize = size ?? 'md';
  const showLoading = Boolean(isLoading);
  const resolvedType = type ?? 'button';

  const sizeClasses = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  };

  const variantClasses = {
    primary:
      'bg-indigo-600 text-on-accent border border-indigo-600 hover:bg-indigo-700',
    secondary:
      'bg-slate-800/40 text-slate-300 border border-slate-700/25 hover:bg-slate-700/40',
    ghost: 'bg-transparent text-slate-200 hover:bg-slate-800/40',
    danger:
      'bg-red-600/40 text-red-200 border border-red-500/25 hover:bg-red-600/55',
    outline:
      'border border-slate-700/40 text-slate-300 hover:bg-slate-800/40 hover:border-slate-600/40',
    link: 'bg-transparent text-blue-400 hover:text-blue-300',
  };

  return (
    <button
      {...props}
      type={resolvedType}
      disabled={disabled || showLoading}
      className={clsx(
        'relative inline-flex items-center justify-center rounded-xl font-medium transition-colors cursor-pointer',
        'disabled:cursor-not-allowed disabled:opacity-70',
        sizeClasses[resolvedSize],
        variantClasses[resolvedVariant],
        className
      )}
    >
      {showLoading ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size="sm" />
          <span>{loadingText || t('common.loading')}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
