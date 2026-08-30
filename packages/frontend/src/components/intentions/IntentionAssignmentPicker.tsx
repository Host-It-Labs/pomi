import clsx from 'clsx';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  Fragment,
} from 'react';
import { FaCheck, FaChevronDown } from 'react-icons/fa';
import { isMobile } from '../../utils/osUtils';
import { IntentionEmojiPair } from '../ui/IntentionEmojiPair';
import { KeyboardShortcut } from '../ui/KeyboardShortcut';
import { useI18n } from '../../i18n';

export type IntentionAssignmentOption = {
  value: string;
  title: string;
  emoji: string;
  assignmentType?: 'intention' | 'list';
  icon?: ReactNode;
  isNew?: boolean;
  isAction?: boolean;
  group?: string;
};

export type SubIntentionAssignmentOption = {
  slug: string;
  title: string;
  emoji: string;
  isArchived?: boolean;
};

export type IntentionAssignmentPickerChange = {
  intentionSlugs: string[];
  subIntentions: Record<string, string>;
  listId?: string | null;
  reason: 'clear' | 'intention' | 'subIntention' | 'list';
};

export type IntentionAssignmentPickerActionContext = {
  searchText: string;
};

type IntentionAssignmentPickerProps = {
  label: string;
  options: IntentionAssignmentOption[];
  subIntentionsByParent: Record<string, SubIntentionAssignmentOption[]>;
  selectedIntentions: string[];
  selectedSubIntentions: Record<string, string>;
  selectedListId?: string | null;
  mode: 'single' | 'multi';
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onChange: (change: IntentionAssignmentPickerChange) => void;
  onAction?: (
    option: IntentionAssignmentOption,
    context: IntentionAssignmentPickerActionContext
  ) => void;
  disabled?: boolean;
  showLabel?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  parentSelectionLabel?: string;
  emptyLabel?: string;
  noSelectionLabel?: string | null;
  returnFocusOnClose?: boolean;
  shortcut?: string;
  shortcutAlwaysShow?: boolean;
  shortcutShowModIcon?: boolean;
  shortcutPosition?: 'topRight' | 'centered' | 'indicator';
  searchAriaLabel?: string;
  searchPlaceholder?: string;
  direction?: 'up' | 'down';
  maxHeight?: number;
  triggerClassName?: string;
  dropdownClassName?: string;
  embedded?: boolean;
  renderOptionAction?: (option: IntentionAssignmentOption) => ReactNode;
  optionDataAttribute?: string;
  listDataAttribute?: string;
  triggerDataAttribute?: string;
  triggerTestId?: string;
  optionTestIdPrefix?: string;
  listTestId?: string;
  clearTestId?: string;
};

export function IntentionAssignmentPicker({
  label,
  options,
  subIntentionsByParent,
  selectedIntentions,
  selectedSubIntentions,
  selectedListId = null,
  mode,
  isOpen,
  onOpenChange,
  onChange,
  onAction,
  disabled,
  showLabel = true,
  allowClear = true,
  clearLabel = 'Clear',
  parentSelectionLabel,
  emptyLabel = 'No intention',
  noSelectionLabel = 'No intention selected',
  returnFocusOnClose = true,
  shortcut,
  shortcutAlwaysShow = true,
  shortcutShowModIcon = false,
  shortcutPosition = 'indicator',
  searchAriaLabel,
  searchPlaceholder = 'Search intentions',
  direction = 'down',
  maxHeight = 240,
  triggerClassName,
  dropdownClassName,
  embedded = false,
  renderOptionAction,
  optionDataAttribute,
  listDataAttribute,
  triggerDataAttribute,
  triggerTestId,
  optionTestIdPrefix,
  listTestId,
  clearTestId,
}: IntentionAssignmentPickerProps) {
  const { t } = useI18n();
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [highlightedSubIntention, setHighlightedSubIntention] = useState<{
    parentSlug: string;
    subSlug: string;
  } | null>(null);
  const [searchText, setSearchText] = useState('');
  const [dropdownHeight, setDropdownHeight] = useState(maxHeight);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionContainerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const wasOpenRef = useRef(false);
  const shouldScrollHighlightedOptionRef = useRef(false);
  const generatedListId = useId();
  const listId = `intention-assignment-picker-list-${generatedListId}`;
  const optionValuesKey = options.map(option => option.value).join('\u001f');
  const selectedIntentionsKey = selectedIntentions.join('\u001f');
  const normalizedSearchText = normalizeSearchText(searchText);
  const filteredOptions = useMemo(
    () =>
      normalizedSearchText
        ? options.filter(option =>
            doesOptionMatchSearch(
              option,
              subIntentionsByParent[option.value] ?? [],
              normalizedSearchText
            )
          )
        : options,
    [normalizedSearchText, options, subIntentionsByParent]
  );
  const filteredOptionValuesKey = filteredOptions
    .map(option => option.value)
    .join('\u001f');

  const selectedSet = useMemo(
    () => new Set(selectedIntentions),
    [selectedIntentions]
  );
  const hasSelection = selectedIntentions.length > 0 || Boolean(selectedListId);
  const highlightedOption = filteredOptions[highlightedIndex];
  const activeOptionId = highlightedOption
    ? `${listId}-${normalizeDomId(highlightedOption.value)}`
    : undefined;

  useLayoutEffect(() => {
    const didOpen = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!didOpen) {
      return;
    }

    setSearchText('');
    if (!isMobile) {
      requestAnimationFrame(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          return;
        }
        triggerRef.current?.focus();
      });
    }

    const selectedIndex = Math.max(
      0,
      options.findIndex(option => selectedIntentions.includes(option.value))
    );
    shouldScrollHighlightedOptionRef.current = true;
    setHighlightedIndex(selectedIndex);
    setHighlightedSubIntention(null);
  }, [
    isOpen,
    options,
    optionValuesKey,
    selectedIntentions,
    selectedIntentionsKey,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setHighlightedIndex(index =>
      filteredOptions.length === 0
        ? 0
        : Math.min(index, filteredOptions.length - 1)
    );
    shouldScrollHighlightedOptionRef.current = true;
  }, [filteredOptions.length, filteredOptionValuesKey, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node | null)) {
        return;
      }

      onOpenChange(false);
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    return () =>
      document.removeEventListener('mousedown', handlePointerDown, true);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const updateHeight = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const available =
        direction === 'up'
          ? Math.floor(rect.top - 12)
          : Math.floor(window.innerHeight - rect.bottom - 12);
      setDropdownHeight(Math.max(128, Math.min(maxHeight, available)));
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [direction, isOpen, maxHeight]);

  useLayoutEffect(() => {
    if (!isOpen || !shouldScrollHighlightedOptionRef.current) {
      return;
    }
    shouldScrollHighlightedOptionRef.current = false;

    const option =
      optionContainerRefs.current[highlightedIndex] ??
      optionRefs.current[highlightedIndex];
    const scrollContainer = scrollRef.current;
    if (!option || !scrollContainer) {
      return;
    }

    const optionTop = option.offsetTop - scrollContainer.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;
    const visibleTop = scrollContainer.scrollTop;
    const visibleBottom = visibleTop + scrollContainer.clientHeight;

    if (optionTop < visibleTop) {
      scrollContainer.scrollTop = optionTop;
    } else if (optionBottom > visibleBottom) {
      scrollContainer.scrollTop = optionBottom - scrollContainer.clientHeight;
    }
  }, [filteredOptionValuesKey, highlightedIndex, isOpen]);

  const openPicker = () => {
    if (disabled || options.length === 0) {
      return;
    }

    onOpenChange(true);
  };

  const closePicker = () => {
    onOpenChange(false);
    if (returnFocusOnClose) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        openPicker();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      return;
    }

    if (
      event.target instanceof HTMLElement &&
      event.target.closest('[data-intention-picker-action]')
    ) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      shouldScrollHighlightedOptionRef.current = true;
      setHighlightedSubIntention(null);
      setHighlightedIndex(index =>
        filteredOptions.length === 0
          ? 0
          : Math.min(filteredOptions.length - 1, index + 1)
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      shouldScrollHighlightedOptionRef.current = true;
      setHighlightedSubIntention(null);
      setHighlightedIndex(index => Math.max(0, index - 1));
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      if (cycleHighlightedSubIntention(event.key === 'ArrowRight' ? 1 : -1)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightedSubIntention) {
        selectSubIntention(
          highlightedSubIntention.parentSlug,
          highlightedSubIntention.subSlug
        );
      } else if (highlightedOption) {
        selectOption(highlightedOption);
      }
    }
  };

  const clearSelection = () => {
    onChange({
      intentionSlugs: [],
      subIntentions: {},
      reason: 'clear',
    });
  };

  const selectOption = (option: IntentionAssignmentOption) => {
    if (option.isAction) {
      onAction?.(option, {
        searchText: (searchInputRef.current?.value ?? searchText).trim(),
      });
      closePicker();
      return;
    }

    if (option.assignmentType === 'list') {
      onChange({
        intentionSlugs: [],
        subIntentions: {},
        listId: option.value,
        reason: 'list',
      });
      closePicker();
      return;
    }

    if (mode === 'single') {
      const subIntentions = subIntentionsByParent[option.value] ?? [];
      const nextSubIntentions = selectedSubIntentions[option.value]
        ? { [option.value]: selectedSubIntentions[option.value] }
        : {};
      if (subIntentions.length > 0) {
        setHighlightedSubIntention({
          parentSlug: option.value,
          subSlug: nextSubIntentions[option.value] ?? subIntentions[0].slug,
        });
        return;
      }

      onChange({
        intentionSlugs: [option.value],
        subIntentions: nextSubIntentions,
        reason: 'intention',
      });
      closePicker();
      return;
    }

    const isSelected = selectedSet.has(option.value);
    const subIntentions = subIntentionsByParent[option.value] ?? [];
    if (!isSelected && subIntentions.length > 0) {
      setHighlightedSubIntention({
        parentSlug: option.value,
        subSlug: selectedSubIntentions[option.value] ?? subIntentions[0].slug,
      });
      return;
    }

    const nextIntentions = isSelected
      ? selectedIntentions.filter(slug => slug !== option.value)
      : [...selectedIntentions, option.value];
    const nextSubIntentions = { ...selectedSubIntentions };
    if (isSelected) {
      delete nextSubIntentions[option.value];
    }

    onChange({
      intentionSlugs: nextIntentions,
      subIntentions: nextSubIntentions,
      reason: 'intention',
    });
  };

  const cycleHighlightedSubIntention = (directionDelta: 1 | -1) => {
    const parentSlug =
      highlightedOption && !highlightedOption.isAction
        ? highlightedOption.value
        : null;
    if (!parentSlug) {
      return false;
    }

    const subIntentions = subIntentionsByParent[parentSlug] ?? [];
    if (subIntentions.length === 0) {
      return false;
    }

    const values = subIntentions.map(subIntention => subIntention.slug);
    const currentValue =
      highlightedSubIntention?.parentSlug === parentSlug
        ? highlightedSubIntention.subSlug
        : selectedSubIntentions[parentSlug];
    const currentIndex = values.indexOf(currentValue);
    const nextIndex =
      currentIndex === -1
        ? directionDelta === 1
          ? 0
          : values.length - 1
        : (currentIndex + directionDelta + values.length) % values.length;
    setHighlightedSubIntention({
      parentSlug,
      subSlug: values[nextIndex],
    });
    return true;
  };

  const selectSubIntention = (
    parentSlug: string,
    subSlug: string,
    closeAfterSelect = true
  ) => {
    if (
      !subSlug ||
      !(subIntentionsByParent[parentSlug] ?? []).some(
        subIntention => subIntention.slug === subSlug
      )
    ) {
      return;
    }

    const nextIntentions = selectedSet.has(parentSlug)
      ? selectedIntentions
      : mode === 'single'
        ? [parentSlug]
        : [...selectedIntentions, parentSlug];
    const nextSubIntentions = { ...selectedSubIntentions };

    nextSubIntentions[parentSlug] = subSlug;

    onChange({
      intentionSlugs: nextIntentions,
      subIntentions: nextSubIntentions,
      reason: 'subIntention',
    });
    setHighlightedSubIntention(null);
    if (closeAfterSelect) {
      closePicker();
    }
  };

  const selectParentIntention = (parentSlug: string) => {
    const nextIntentions =
      mode === 'single'
        ? [parentSlug]
        : selectedSet.has(parentSlug)
          ? selectedIntentions
          : [...selectedIntentions, parentSlug];
    const nextSubIntentions = { ...selectedSubIntentions };
    delete nextSubIntentions[parentSlug];
    onChange({
      intentionSlugs: nextIntentions,
      subIntentions: nextSubIntentions,
      reason: 'intention',
    });
    setHighlightedSubIntention(null);
    closePicker();
  };

  const selectedLabel = renderSelectedLabel({
    options,
    selectedIntentions,
    selectedSubIntentions,
    selectedListId,
    subIntentionsByParent,
    emptyLabel,
  });
  const dropdownPositionClass = embedded
    ? 'relative mt-1'
    : direction === 'up'
      ? 'bottom-[calc(100%+4px)]'
      : 'top-[calc(100%+4px)]';

  return (
    <div className="relative min-w-0" ref={rootRef} onKeyDown={handleKeyDown}>
      {showLabel ? (
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </span>
      ) : null}
      <button
        type="button"
        ref={triggerRef}
        onClick={() => (isOpen ? closePicker() : openPicker())}
        disabled={disabled || options.length === 0}
        className={clsx(
          'flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-700/50 bg-slate-800 px-3 text-left text-slate-100 outline-none transition-colors hover:bg-slate-700/70 focus:border-indigo-500/70 disabled:opacity-60',
          triggerClassName ?? 'h-10 text-sm'
        )}
        aria-haspopup="listbox"
        aria-label={label}
        aria-controls={isOpen ? listId : undefined}
        aria-activedescendant={isOpen ? activeOptionId : undefined}
        aria-expanded={isOpen}
        data-testid={triggerTestId}
        {...(triggerDataAttribute ? { [triggerDataAttribute]: true } : {})}
      >
        {selectedLabel}
        <span className="flex shrink-0 items-center gap-2">
          {mode === 'multi' && selectedIntentions.length > 1 ? (
            <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-100">
              {selectedIntentions.length}
            </span>
          ) : null}
          {shortcut ? (
            <KeyboardShortcut
              text={shortcut}
              showModIcon={shortcutShowModIcon}
              alwaysShow={shortcutAlwaysShow}
              position={shortcutPosition}
            />
          ) : null}
          <FaChevronDown
            size={12}
            className={`text-slate-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </span>
      </button>

      {isOpen ? (
        <div
          id={listId}
          role="listbox"
          className={clsx(
            embedded ? 'z-[100]' : 'absolute z-[100]',
            'overflow-hidden rounded-md border border-slate-700 bg-slate-950 shadow-xl',
            dropdownPositionClass,
            dropdownClassName ?? 'left-0 right-0'
          )}
          style={{ height: dropdownHeight }}
          data-testid={listTestId}
          {...(listDataAttribute ? { [listDataAttribute]: true } : {})}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {label}
              </span>
              {allowClear && hasSelection ? (
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={disabled}
                  className="rounded px-1.5 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-60"
                  data-testid={clearTestId}
                  data-intention-picker-action
                >
                  {clearLabel}
                </button>
              ) : null}
            </div>
            <div className="border-b border-slate-800 px-2 py-1.5">
              <input
                ref={searchInputRef}
                type="search"
                value={searchText}
                onChange={event => {
                  shouldScrollHighlightedOptionRef.current = true;
                  setHighlightedSubIntention(null);
                  setHighlightedIndex(0);
                  setSearchText(event.target.value);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchAriaLabel ?? `Search ${label}`}
                className="h-7 w-full rounded border border-slate-800 bg-slate-900 px-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60"
              />
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto p-1.5"
              data-intention-picker-scroll
            >
              {!hasSelection && noSelectionLabel ? (
                <div className="px-2 pb-1 pt-0.5 text-xs text-slate-500">
                  {noSelectionLabel}
                </div>
              ) : null}
              <div className="space-y-1">
                {filteredOptions.map((option, index) => {
                  const isAction = Boolean(option.isAction);
                  const isSelected =
                    !isAction &&
                    (option.assignmentType === 'list'
                      ? selectedListId === option.value
                      : selectedSet.has(option.value));
                  const isHighlighted = index === highlightedIndex;
                  const optionAction = !isAction
                    ? renderOptionAction?.(option)
                    : null;
                  const subIntentions = isAction
                    ? []
                    : (subIntentionsByParent[option.value] ?? []);
                  const selectedSubSlug = selectedSubIntentions[option.value];
                  const selectedSub = subIntentions.find(
                    subIntention => subIntention.slug === selectedSubSlug
                  );
                  const highlightedSubSlug =
                    highlightedSubIntention?.parentSlug === option.value
                      ? highlightedSubIntention.subSlug
                      : null;
                  const showSubIntentions =
                    !isAction && subIntentions.length > 0;
                  const showGroup =
                    option.group &&
                    option.group !== filteredOptions[index - 1]?.group;
                  return (
                    <Fragment key={option.value}>
                      {showGroup ? (
                        <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {option.group}
                        </div>
                      ) : null}
                      <div
                        ref={element => {
                          optionContainerRefs.current[index] = element;
                        }}
                        className={`rounded-md border transition-colors ${
                          isSelected
                            ? 'border-indigo-500/35 bg-indigo-500/10'
                            : isHighlighted
                              ? 'border-slate-700/70 bg-slate-900/70'
                              : 'border-transparent'
                        }`}
                      >
                        <div
                          className={
                            optionAction
                              ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1'
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            id={`${listId}-${normalizeDomId(option.value)}`}
                            ref={element => {
                              optionRefs.current[index] = element;
                            }}
                            onPointerEnter={() => {
                              shouldScrollHighlightedOptionRef.current = true;
                              setHighlightedSubIntention(null);
                              setHighlightedIndex(index);
                            }}
                            onClick={() => {
                              setHighlightedIndex(index);
                              selectOption(option);
                            }}
                            disabled={disabled}
                            aria-selected={isSelected}
                            role="option"
                            data-highlighted={isHighlighted}
                            data-testid={
                              optionTestIdPrefix
                                ? `${optionTestIdPrefix}-${option.value}`
                                : undefined
                            }
                            {...(optionDataAttribute
                              ? { [optionDataAttribute]: option.value }
                              : {})}
                            className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors disabled:opacity-60 ${
                              isSelected
                                ? 'text-indigo-100'
                                : isAction
                                  ? 'font-medium text-indigo-100 hover:bg-slate-800'
                                  : 'text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            {isAction ? (
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-indigo-200">
                                {option.icon}
                              </span>
                            ) : (
                              <>
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] ${
                                    isSelected
                                      ? 'border-indigo-300 bg-indigo-500 text-white'
                                      : 'border-slate-600 bg-slate-900'
                                  }`}
                                >
                                  {isSelected ? <FaCheck size={9} /> : null}
                                </span>
                                <IntentionEmojiPair
                                  parentEmoji={option.emoji}
                                  subEmoji={selectedSub?.emoji}
                                  size="xs"
                                />
                              </>
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {option.isNew ? 'New: ' : ''}
                              {selectedSub?.title ?? option.title}
                            </span>
                          </button>
                          {optionAction ? (
                            <span
                              className="mr-1 flex items-center justify-center"
                              data-intention-picker-action
                            >
                              {optionAction}
                            </span>
                          ) : null}
                        </div>
                        {showSubIntentions ? (
                          <div
                            className="px-2 pb-2 pl-8"
                            onClick={event => event.stopPropagation()}
                          >
                            <div
                              className="flex min-w-0 flex-wrap gap-1"
                              data-testid={`work-timer-log-sub-intention-${option.value}`}
                            >
                              {parentSelectionLabel ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    selectParentIntention(option.value)
                                  }
                                  disabled={disabled}
                                  aria-label={`${parentSelectionLabel.replace('{title}', option.title)}`}
                                  aria-pressed={
                                    isSelected && selectedSubSlug === undefined
                                  }
                                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-60 ${
                                    isSelected && selectedSubSlug === undefined
                                      ? 'border-cyan-300/70 bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-300/70'
                                      : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-500/20'
                                  }`}
                                  data-intention-picker-action
                                >
                                  {parentSelectionLabel.replace(
                                    '{title}',
                                    option.title
                                  )}
                                </button>
                              ) : null}
                              {subIntentions.map(subIntention => (
                                <button
                                  key={subIntention.slug}
                                  type="button"
                                  onClick={() =>
                                    selectSubIntention(
                                      option.value,
                                      subIntention.slug
                                    )
                                  }
                                  disabled={disabled}
                                  aria-pressed={
                                    selectedSubSlug === subIntention.slug
                                  }
                                  data-sub-highlighted={
                                    highlightedSubSlug === subIntention.slug
                                  }
                                  data-archived={
                                    subIntention.isArchived === true
                                  }
                                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-60 ${
                                    selectedSubSlug === subIntention.slug
                                      ? 'border-cyan-300/70 bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-300/70'
                                      : highlightedSubSlug === subIntention.slug
                                        ? 'border-cyan-300/60 bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-300/60'
                                        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-500/20'
                                  } ${subIntention.isArchived ? 'opacity-65' : ''}`}
                                  data-testid={`work-timer-log-sub-intention-${option.value}-${subIntention.slug}`}
                                  data-intention-picker-action
                                >
                                  <span>{subIntention.emoji}</span>
                                  <span>{subIntention.title}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </Fragment>
                  );
                })}
                {filteredOptions.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-slate-500">
                    {t('intention.noMatching')}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderSelectedLabel({
  options,
  selectedIntentions,
  selectedSubIntentions,
  selectedListId,
  subIntentionsByParent,
  emptyLabel,
}: {
  options: IntentionAssignmentOption[];
  selectedIntentions: string[];
  selectedSubIntentions: Record<string, string>;
  selectedListId: string | null;
  subIntentionsByParent: Record<string, SubIntentionAssignmentOption[]>;
  emptyLabel: string;
}) {
  if (selectedListId) {
    const option = options.find(
      item => item.assignmentType === 'list' && item.value === selectedListId
    );
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        <span className="flex min-w-0 shrink items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5">
          <span>{option?.emoji ?? '📋'}</span>
          <span className="min-w-0 truncate">
            {option?.title ?? emptyLabel}
          </span>
        </span>
      </span>
    );
  }
  if (selectedIntentions.length === 0) {
    return <span className="min-w-0 truncate">{emptyLabel}</span>;
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {selectedIntentions.map(slug => {
        const option = options.find(item => item.value === slug);
        const subSlug = selectedSubIntentions[slug];
        const subIntention = subIntentionsByParent[slug]?.find(
          item => item.slug === subSlug
        );
        const title = option?.title ?? slug;
        const displayTitle = subIntention?.title ?? title;

        return (
          <span
            key={slug}
            className="flex min-w-0 shrink items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5"
          >
            <IntentionEmojiPair
              parentEmoji={option?.emoji ?? ''}
              subEmoji={subIntention?.emoji}
              size="xs"
              title={subIntention ? subIntention.title : title}
            />
            <span className="min-w-0 truncate">
              {option?.isNew ? 'New: ' : ''}
              {displayTitle}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function normalizeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function doesOptionMatchSearch(
  option: IntentionAssignmentOption,
  subIntentions: SubIntentionAssignmentOption[],
  searchText: string
) {
  if (option.isAction) {
    return true;
  }

  const candidates = [option.title, option.emoji, option.value];
  return (
    candidates.some(candidate =>
      candidate.toLocaleLowerCase().includes(searchText)
    ) ||
    subIntentions.some(subIntention =>
      [subIntention.title, subIntention.emoji, subIntention.slug].some(
        candidate => candidate.toLocaleLowerCase().includes(searchText)
      )
    )
  );
}
