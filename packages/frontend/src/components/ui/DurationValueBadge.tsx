import { useEffect, useRef, useState } from 'react';
import { AccentColorType, COLORS } from '../../config/colors';

interface DurationValueBadgeProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  unitLabel?: string;
  onChange: (value: number) => void;
  onLiveChange?: (value: number) => void;
  accentColor: AccentColorType;
}

export function DurationValueBadge({
  id,
  value,
  min,
  max,
  unitLabel = 'min',
  onChange,
  onLiveChange,
  accentColor,
}: DurationValueBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const editStartValueRef = useRef(value);

  const colorSet = COLORS[accentColor];

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      editStartValueRef.current = localValue;
      setInputValue('');
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing, localValue]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        if (pendingValueRef.current !== null) {
          onChange(pendingValueRef.current);
        }
      }
    };
  }, [onChange]);

  const clampValue = (nextValue: number) => {
    if (nextValue < min) return min;
    if (nextValue > max) return max;
    return nextValue;
  };

  const debouncedOnChange = (nextValue: number) => {
    const boundedValue = clampValue(nextValue);

    setLocalValue(boundedValue);
    if (onLiveChange) onLiveChange(boundedValue);
    pendingValueRef.current = boundedValue;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onChange(boundedValue);
      pendingValueRef.current = null;
    }, 2000);
  };

  const commitValue = () => {
    setIsEditing(false);

    let finalValue = editStartValueRef.current;
    if (inputValue !== '') {
      const parsedValue = parseInt(inputValue, 10);
      if (!Number.isNaN(parsedValue)) {
        finalValue = clampValue(parsedValue);
      }
    }

    setLocalValue(finalValue);
    if (onLiveChange) onLiveChange(finalValue);
    onChange(finalValue);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      pendingValueRef.current = null;
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextInputValue = event.target.value;
    setInputValue(nextInputValue);

    if (nextInputValue === '') {
      return;
    }

    const parsedValue = parseInt(nextInputValue, 10);
    if (!Number.isNaN(parsedValue)) {
      debouncedOnChange(parsedValue);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitValue();
    }
  };

  return (
    <div
      className={`flex items-center cursor-pointer ${colorSet.bg} rounded-md px-3 py-1`}
      onClick={() => setIsEditing(true)}
    >
      {isEditing ? (
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={commitValue}
          onKeyDown={handleKeyDown}
          className={`w-6 ${colorSet.text} text-right text-sm outline-none`}
        />
      ) : (
        <span className={`font-medium text-sm ${colorSet.text}`}>
          {localValue}
        </span>
      )}
      {unitLabel ? (
        <span className={`ml-1 text-xs ${colorSet.secondaryText}`}>
          {unitLabel}
        </span>
      ) : null}
    </div>
  );
}
