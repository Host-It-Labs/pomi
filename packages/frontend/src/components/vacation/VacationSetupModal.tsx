import type { Intention, List, ListItem, Task } from '@pomi/shared';
import { useCallback, useEffect, useState } from 'react';
import { FaChevronDown, FaRedo, FaUmbrellaBeach } from 'react-icons/fa';
import { apiClient } from '../../utils/apiClient';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { submitUserMutation } from '../../utils/userActionQueue';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useI18n } from '../../i18n';

const GENERAL_TASKS_GROUP_KEY = 'general';

export function VacationSetupModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const coverageConfigured =
    usePreferencesStore.use.preferences()?.vacationCoverageConfigured === true;
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [selectedIntentions, setSelectedIntentions] = useState<Set<string>>(
    new Set()
  );
  const [selectedLists, setSelectedLists] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [recurringOnlyGroups, setRecurringOnlyGroups] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void Promise.all([
      apiClient.intentions.list({ query: { includeSubIntentions: false } }),
      apiClient.lists.list({ query: {} }),
      apiClient.tasks.list({ query: { status: 'active' } }),
      apiClient.lists.items({ query: { status: 'active' } }),
    ]).then(
      ([intentionsResponse, listsResponse, tasksResponse, itemsResponse]) => {
        const nextIntentions =
          intentionsResponse.status === 200
            ? intentionsResponse.body.filter(
                item => !item.isArchived && !item.parentIntentionId
              )
            : [];
        const nextLists =
          listsResponse.status === 200 ? listsResponse.body : [];
        const nextTasks =
          tasksResponse.status === 200 ? tasksResponse.body : [];
        const nextItems =
          itemsResponse.status === 200 ? itemsResponse.body : [];
        setIntentions(nextIntentions);
        setLists(nextLists);
        setTasks(nextTasks);
        setItems(nextItems);
        setRecurringOnlyGroups(new Set());
        const selectableIntentions = nextIntentions.filter(intention =>
          nextTasks.some(task => task.intentionSlug === intention.slug)
        );
        const configuredIntentions = selectableIntentions.filter(
          item =>
            item.vacationDefault === true ||
            nextTasks.some(
              task =>
                task.intentionSlug === item.slug &&
                task.vacationEligible === true
            )
        );
        const configuredLists = nextLists.filter(
          item =>
            item.vacationDefault === true ||
            nextItems.some(
              listItem =>
                listItem.listId === item.id &&
                listItem.vacationEligible === true
            )
        );
        setSelectedIntentions(
          new Set(
            (coverageConfigured
              ? configuredIntentions
              : selectableIntentions
            ).map(item => item.slug)
          )
        );
        setSelectedLists(
          new Set(
            (coverageConfigured ? configuredLists : nextLists).map(
              item => item.id
            )
          )
        );
        const allItems = [...nextTasks, ...nextItems];
        setExcluded(getInitialVacationExclusions(allItems, coverageConfigured));
      }
    );
  }, [coverageConfigured, isOpen]);

  const toggleGroup = (key: string) =>
    setOpenGroups(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setGroupIncluded = useCallback(
    (key: string, checked: boolean) => {
      if (key.startsWith('i:')) {
        const slug = key.slice(2);
        const groupTasks = tasks.filter(task => task.intentionSlug === slug);
        setSelectedIntentions(current => updateSet(current, slug, checked));
        setExcluded(current => {
          const next = new Set(current);
          groupTasks.forEach(task => {
            if (checked) next.delete(task.id);
            else next.add(task.id);
          });
          return next;
        });
        setRecurringOnlyGroups(current => removeFromSet(current, [key]));
        return;
      }

      const listId = key.slice(2);
      const groupItems = items.filter(item => item.listId === listId);
      setSelectedLists(current => updateSet(current, listId, checked));
      setExcluded(current => {
        const next = new Set(current);
        groupItems.forEach(item => {
          if (checked) next.delete(item.id);
          else next.add(item.id);
        });
        return next;
      });
    },
    [items, tasks]
  );

  const setRecurringOnly = useCallback(
    (groupKey: string, groupTasks: Task[], enabled: boolean) => {
      if (enabled && !groupTasks.some(task => Boolean(task.recurrenceRule))) {
        return;
      }
      if (groupKey.startsWith('i:')) {
        setSelectedIntentions(current =>
          updateSet(current, groupKey.slice(2), true)
        );
      }
      setExcluded(current =>
        enabled
          ? selectOnlyRecurringTasks(current, groupTasks)
          : removeFromSet(
              current,
              groupTasks.map(task => task.id)
            )
      );
      setRecurringOnlyGroups(current => updateSet(current, groupKey, enabled));
      setOpenGroups(current => updateSet(current, groupKey, true));
    },
    []
  );

  const setGeneralTasksIncluded = useCallback(
    (checked: boolean) => {
      const generalTasks = tasks.filter(task => !task.intentionSlug);
      setExcluded(current => {
        const next = new Set(current);
        generalTasks.forEach(task => {
          if (checked) next.delete(task.id);
          else next.add(task.id);
        });
        return next;
      });
      setRecurringOnlyGroups(current =>
        removeFromSet(current, [GENERAL_TASKS_GROUP_KEY])
      );
    },
    [tasks]
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await submitUserMutation({
        kind: 'vacation',
        label: t('vacation.configure'),
        payload: {
          operation: 'configure',
          intentionSlugs: [...selectedIntentions],
          listIds: [...selectedLists],
          excludedItemIds: [...excluded],
        },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [excluded, onClose, selectedIntentions, selectedLists]);

  const intentionsWithTasks = intentions.filter(intention =>
    tasks.some(task => task.intentionSlug === intention.slug)
  );
  const intentionsWithoutTasks = intentions.filter(
    intention => !tasks.some(task => task.intentionSlug === intention.slug)
  );
  const generalTasks = tasks.filter(task => !task.intentionSlug);
  const generalTasksSelection = getGroupSelectionState(generalTasks, excluded);
  const generalRecurringOnly = recurringOnlyGroups.has(GENERAL_TASKS_GROUP_KEY);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('vacation.coverage')}
      closeOnBackdropClick
      closeOnEscape
      className="max-h-[85dvh] overflow-hidden sm:max-w-lg"
    >
      <div className="flex min-h-0 max-h-[calc(85dvh-7rem)] flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3 pr-1">
          <div className="flex items-start gap-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100">
            <FaUmbrellaBeach className="mt-0.5 shrink-0" />
            {t('vacation.modeEffect')}
          </div>
          <p className="text-xs text-slate-500">
            {t('vacation.coverageInstructions')}
          </p>
          {intentionsWithTasks.map(intention => {
            const groupTasks = tasks.filter(
              task => task.intentionSlug === intention.slug
            );
            const { recurring, nonRecurring } =
              partitionRecurringTasks(groupTasks);
            const groupKey = `i:${intention.slug}`;
            const recurringOnly = recurringOnlyGroups.has(groupKey);
            const open = openGroups.has(groupKey);
            const selection = getGroupSelectionState(groupTasks, excluded);
            return (
              <Group
                key={intention.slug}
                label={`${intention.emoji} ${intention.title}`}
                checked={selection.checked}
                indeterminate={selection.indeterminate}
                open={open}
                onChecked={checked => setGroupIncluded(groupKey, checked)}
                onOpen={() => toggleGroup(`i:${intention.slug}`)}
                headerAction={
                  <RecurringOnlyButton
                    label={intention.title}
                    active={recurringOnly}
                    disabled={recurring.length === 0}
                    onChange={enabled =>
                      setRecurringOnly(groupKey, groupTasks, enabled)
                    }
                  />
                }
              >
                {recurringOnly ? (
                  <>
                    <TaskSection
                      label={t('vacation.recurring')}
                      tasks={recurring}
                      excluded={excluded}
                      onChange={(taskId, checked) => {
                        setExcluded(current =>
                          updateSet(current, taskId, !checked)
                        );
                      }}
                    />
                    <TaskSection
                      label={t('vacation.notRecurring')}
                      tasks={nonRecurring}
                      excluded={excluded}
                      onChange={(taskId, checked) => {
                        setExcluded(current =>
                          updateSet(current, taskId, !checked)
                        );
                      }}
                    />
                  </>
                ) : (
                  <TaskSection
                    tasks={groupTasks}
                    excluded={excluded}
                    onChange={(taskId, checked) =>
                      setExcluded(current =>
                        updateSet(current, taskId, !checked)
                      )
                    }
                  />
                )}
              </Group>
            );
          })}
          {generalTasks.length > 0 ? (
            <GeneralTasksGroup
              tasks={generalTasks}
              excluded={excluded}
              open={openGroups.has(GENERAL_TASKS_GROUP_KEY)}
              recurringOnly={generalRecurringOnly}
              checked={generalTasksSelection.checked}
              indeterminate={generalTasksSelection.indeterminate}
              onChecked={setGeneralTasksIncluded}
              onOpen={() => toggleGroup(GENERAL_TASKS_GROUP_KEY)}
              onRecurringOnly={enabled =>
                setRecurringOnly(GENERAL_TASKS_GROUP_KEY, generalTasks, enabled)
              }
              onTaskChange={(taskId, checked) =>
                setExcluded(current => updateSet(current, taskId, !checked))
              }
            />
          ) : null}
          {lists.map(list => {
            const groupItems = items.filter(item => item.listId === list.id);
            const open = openGroups.has(`l:${list.id}`);
            const groupKey = `l:${list.id}`;
            const selection = getGroupSelectionState(groupItems, excluded);
            return (
              <Group
                key={list.id}
                label={`${list.emoji ?? '☰'} ${list.title}`}
                checked={
                  groupItems.length === 0
                    ? selectedLists.has(list.id)
                    : selection.checked
                }
                indeterminate={selection.indeterminate}
                open={open}
                onChecked={checked => setGroupIncluded(groupKey, checked)}
                onOpen={() => toggleGroup(`l:${list.id}`)}
                headerAction={null}
              >
                {groupItems.map(item => (
                  <ItemToggle
                    key={item.id}
                    title={item.title}
                    checked={!excluded.has(item.id)}
                    onChange={checked =>
                      setExcluded(current =>
                        updateSet(current, item.id, !checked)
                      )
                    }
                  />
                ))}
              </Group>
            );
          })}
          {intentionsWithoutTasks.length > 0 ? (
            <section className="space-y-2 border-t border-slate-800 pt-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-400">
                  {t('vacation.noActiveTasks')}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  {t('vacation.intentionsUnavailable')}
                </p>
              </div>
              <div className="space-y-2">
                {intentionsWithoutTasks.map(intention => (
                  <div
                    key={intention.slug}
                    aria-disabled="true"
                    className="flex items-center gap-2 rounded-xl border border-slate-800/70 bg-slate-950/30 px-3 py-2.5 opacity-55"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
                      {intention.emoji} {intention.title}
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
                      {t('vacation.noTasks')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-slate-800 bg-slate-900/95 pt-3 backdrop-blur-sm">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? t('common.savingEllipsis') : t('vacation.saveCoverage')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Group({
  label,
  checked,
  indeterminate,
  open,
  onChecked,
  onOpen,
  headerAction,
  children,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  open: boolean;
  onChecked: (checked: boolean) => void;
  onOpen: () => void;
  headerAction: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const isIndeterminate = indeterminate === true;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50">
      <div className="flex items-center gap-2 p-3">
        <input
          ref={input => {
            if (input) input.indeterminate = isIndeterminate;
          }}
          type="checkbox"
          aria-label={t('vacation.includeFor', { label })}
          checked={checked}
          onChange={event => onChecked(event.target.checked)}
          className="h-4 w-4 accent-indigo-500"
        />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-100">
          {label}
        </span>
        {headerAction}
        <button
          type="button"
          aria-label={t('vacation.expandFor', { label })}
          onClick={onOpen}
          className="p-2 text-slate-500"
        >
          <FaChevronDown className={open ? 'rotate-180' : ''} size={10} />
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-slate-800 p-2">
          {children}
        </div>
      )}
    </div>
  );
}

function GeneralTasksGroup({
  tasks,
  excluded,
  checked,
  indeterminate,
  open,
  recurringOnly,
  onChecked,
  onOpen,
  onRecurringOnly,
  onTaskChange,
}: {
  tasks: Task[];
  excluded: Set<string>;
  checked: boolean;
  indeterminate: boolean;
  open: boolean;
  recurringOnly: boolean;
  onChecked: (checked: boolean) => void;
  onOpen: () => void;
  onRecurringOnly: (enabled: boolean) => void;
  onTaskChange: (taskId: string, checked: boolean) => void;
}) {
  const { t } = useI18n();
  const { recurring, nonRecurring } = partitionRecurringTasks(tasks);
  const label = t('task.general');
  return (
    <Group
      label={label}
      checked={checked}
      indeterminate={indeterminate}
      open={open}
      onChecked={onChecked}
      onOpen={onOpen}
      headerAction={
        <RecurringOnlyButton
          label={label}
          active={recurringOnly}
          disabled={recurring.length === 0}
          onChange={onRecurringOnly}
        />
      }
    >
      {recurringOnly ? (
        <>
          <TaskSection
            label={t('vacation.recurring')}
            tasks={recurring}
            excluded={excluded}
            onChange={onTaskChange}
          />
          <TaskSection
            label={t('vacation.notRecurring')}
            tasks={nonRecurring}
            excluded={excluded}
            onChange={onTaskChange}
          />
        </>
      ) : (
        <TaskSection
          tasks={tasks}
          excluded={excluded}
          onChange={onTaskChange}
        />
      )}
    </Group>
  );
}

function RecurringOnlyButton({
  label,
  active,
  disabled,
  onChange,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t(
        active ? 'vacation.showAllFor' : 'vacation.showOnlyRecurringFor',
        { label }
      )}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onChange(!active)}
      className={`flex h-6 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-cyan-500/15 text-cyan-200'
          : 'bg-slate-900 text-slate-500 hover:bg-slate-800 hover:text-slate-200'
      }`}
      title={
        disabled
          ? t('vacation.noRecurringTasks')
          : active
            ? t('vacation.showAllTasks')
            : t('vacation.onlyRecurringTasks')
      }
    >
      <span>{t('vacation.only')}</span>
      <FaRedo size={10} />
    </button>
  );
}

function TaskSection({
  label,
  tasks,
  excluded,
  onChange,
}: {
  label?: string;
  tasks: Task[];
  excluded: Set<string>;
  onChange: (taskId: string, checked: boolean) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-1">
      {label ? (
        <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
      ) : null}
      {tasks.map(task => (
        <ItemToggle
          key={task.id}
          title={task.title}
          checked={!excluded.has(task.id)}
          onChange={checked => onChange(task.id, checked)}
        />
      ))}
    </div>
  );
}

function ItemToggle({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-300 hover:bg-slate-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="accent-indigo-500"
      />
      <span className="truncate">{title}</span>
    </label>
  );
}

export function partitionRecurringTasks(tasks: Task[]) {
  return {
    recurring: tasks.filter(task => Boolean(task.recurrenceRule)),
    nonRecurring: tasks.filter(task => !task.recurrenceRule),
  };
}

export function selectOnlyRecurringTasks(current: Set<string>, tasks: Task[]) {
  const next = new Set(current);
  tasks.forEach(task => {
    if (task.recurrenceRule) next.delete(task.id);
    else next.add(task.id);
  });
  return next;
}

export function getGroupSelectionState(
  items: Array<Pick<Task | ListItem, 'id'>>,
  excluded: Set<string>
) {
  const includedCount = items.filter(item => !excluded.has(item.id)).length;
  return {
    checked: items.length > 0 && includedCount === items.length,
    indeterminate: includedCount > 0 && includedCount < items.length,
  };
}

export function getInitialVacationExclusions(
  items: Array<Pick<Task | ListItem, 'id' | 'vacationEligible'>>,
  coverageConfigured: boolean
) {
  return new Set(
    coverageConfigured
      ? items
          .filter(item => item.vacationEligible === false)
          .map(item => item.id)
      : []
  );
}

function updateSet(current: Set<string>, key: string, add: boolean) {
  const next = new Set(current);
  if (add) next.add(key);
  else next.delete(key);
  return next;
}

export function removeFromSet(current: Set<string>, keys: string[]) {
  const next = new Set(current);
  keys.forEach(key => next.delete(key));
  return next;
}
