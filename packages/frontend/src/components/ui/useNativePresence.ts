import { useEffect, useRef, useState } from 'react';

export type NativePresencePhase = 'entering' | 'entered' | 'exiting';

export type NativePresenceListItem<T> = {
  key: string;
  value: T;
  phase: NativePresencePhase;
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function useNativePresence<T>(
  value: T | null | undefined,
  durationMs: number
) {
  const isPresent = value !== null && value !== undefined;
  const lastValue = useRef<T | null>(isPresent ? value : null);
  if (isPresent) {
    lastValue.current = value;
  }

  const [shouldRender, setShouldRender] = useState(isPresent);
  const [phase, setPhase] = useState<NativePresencePhase>(
    isPresent ? 'entering' : 'exiting'
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShouldRender(isPresent);
      setPhase(isPresent ? 'entered' : 'exiting');
      if (!isPresent) lastValue.current = null;
      return;
    }

    if (isPresent) {
      setShouldRender(true);
      setPhase('entering');
      const timer = window.setTimeout(() => setPhase('entered'), durationMs);
      return () => window.clearTimeout(timer);
    }

    if (!shouldRender) return;
    setPhase('exiting');
    const timer = window.setTimeout(() => {
      setShouldRender(false);
      lastValue.current = null;
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, isPresent, shouldRender]);

  const finish = () => {
    if (phase === 'entering' && isPresent) {
      setPhase('entered');
    } else if (phase === 'exiting' && !isPresent) {
      setShouldRender(false);
      lastValue.current = null;
    }
  };

  return {
    value: lastValue.current,
    shouldRender,
    phase,
    finish,
    isExiting: phase === 'exiting',
  };
}

export function useNativePresenceList<T>(
  items: T[],
  getKey: (item: T) => string,
  durationMs: number
) {
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const [renderedItems, setRenderedItems] = useState<
    NativePresenceListItem<T>[]
  >(() =>
    items.map(item => ({ key: getKey(item), value: item, phase: 'entered' }))
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      setRenderedItems(
        items.map(item => ({
          key: getKey(item),
          value: item,
          phase: 'entered',
        }))
      );
      return;
    }

    setRenderedItems(current => {
      const currentByKey = new Map(current.map(item => [item.key, item]));
      const nextKeys = new Set(items.map(getKeyRef.current));
      const next = items.map(item => {
        const key = getKeyRef.current(item);
        const existing = currentByKey.get(key);
        return {
          key,
          value: item,
          phase:
            existing?.phase === 'exiting'
              ? ('entering' as const)
              : (existing?.phase ?? ('entering' as const)),
        };
      });
      return [
        ...next,
        ...current
          .filter(item => !nextKeys.has(item.key))
          .map(item => ({ ...item, phase: 'exiting' as const })),
      ];
    });
  }, [items]);

  useEffect(() => {
    const timers = renderedItems.flatMap(item => {
      if (item.phase === 'entered') return [];
      return [
        window.setTimeout(() => {
          setRenderedItems(current =>
            item.phase === 'entering'
              ? current.map(candidate =>
                  candidate.key === item.key && candidate.phase === 'entering'
                    ? { ...candidate, phase: 'entered' }
                    : candidate
                )
              : current.filter(
                  candidate =>
                    candidate.key !== item.key || candidate.phase !== 'exiting'
                )
          );
        }, durationMs),
      ];
    });
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [durationMs, renderedItems]);

  return renderedItems;
}
