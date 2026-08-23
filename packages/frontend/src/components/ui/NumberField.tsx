import { InputHTMLAttributes } from 'react';
import { FaInfoCircle } from 'react-icons/fa';
import { useI18n } from '../../i18n';

interface NumberFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'id' | 'className'
> {
  label: string;
  helperText?: string;
  id: string;
  className?: string;
}

export function NumberField({
  label,
  helperText,
  id,
  className,
  ...inputProps
}: NumberFieldProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="mr-3 flex min-w-0 flex-1 items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium text-white">
            {label}
          </label>
          {helperText ? (
            <button
              type="button"
              aria-label={t('common.aboutFor', { label })}
              title={helperText}
              className="text-slate-600 hover:text-slate-300"
            >
              <FaInfoCircle size={12} />
            </button>
          ) : null}
        </div>
        <div className="flex items-center bg-slate-700 rounded-md px-3 py-1">
          <input
            id={id}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className={`w-10 bg-transparent text-white text-right text-sm outline-none focus:ring-1 focus:ring-indigo-500 rounded ${className || ''}`}
            {...inputProps}
          />
        </div>
      </div>
    </div>
  );
}
