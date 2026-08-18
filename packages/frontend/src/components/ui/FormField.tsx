import clsx from 'clsx';
import { type ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  helperText?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  helperText,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={clsx('space-y-2', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-gray-300"
      >
        {label}
      </label>
      {children}
      {helperText ? (
        <p className="text-xs text-gray-400">{helperText}</p>
      ) : null}
    </div>
  );
}
