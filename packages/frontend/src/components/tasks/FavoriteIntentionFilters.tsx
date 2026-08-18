import clsx from 'clsx';
import { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';

export type FavoriteIntentionFilterItem = {
  value: string;
  title: string;
  emoji: string;
};

export function FavoriteIntentionFilters({
  items,
  selectedValue,
  onSelect,
  reserveWhileLoading,
}: {
  items: FavoriteIntentionFilterItem[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
  reserveWhileLoading: boolean;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<'labels' | 'emoji-one' | 'emoji-two'>(
    'labels'
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure || items.length === 0) return;

    const update = () => {
      const available = root.clientWidth;
      const labelWidth = Array.from(measure.children).reduce(
        (total, child, index) =>
          total + (child as HTMLElement).offsetWidth + (index === 0 ? 0 : 6),
        0
      );
      if (labelWidth <= available) {
        setLayout('labels');
        return;
      }
      const oneRowCapacity = Math.max(1, Math.floor((available + 6) / 34));
      setLayout(items.length <= oneRowCapacity ? 'emoji-one' : 'emoji-two');
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0 && !reserveWhileLoading) return null;

  const emojiOnly = layout !== 'labels';
  const rows = layout === 'emoji-two' ? 2 : 1;

  return (
    <div
      ref={rootRef}
      className={clsx(
        'relative mt-2 overflow-hidden border-t border-slate-800/70 pt-2',
        rows === 2 ? 'min-h-[66px]' : 'min-h-[34px]'
      )}
      aria-label={t('task.favoriteFilters')}
      data-testid="task-favorite-filters"
      data-layout={layout}
    >
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute invisible flex gap-1.5"
      >
        {items.map(item => (
          <span
            key={item.value}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-medium"
          >
            <span>{item.emoji}</span>
            <span>{item.title}</span>
          </span>
        ))}
      </div>

      {items.length === 0 ? (
        <div
          aria-hidden="true"
          className="h-7 w-full animate-pulse rounded-md bg-slate-800/35"
        />
      ) : (
        <div
          className={clsx(
            'app-scrollbar gap-1.5 overflow-x-auto pb-0.5',
            emojiOnly ? 'grid snap-x snap-mandatory' : 'flex'
          )}
          style={
            emojiOnly
              ? {
                  gridAutoFlow: 'column',
                  gridTemplateRows: `repeat(${rows}, 28px)`,
                  gridAutoColumns: '28px',
                }
              : undefined
          }
        >
          {items.map(item => (
            <button
              key={item.value}
              type="button"
              onClick={() => onSelect(item.value)}
              data-testid={`task-favorite-intention-${item.value}`}
              aria-label={emojiOnly ? item.title : undefined}
              title={emojiOnly ? item.title : undefined}
              className={clsx(
                'inline-flex shrink-0 snap-start items-center justify-center rounded-full border font-medium transition-colors',
                emojiOnly
                  ? 'h-7 w-7 text-xs'
                  : 'max-w-full gap-1.5 px-2 py-1 text-[11px]',
                selectedValue === item.value
                  ? 'border-indigo-300/70 bg-indigo-500/25 text-indigo-50'
                  : 'border-slate-700/60 bg-slate-900/55 text-slate-300 hover:border-indigo-400/50 hover:text-white'
              )}
            >
              <span>{item.emoji}</span>
              {!emojiOnly ? (
                <span className="truncate">{item.title}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
