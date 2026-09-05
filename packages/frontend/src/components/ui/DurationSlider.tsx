import { useEffect, useRef, useState } from 'react';
import { AccentColorType, COLORS } from '../../config/colors';
import { DurationValueBadge } from './DurationValueBadge';

interface DurationSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onLiveChange?: (value: number) => void;
  accentColor: AccentColorType;
  tickMarks: { value: number; label: string }[];
}

export function DurationSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onLiveChange,
  accentColor,
  tickMarks,
}: DurationSliderProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const colorSet = COLORS[accentColor];

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const debouncedOnChange = (newValue: number) => {
    if (newValue < min) newValue = min;
    if (newValue > max) newValue = max;

    setLocalValue(newValue);
    if (onLiveChange) onLiveChange(newValue);
    pendingValueRef.current = newValue;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onChange(newValue);
      pendingValueRef.current = null;
    }, 2000);
  };

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

  const tickPositions = tickMarks.map(mark => ({
    ...mark,
    position: `${((mark.value - min) / (max - min)) * 100}%`,
  }));

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label
          htmlFor={`${label.toLowerCase().replace(/\s+/g, '-')}`}
          className="text-sm  text-ink font-medium"
        >
          {label}
        </label>
        <DurationValueBadge
          value={localValue}
          min={min}
          max={max}
          onChange={newValue => {
            setLocalValue(newValue);
            onChange(newValue);
          }}
          onLiveChange={newValue => {
            setLocalValue(newValue);
            if (onLiveChange) onLiveChange(newValue);
          }}
          accentColor={accentColor}
        />
      </div>
      <div className="relative h-12 w-full">
        <input
          id={`${label.toLowerCase().replace(/\s+/g, '-')}`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue}
          ref={sliderRef}
          onChange={e => {
            const val = parseInt(e.target.value);
            if (isDragging) {
              setDragValue(val);
              setLocalValue(val);
              if (onLiveChange) onLiveChange(val);
            }
          }}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => {
            setIsDragging(false);
            if (dragValue !== null) {
              debouncedOnChange(dragValue);
              setDragValue(null);
            }
          }}
          onTouchStart={e => {
            const touch = e.touches[0];
            touchStartRef.current = { x: touch.clientX, y: touch.clientY };
            setIsDragging(false);
          }}
          onTouchMove={e => {
            if (!touchStartRef.current) return;

            const touch = e.touches[0];
            const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
            const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

            if (!isDragging && deltaY > deltaX && deltaY > 10) {
              return;
            }

            if (!isDragging && deltaX > 10) {
              setIsDragging(true);
            }

            if (isDragging) {
              e.preventDefault();
            }
          }}
          onTouchEnd={() => {
            if (isDragging && dragValue !== null) {
              debouncedOnChange(dragValue);
              setDragValue(null);
            }
            setIsDragging(false);
            touchStartRef.current = null;
          }}
          onWheel={event => {
            event.preventDefault();
            if (typeof window !== 'undefined') {
              window.scrollBy(0, event.deltaY);
            }
          }}
          className={`w-full h-2 bg-slate-700/50 rounded-lg appearance-none cursor-pointer border border-slate-600/20 ${colorSet.accent}`}
        />

        <div className="relative w-full h-6 mt-1">
          {tickPositions.map(mark => (
            <div
              key={mark.value}
              className="absolute transform -translate-x-1/2"
              style={{ left: mark.position, top: 0 }}
            >
              <div className="flex flex-col items-center">
                <div className="h-2 w-0.5 bg-gray-300"></div>
                <span className="text-xs text-gray-500 mt-1">{mark.label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
