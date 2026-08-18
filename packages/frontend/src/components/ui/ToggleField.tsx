import type { KeyboardEvent, ReactNode } from 'react';
import { FaInfoCircle } from 'react-icons/fa';
import { ToggleSwitch } from './ToggleSwitch';

interface ToggleFieldProps {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  className?: string;
  disabled?: boolean;
  onDisabledClick?: () => void;
  icon?: ReactNode;
}

export function ToggleField({
  id,
  checked,
  onChange,
  label,
  description,
  className,
  disabled,
  onDisabledClick,
  icon,
}: ToggleFieldProps) {
  const canClickDisabled = disabled && onDisabledClick;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canClickDisabled) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onDisabledClick();
    }
  };

  return (
    <div
      data-setting-id={id}
      className={className ? `space-y-2 ${className}` : 'space-y-2'}
      onClick={canClickDisabled ? onDisabledClick : undefined}
      onKeyDown={handleKeyDown}
      role={canClickDisabled ? 'button' : undefined}
      tabIndex={canClickDisabled ? 0 : undefined}
    >
      <ToggleSwitch
        id={id}
        checked={checked}
        onChange={onChange}
        label={label}
        icon={icon}
        labelAccessory={
          description ? (
            <button
              type="button"
              aria-label={`About ${label}`}
              title={description}
              onClick={event => event.stopPropagation()}
              className="shrink-0 text-slate-600 transition hover:text-slate-300 focus:text-slate-300"
            >
              <FaInfoCircle size={12} />
            </button>
          ) : null
        }
        disabled={disabled}
      />
    </div>
  );
}
