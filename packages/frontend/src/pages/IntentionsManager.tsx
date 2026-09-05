import { requestListRefresh } from '../utils/listRefresh';
import { HabitCadence, Intention, IntentionType, List } from '@pomi/shared';
import { TIMER_TYPES } from '@pomi/shared/src/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaEllipsisH,
  FaArchive,
  FaCaretDown,
  FaCaretRight,
  FaClock,
  FaListUl,
  FaPlus,
  FaShare,
  FaTrash,
  FaUndo,
} from 'react-icons/fa';
import { BackButton } from '../components/BackButton';
import { ManagerRowActions } from '../components/intentions/ManagerRowActions';
import { showToastFromStore } from '../components/toast/ToastContext';
import { BottomSheet, SheetOptions } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormField } from '../components/ui/FormField';
import { Input } from '../components/ui/Input';
import { KeyboardShortcut } from '../components/ui/KeyboardShortcut';
import { Modal } from '../components/ui/Modal';
import { PageContainer } from '../components/ui/PageContainer';
import { PageShell } from '../components/ui/PageShell';
import { Spinner } from '../components/ui/Spinner';
import { ToggleField } from '../components/ui/ToggleField';
import { UnsavedChangesDialog } from '../components/ui/UnsavedChangesDialog';
import {
  DEFAULT_BREAK_INTENTION_MINUTES,
  DEFAULT_LONG_BREAK_INTENTION_MINUTES,
  DEFAULT_WORK_INTENTION_MINUTES,
} from '../constants/intentions';
import { MILLISECONDS_PER_MINUTE } from '../constants/time';
import { useI18n } from '../i18n';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import { apiClient } from '../utils/apiClient';
import { stableFavoriteFirst } from '../utils/favoriteFirst';
import { hasOpenModal } from '../utils/modalRegistry';
import { isDesktop } from '../utils/osUtils';
import { subscribeToIntentionRefresh } from '../utils/recoveryRefresh';
import { submitUserMutation } from '../utils/userActionQueue';

type TabType = 'work' | 'break' | 'longBreak' | 'lists';

export function IntentionConversionModal({
  intention,
  childCount,
  onClose,
  onConvert,
}: {
  intention: Intention | null;
  childCount: number;
  onClose: () => void;
  onConvert: (intention: Intention) => void | Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Modal
      isOpen={intention !== null}
      onClose={onClose}
      title={t('intention.makeList')}
      closeOnBackdropClick={true}
      closeOnEscape={true}
    >
      {intention && (
        <>
          <p className="text-sm leading-6 text-slate-300">
            {childCount > 0
              ? t('intention.convertWithChildren', {
                  title: intention.title,
                })
              : t('intention.convertSingle', {
                  title: intention.title,
                })}
          </p>
          {childCount > 0 && (
            <p className="mt-3 text-sm leading-6 text-amber-300">
              {t('intention.convertDirectTasksWarning')}
            </p>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void onConvert(intention)}>
              {t('intention.makeListAction')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function IntentionsManager({ editorOnly }: { editorOnly?: boolean }) {
  const { t } = useI18n();
  const [workIntentions, setWorkIntentions] = useState<Intention[]>([]);
  const [breakIntentions, setBreakIntentions] = useState<Intention[]>([]);
  const [longBreakIntentions, setLongBreakIntentions] = useState<Intention[]>(
    []
  );
  const [archivedIntentions, setArchivedIntentions] = useState<Intention[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [archivedLists, setArchivedLists] = useState<List[]>([]);
  const [editingList, setEditingList] = useState<List | null>(null);
  const [isListFormOpen, setIsListFormOpen] = useState(false);
  const [listTitle, setListTitle] = useState('');
  const [listEmoji, setListEmoji] = useState('');
  const [listDescription, setListDescription] = useState('');
  const [listIsFavorite, setListIsFavorite] = useState(false);
  const [initialListFormKey, setInitialListFormKey] = useState('');
  const [showListDiscardConfirm, setShowListDiscardConfirm] = useState(false);
  const [currentTab, setCurrentTab] = useState<TabType>('work');
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingIntention, setEditingIntention] = useState<Intention | null>(
    null
  );
  const [newTitle, setNewTitle] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState<IntentionType>(TIMER_TYPES.WORK);
  const [newParentIntentionId, setNewParentIntentionId] = useState<
    string | null
  >(null);
  const [newHasCustomDuration, setNewHasCustomDuration] = useState(false);
  const [newCustomDuration, setNewCustomDuration] = useState(25);
  const [newKeepScreenAwake, setNewKeepScreenAwake] = useState(false);
  const [newIsHabit, setNewIsHabit] = useState(false);
  const [newHabitCadence, setNewHabitCadence] = useState<HabitCadence>('off');
  const [newAllowsTasks, setNewAllowsTasks] = useState(true);
  const [showDisableTasksConfirm, setShowDisableTasksConfirm] = useState(false);
  const [intentionToConvert, setIntentionToConvert] =
    useState<Intention | null>(null);
  const [initialFormKey, setInitialFormKey] = useState('');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [intentionToRemove, setIntentionToRemove] = useState<Intention | null>(
    null
  );
  const [removeMode, setRemoveMode] = useState<'choose' | 'delete'>('choose');
  const [keepStatsOnDelete, setKeepStatsOnDelete] = useState(true);
  const [isArchivedModalOpen, setIsArchivedModalOpen] = useState(false);
  const [expandedParentIds, setExpandedParentIds] = useState<
    Record<string, boolean>
  >({});
  const [intentionToReparent, setIntentionToReparent] =
    useState<Intention | null>(null);
  const [selectedReparentSlug, setSelectedReparentSlug] = useState('');
  const [listOverflows, setListOverflows] = useState(false);
  const [bottomButtonVisible, setBottomButtonVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomButtonRef = useRef<HTMLDivElement>(null);

  const setActiveTab = useUiStore.use.setActiveTab();
  const intentionCreateRequested = useUiStore.use.intentionCreateRequested();
  const clearIntentionCreateRequest =
    useUiStore.use.clearIntentionCreateRequest();
  const timer = useTimerStore.use.timer();
  const preferences = usePreferencesStore.use.preferences();

  const getDefaultIntentionType = useCallback((): IntentionType => {
    if (preferences?.intentionBreakIntentions) {
      if (timer?.type === TIMER_TYPES.LONG_BREAK) {
        return TIMER_TYPES.LONG_BREAK;
      }
      if (timer?.type === TIMER_TYPES.BREAK) {
        return TIMER_TYPES.BREAK;
      }
    }
    return TIMER_TYPES.WORK;
  }, [preferences?.intentionBreakIntentions, timer?.type]);

  const openCreateIntentionModal = useCallback(
    (parent?: Intention) => {
      const defaultType = parent?.type ?? getDefaultIntentionType();
      setEditingIntention(null);
      setNewTitle('');
      setNewEmoji('');
      setNewDescription('');
      setNewType(defaultType);
      setNewParentIntentionId(parent?.id ?? null);
      setNewHasCustomDuration(false);
      setNewKeepScreenAwake(false);
      setNewIsHabit(false);
      setNewAllowsTasks(true);
      setNewCustomDuration(
        defaultType === TIMER_TYPES.WORK
          ? DEFAULT_WORK_INTENTION_MINUTES
          : defaultType === TIMER_TYPES.LONG_BREAK
            ? DEFAULT_LONG_BREAK_INTENTION_MINUTES
            : DEFAULT_BREAK_INTENTION_MINUTES
      );
      setInitialFormKey(
        serializeIntentionFormState({
          title: '',
          emoji: '',
          type: defaultType,
          parentIntentionId: parent?.id ?? null,
          hasCustomDuration: false,
          customDuration:
            defaultType === TIMER_TYPES.WORK
              ? DEFAULT_WORK_INTENTION_MINUTES
              : defaultType === TIMER_TYPES.LONG_BREAK
                ? DEFAULT_LONG_BREAK_INTENTION_MINUTES
                : DEFAULT_BREAK_INTENTION_MINUTES,
          keepScreenAwake: false,
          isHabit: false,
          habitCadence: 'off',
          allowsTasks: true,
          description: '',
        })
      );
      setShowDiscardConfirm(false);
      setIsFormModalOpen(true);
    },
    [getDefaultIntentionType]
  );

  const loadIntentions = async () => {
    try {
      const workResponse = await apiClient.intentions.list({
        query: {
          type: TIMER_TYPES.WORK,
          includeSubIntentions: preferences?.intentionSubIntentions
            ? true
            : undefined,
        },
      });
      if (workResponse.status === 200) {
        setWorkIntentions(workResponse.body.filter(i => !i.isArchived));
      }

      if (preferences?.intentionBreakIntentions) {
        const [breakResponse, longBreakResponse] = await Promise.all([
          apiClient.intentions.list({
            query: {
              type: TIMER_TYPES.BREAK,
              includeSubIntentions: preferences?.intentionSubIntentions
                ? true
                : undefined,
            },
          }),
          apiClient.intentions.list({
            query: {
              type: TIMER_TYPES.LONG_BREAK,
              includeSubIntentions: preferences?.intentionSubIntentions
                ? true
                : undefined,
            },
          }),
        ]);
        if (breakResponse.status === 200) {
          setBreakIntentions(breakResponse.body.filter(i => !i.isArchived));
        }
        if (longBreakResponse.status === 200) {
          setLongBreakIntentions(
            longBreakResponse.body.filter(i => !i.isArchived)
          );
        }
      }

      const allResponse = await apiClient.intentions.list({
        query: {
          includeSubIntentions: preferences?.intentionSubIntentions
            ? true
            : undefined,
        },
      });
      if (allResponse.status === 200) {
        setArchivedIntentions(allResponse.body.filter(i => i.isArchived));
      }
      if (preferences?.listsExtension) {
        const listsResponse = await apiClient.lists.list({
          query: { includeArchived: 'true' },
        });
        if (listsResponse.status === 200) {
          setLists(listsResponse.body.filter(list => !list.isArchived));
          setArchivedLists(listsResponse.body.filter(list => list.isArchived));
        }
      } else {
        setLists([]);
        setArchivedLists([]);
        if (currentTab === 'lists') setCurrentTab('work');
      }
    } catch (error) {
      console.error('Failed to load intentions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadIntentions();
    return subscribeToIntentionRefresh(() => void loadIntentions());
  }, [
    preferences?.intentionBreakIntentions,
    preferences?.intentionSubIntentions,
    preferences?.listsExtension,
  ]);

  useEffect(() => {
    if (!isDesktop) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (hasOpenModal()) {
        return;
      }

      if (e.key === 'Escape') {
        if (isFormModalOpen || intentionToRemove) {
          e.stopImmediatePropagation();
          if (isFormModalOpen) {
            cancelAction();
          }
          if (intentionToRemove) {
            setIntentionToRemove(null);
            setRemoveMode('choose');
          }
          return;
        }
        if (!editorOnly) handleReturn();
      }
      if (e.key === '0' && (e.metaKey || e.ctrlKey) && !isFormModalOpen) {
        if (!(e.target instanceof HTMLElement)) return;
        if (
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT' ||
          e.target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        openCreateIntentionModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    editorOnly,
    isFormModalOpen,
    intentionToRemove,
    openCreateIntentionModal,
  ]);

  useEffect(() => {
    if (!intentionCreateRequested) {
      return;
    }

    openCreateIntentionModal();
    clearIntentionCreateRequest();
  }, [
    clearIntentionCreateRequest,
    intentionCreateRequested,
    openCreateIntentionModal,
  ]);

  const handleReturn = () => {
    setActiveTab('timer');
  };

  const handleCreateIntention = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const finalDuration =
        newHasCustomDuration && newCustomDuration > 0
          ? newCustomDuration * MILLISECONDS_PER_MINUTE
          : undefined;

      const body = {
        title: newTitle,
        emoji: newEmoji,
        type: newType,
        hasCustomDuration: newHasCustomDuration && newCustomDuration > 0,
        customDuration: finalDuration,
        keepScreenAwake: newKeepScreenAwake,
        isHabit: newIsHabit,
        habitCadence: newHabitCadence,
        parentIntentionId:
          preferences?.intentionSubIntentions && newParentIntentionId
            ? newParentIntentionId
            : undefined,
        description: preferences?.destinationDescriptionsEnabled
          ? newDescription.trim() || null
          : undefined,
        allowsTasks: newParentIntentionId ? undefined : newAllowsTasks,
      };
      const result = await submitUserMutation({
        kind: 'intentions',
        label: t('intention.create'),
        payload: { operation: 'create', ...body },
        reconcile: loadIntentions,
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: Intention })
          : { status: 201, body: result as Intention };

      resetForm();
      showToastFromStore(
        t('intention.created', { title: response.body.title }),
        'success'
      );
    } catch (error) {
      console.error('Failed to create intention:', error);
    }
  };

  const handleUpdateIntention = async (
    slug: string,
    type: IntentionType,
    e: React.FormEvent
  ) => {
    e.preventDefault();
    try {
      const finalDuration =
        newHasCustomDuration && newCustomDuration > 0
          ? newCustomDuration * MILLISECONDS_PER_MINUTE
          : undefined;

      const body = {
        title: newTitle,
        emoji: newEmoji,
        type,
        hasCustomDuration: newHasCustomDuration && newCustomDuration > 0,
        customDuration: finalDuration,
        keepScreenAwake: newKeepScreenAwake,
        isHabit: newIsHabit,
        habitCadence: newHabitCadence,
        parentIntentionId:
          preferences?.intentionSubIntentions &&
          newParentIntentionId !== editingIntention?.parentIntentionId
            ? newParentIntentionId
            : undefined,
        description: preferences?.destinationDescriptionsEnabled
          ? newDescription.trim() || null
          : undefined,
        allowsTasks: editingIntention?.parentIntentionId
          ? undefined
          : newAllowsTasks,
      };
      await submitUserMutation({
        kind: 'intentions',
        label: t('intention.update'),
        payload: { operation: 'update', slug, ...body },
        reconcile: loadIntentions,
      });

      resetForm();
    } catch (error) {
      console.error('Failed to update intention:', error);
    }
  };

  const handleArchiveIntention = async (slug: string, type: IntentionType) => {
    try {
      await submitUserMutation({
        kind: 'intentions',
        label: t('intention.archiveAction'),
        payload: { operation: 'archive', slug, type },
        reconcile: loadIntentions,
      });
      resetForm();
      setIntentionToRemove(null);
      setRemoveMode('choose');
    } catch (error) {
      console.error('Failed to archive intention:', error);
    }
  };

  const convertIntentionToList = async (intention: Intention) => {
    await submitUserMutation({
      kind: 'lists',
      label: t('intention.convertToList'),
      payload: { operation: 'convertIntention', intentionSlug: intention.slug },
      reconcile: loadIntentions,
    });
    resetForm();
    setIntentionToConvert(null);
    setCurrentTab('lists');
    await loadIntentions();
    const childCount = getSubIntentionsForParent(intention).length;
    showToastFromStore(
      childCount > 0
        ? t('lists.convertedFromIntention', {
            count: childCount,
            title: intention.title,
          })
        : t('lists.intentionConverted', { title: intention.title }),
      'success'
    );
  };

  const toggleFavoriteIntention = async (intention: Intention) => {
    await submitUserMutation({
      kind: 'intentions',
      label: intention.isFavorite
        ? t('intention.removeFavoriteAction')
        : t('intention.favoriteAction'),
      payload: {
        operation: 'update',
        slug: intention.slug,
        title: intention.title,
        emoji: intention.emoji,
        type: intention.type,
        hasCustomDuration: intention.hasCustomDuration,
        customDuration: intention.customDuration ?? undefined,
        keepScreenAwake: intention.keepScreenAwake,
        isHabit: intention.isHabit,
        isFavorite: !intention.isFavorite,
        allowsTasks: intention.parentIntentionId
          ? undefined
          : intention.allowsTasks,
      },
      reconcile: loadIntentions,
    });
    await loadIntentions();
  };

  const toggleFavoriteList = async (list: List) => {
    await submitUserMutation({
      kind: 'lists',
      label: list.isFavorite
        ? t('lists.removeFavoriteAction')
        : t('lists.favoriteAction'),
      payload: {
        operation: 'update',
        listId: list.id,
        isFavorite: !list.isFavorite,
      },
      reconcile: loadIntentions,
    });
    await loadIntentions();
  };

  const handleUnarchiveIntention = async (
    slug: string,
    type: IntentionType
  ) => {
    try {
      await submitUserMutation({
        kind: 'intentions',
        label: t('intention.restore'),
        payload: { operation: 'unarchive', slug, type },
        reconcile: loadIntentions,
      });
    } catch (error) {
      console.error('Failed to unarchive intention:', error);
    }
  };

  const handleDeleteIntention = async (
    slug: string,
    type: IntentionType,
    keepStats: boolean
  ) => {
    try {
      await submitUserMutation({
        kind: 'intentions',
        label: t('intention.deleteAction'),
        payload: { operation: 'delete', slug, type, keepStats },
        reconcile: loadIntentions,
      });
      setIntentionToRemove(null);
      setRemoveMode('choose');
      setKeepStatsOnDelete(true);
    } catch (error) {
      console.error('Failed to delete intention:', error);
    }
  };

  const handleReparentIntention = async () => {
    if (!intentionToReparent || !selectedReparentSlug) return;

    try {
      if (!selectedReparentSlug) {
        throw new Error(t('intention.parentResolutionFailed'));
      }
      await submitUserMutation({
        kind: 'intentions',
        label: t('intention.move'),
        payload: {
          operation: 'reparent',
          slug: intentionToReparent.slug,
          type: intentionToReparent.type,
          parentSlug: selectedReparentSlug,
        },
        reconcile: loadIntentions,
      });
      setIntentionToReparent(null);
      setSelectedReparentSlug('');
    } catch (error) {
      console.error('Failed to reparent intention:', error);
    }
  };

  const promptRemoveIntention = (intention: Intention) => {
    setIntentionToRemove(intention);
    setRemoveMode('choose');
    setKeepStatsOnDelete(true);
  };

  const promptReparentIntention = (intention: Intention) => {
    const parentOptions = getTopLevelIntentionsForType(intention.type).filter(
      parent => parent.slug !== intention.slug
    );
    setIntentionToReparent(intention);
    setSelectedReparentSlug(parentOptions[0]?.slug ?? '');
  };

  const startEditing = (intention: Intention) => {
    const customDuration = intention.customDuration
      ? Math.round(intention.customDuration / MILLISECONDS_PER_MINUTE)
      : intention.type === TIMER_TYPES.WORK
        ? DEFAULT_WORK_INTENTION_MINUTES
        : intention.type === TIMER_TYPES.LONG_BREAK
          ? DEFAULT_LONG_BREAK_INTENTION_MINUTES
          : DEFAULT_BREAK_INTENTION_MINUTES;
    setEditingIntention(intention);
    setIsFormModalOpen(true);
    setNewTitle(intention.title);
    setNewEmoji(intention.emoji);
    setNewDescription(intention.description ?? '');
    setNewType(intention.type);
    setNewParentIntentionId(intention.parentIntentionId);
    setNewHasCustomDuration(intention.hasCustomDuration);
    setNewKeepScreenAwake(intention.keepScreenAwake);
    setNewIsHabit(intention.isHabit);
    setNewHabitCadence(
      intention.habitCadence ?? (intention.isHabit ? 'daily' : 'off')
    );
    setNewAllowsTasks(intention.allowsTasks !== false);
    setNewCustomDuration(customDuration);
    setInitialFormKey(
      serializeIntentionFormState({
        title: intention.title,
        emoji: intention.emoji,
        type: intention.type,
        parentIntentionId: intention.parentIntentionId,
        hasCustomDuration: intention.hasCustomDuration,
        customDuration,
        keepScreenAwake: intention.keepScreenAwake,
        isHabit: intention.isHabit,
        habitCadence:
          intention.habitCadence ?? (intention.isHabit ? 'daily' : 'off'),
        allowsTasks: intention.allowsTasks !== false,
        description: intention.description ?? '',
      })
    );
    setShowDiscardConfirm(false);
  };

  const openListForm = (list?: List) => {
    const title = list?.title ?? '';
    const emoji = list?.emoji ?? '';
    const description = list?.description ?? '';
    const isFavorite = list?.isFavorite ?? false;
    setEditingList(list ?? null);
    setListTitle(title);
    setListEmoji(emoji);
    setListDescription(description);
    setListIsFavorite(isFavorite);
    setInitialListFormKey(
      JSON.stringify({ title, emoji, description, isFavorite })
    );
    setIsListFormOpen(true);
  };

  const closeListForm = () => {
    setIsListFormOpen(false);
    setEditingList(null);
  };

  const currentListFormKey = JSON.stringify({
    title: listTitle,
    emoji: listEmoji,
    description: listDescription,
    isFavorite: listIsFavorite,
  });
  const hasUnsavedListChanges =
    isListFormOpen && currentListFormKey !== initialListFormKey;
  const requestCloseListForm = () => {
    if (hasUnsavedListChanges) {
      setShowListDiscardConfirm(true);
      return;
    }
    closeListForm();
  };

  const saveList = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = listTitle.trim();
    if (!title) return;
    await submitUserMutation({
      kind: 'lists',
      label: editingList ? t('lists.update') : t('lists.create'),
      payload: editingList
        ? {
            operation: 'update',
            listId: editingList.id,
            title,
            emoji: listEmoji.trim() || null,
            description: listDescription.trim() || null,
            isFavorite: listIsFavorite,
          }
        : {
            operation: 'create',
            title,
            emoji: listEmoji.trim() || null,
            description: listDescription.trim() || null,
          },
      reconcile: loadIntentions,
    });
    closeListForm();
    requestListRefresh();
    await loadIntentions();
  };

  const archiveList = async (list: List) => {
    await submitUserMutation({
      kind: 'lists',
      label: list.isArchived ? t('lists.restore') : t('lists.archive'),
      payload: {
        operation: 'update',
        listId: list.id,
        isArchived: !list.isArchived,
      },
      reconcile: loadIntentions,
    });
    closeListForm();
    requestListRefresh();
    await loadIntentions();
  };

  const convertListToIntention = async (list: List) => {
    await submitUserMutation({
      kind: 'lists',
      label: t('intention.convertToIntention'),
      payload: { operation: 'convertToIntention', listId: list.id },
      reconcile: loadIntentions,
    });
    closeListForm();
    setCurrentTab('work');
    await loadIntentions();
  };

  const resetForm = () => {
    setIsFormModalOpen(false);
    setEditingIntention(null);
    setNewTitle('');
    setNewEmoji('');
    setNewDescription('');
    const defaultType = getDefaultIntentionType();
    setNewType(defaultType);
    setNewParentIntentionId(null);
    setNewHasCustomDuration(false);
    setNewKeepScreenAwake(false);
    setNewIsHabit(false);
    setNewHabitCadence('off');
    setNewAllowsTasks(true);
    setNewCustomDuration(
      defaultType === TIMER_TYPES.WORK
        ? DEFAULT_WORK_INTENTION_MINUTES
        : defaultType === TIMER_TYPES.LONG_BREAK
          ? DEFAULT_LONG_BREAK_INTENTION_MINUTES
          : DEFAULT_BREAK_INTENTION_MINUTES
    );
    setInitialFormKey('');
    setShowDiscardConfirm(false);
  };

  const currentFormKey = serializeIntentionFormState({
    title: newTitle,
    emoji: newEmoji,
    type: newType,
    parentIntentionId: newParentIntentionId,
    hasCustomDuration: newHasCustomDuration,
    customDuration: newCustomDuration,
    keepScreenAwake: newKeepScreenAwake,
    isHabit: newIsHabit,
    habitCadence: newHabitCadence,
    allowsTasks: newAllowsTasks,
    description: newDescription,
  });
  const hasUnsavedFormChanges =
    isFormModalOpen && currentFormKey !== initialFormKey;

  const cancelAction = () => {
    if (hasUnsavedFormChanges) {
      setShowDiscardConfirm(true);
      return;
    }

    resetForm();
  };

  const currentIntentions =
    currentTab === 'work'
      ? workIntentions
      : currentTab === 'break'
        ? breakIntentions
        : currentTab === 'longBreak'
          ? longBreakIntentions
          : [];
  const currentTopIntentions = stableFavoriteFirst(
    currentIntentions.filter(intention => !intention.parentIntentionId)
  );

  function getTopLevelIntentionsForType(type: IntentionType): Intention[] {
    const source =
      type === TIMER_TYPES.WORK
        ? workIntentions
        : type === TIMER_TYPES.BREAK
          ? breakIntentions
          : longBreakIntentions;

    return source.filter(intention => !intention.parentIntentionId);
  }

  const getSubIntentionsForParent = (parent: Intention) => {
    return stableFavoriteFirst(
      currentIntentions.filter(
        intention => intention.parentIntentionId === parent.id
      )
    );
  };

  const toggleParentExpanded = (parentId: string) => {
    setExpandedParentIds(state => ({
      ...state,
      [parentId]: !state[parentId],
    }));
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const check = () => setListOverflows(el.scrollHeight > el.clientHeight);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    requestAnimationFrame(check);
    return () => observer.disconnect();
  }, [currentTab, currentIntentions.length]);

  useEffect(() => {
    const el = bottomButtonRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setBottomButtonVisible(entry.isIntersecting),
      { root: listRef.current, threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [currentTab, currentIntentions.length, isLoading]);

  const hasBreakIntentions = !!preferences?.intentionBreakIntentions;

  const tabs: { key: TabType; label: string }[] = [
    { key: 'work', label: t('debug.work') },
    ...(hasBreakIntentions
      ? [
          { key: 'break' as TabType, label: t('debug.break') },
          { key: 'longBreak' as TabType, label: t('debug.longBreak') },
        ]
      : []),
    ...(preferences?.listsExtension
      ? [{ key: 'lists' as TabType, label: t('intention.lists') }]
      : []),
  ];

  // ── REMOVAL MODAL (shared across all variants) ──
  const renderRemovalModal = () => {
    if (!intentionToRemove) return null;

    return (
      <Modal
        isOpen={!!intentionToRemove}
        onClose={() => {
          setIntentionToRemove(null);
          setRemoveMode('choose');
        }}
        title={
          removeMode === 'choose'
            ? t('intention.remove')
            : t('intention.delete')
        }
        closeOnBackdropClick={true}
        closeOnEscape={true}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-slate-800 p-3">
            <span className="text-2xl">{intentionToRemove.emoji}</span>
            <span className="font-medium text-ink">
              {intentionToRemove.title}
            </span>
          </div>

          {removeMode === 'choose' && (
            <div className="space-y-2">
              <button
                onClick={() =>
                  handleArchiveIntention(
                    intentionToRemove.slug,
                    intentionToRemove.type
                  )
                }
                className="w-full flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-left transition-colors hover:bg-slate-700/50 cursor-pointer"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-400">
                  <FaArchive size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {t('common.archive')}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t('intention.archiveDescription')}
                  </p>
                </div>
              </button>
              <button
                onClick={() => setRemoveMode('delete')}
                className="w-full flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-left transition-colors hover:bg-red-950/30 cursor-pointer"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/10 text-red-400">
                  <FaTrash size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {t('common.deletePermanently')}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t('intention.deleteDescription')}
                  </p>
                </div>
              </button>
            </div>
          )}

          {removeMode === 'delete' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepStatsOnDelete}
                    onChange={e => setKeepStatsOnDelete(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500 accent-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {t('intention.keepStatistics')}
                    </p>
                    <p className="text-xs text-slate-400">
                      {t('intention.keepStatisticsDescription')}
                    </p>
                  </div>
                </label>
              </div>

              {!keepStatsOnDelete && (
                <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2">
                  <p className="text-xs text-red-300">
                    All statistics and logs for this intention will be
                    permanently deleted.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setRemoveMode('choose')}
                >
                  {t('common.back')}
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() =>
                    handleDeleteIntention(
                      intentionToRemove.slug,
                      intentionToRemove.type,
                      keepStatsOnDelete
                    )
                  }
                >
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    );
  };

  const renderReparentModal = () => {
    if (!intentionToReparent) return null;

    const parentOptions = getTopLevelIntentionsForType(
      intentionToReparent.type
    ).filter(parent => parent.slug !== intentionToReparent.slug);

    return (
      <Modal
        isOpen={!!intentionToReparent}
        onClose={() => {
          setIntentionToReparent(null);
          setSelectedReparentSlug('');
        }}
        title={t('intention.makeSub')}
        closeOnBackdropClick={true}
        closeOnEscape={true}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-slate-800 p-3">
            <span className="text-2xl">{intentionToReparent.emoji}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {intentionToReparent.title}
              </p>
              <p className="text-xs text-slate-400">
                {t('intention.reparentDescription')}
              </p>
            </div>
          </div>

          <select
            value={selectedReparentSlug}
            onChange={event => setSelectedReparentSlug(event.target.value)}
            className="w-full rounded-md border border-slate-700/40 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500/50 focus:outline-none"
          >
            {parentOptions.map(parent => (
              <option key={parent.slug} value={parent.slug}>
                {parent.emoji} {parent.title}
              </option>
            ))}
          </select>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setIntentionToReparent(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleReparentIntention}
              disabled={!selectedReparentSlug}
            >
              {t('intention.convert')}
            </Button>
          </div>
        </div>
      </Modal>
    );
  };

  // ── CREATE/EDIT MODAL (shared, cleaned up) ──
  const renderFormModal = () => {
    const isEdit = editingIntention !== null;
    const formType = newType;
    const parentOptions = getTopLevelIntentionsForType(formType).filter(
      intention => intention.id !== editingIntention?.id
    );
    const defaultDuration =
      formType === TIMER_TYPES.WORK
        ? DEFAULT_WORK_INTENTION_MINUTES
        : formType === TIMER_TYPES.LONG_BREAK
          ? DEFAULT_LONG_BREAK_INTENTION_MINUTES
          : DEFAULT_BREAK_INTENTION_MINUTES;

    return (
      <>
        <BottomSheet
          isOpen={isFormModalOpen}
          onClose={cancelAction}
          title={isEdit ? t('intention.edit') : t('intention.new')}
          headerActions={
            isEdit &&
            editingIntention && (
              <details
                className="intention-management"
                onBlur={event => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null
                    )
                  )
                    event.currentTarget.open = false;
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                  }
                }}
              >
                <summary
                  aria-label={t('settings.manage')}
                  title={t('settings.manage')}
                >
                  <FaEllipsisH />
                </summary>
                <section className="intention-management-menu space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {t('settings.manage')}
                    </h3>
                    {hasUnsavedFormChanges && (
                      <span className="text-[10px] text-amber-300">
                        {t('settings.saveChangesFirst')}
                      </span>
                    )}
                  </div>
                  {preferences?.intentionSubIntentions &&
                    !editingIntention.parentIntentionId && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full justify-start"
                        disabled={hasUnsavedFormChanges}
                        onClick={() => {
                          const parent = editingIntention;
                          resetForm();
                          openCreateIntentionModal(parent);
                        }}
                      >
                        <FaPlus size={11} /> {t('intention.addSub')}
                      </Button>
                    )}
                  {preferences?.intentionSubIntentions &&
                    (editingIntention.parentIntentionId ||
                      getSubIntentionsForParent(editingIntention).length ===
                        0) && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full justify-start"
                        disabled={hasUnsavedFormChanges}
                        onClick={() => {
                          const target = editingIntention;
                          resetForm();
                          promptReparentIntention(target);
                        }}
                      >
                        <FaShare size={11} />
                        {editingIntention.parentIntentionId
                          ? t('intention.moveSub')
                          : t('intention.makeSub')}
                      </Button>
                    )}
                  {preferences?.listsExtension &&
                    !editingIntention.parentIntentionId && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full justify-start"
                        disabled={hasUnsavedFormChanges}
                        onClick={() => {
                          const target = editingIntention;
                          resetForm();
                          setIntentionToConvert(target);
                        }}
                      >
                        <FaListUl size={11} /> {t('intention.makeListAction')}
                      </Button>
                    )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={hasUnsavedFormChanges}
                      onClick={() =>
                        void handleArchiveIntention(
                          editingIntention.slug,
                          editingIntention.type
                        )
                      }
                    >
                      <FaArchive size={11} /> {t('common.archive')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={hasUnsavedFormChanges}
                      onClick={() => {
                        const target = editingIntention;
                        resetForm();
                        promptRemoveIntention(target);
                        setRemoveMode('delete');
                      }}
                    >
                      <FaTrash size={11} /> {t('common.delete')}
                    </Button>
                  </div>
                </section>
              </details>
            )
          }
          closeOnBackdropClick={true}
          closeOnEscape={true}
          className="max-h-[calc(100dvh-3rem)] overflow-visible p-0"
        >
          <form
            className="flex min-h-0 max-h-[calc(100dvh-3rem)] flex-col overflow-hidden"
            onSubmit={
              isEdit && editingIntention
                ? e =>
                    handleUpdateIntention(
                      editingIntention.slug,
                      editingIntention.type,
                      e
                    )
                : handleCreateIntention
            }
          >
            <div className="space-y-4 overflow-y-auto p-5 pb-6">
              {!isEdit && preferences?.listsExtension && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    openListForm();
                    setListTitle(newTitle);
                    setListEmoji(newEmoji);
                    setListDescription(newDescription);
                    setIsFormModalOpen(false);
                  }}
                >
                  <FaListUl /> {t('intention.newList')}
                </Button>
              )}
              <div className="flex items-end gap-3">
                <FormField label={t('common.emoji')} className="w-14">
                  <Input
                    type="text"
                    value={newEmoji}
                    onChange={e => setNewEmoji(e.target.value)}
                    variant="centered"
                    className="text-base"
                    maxLength={2}
                    required
                    autoFocus
                  />
                </FormField>
                <FormField label={t('common.title')} className="flex-1">
                  <Input
                    type="text"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    required
                  />
                </FormField>
              </div>

              {isEdit && editingIntention && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>
                    {t(
                      editingIntention.type === TIMER_TYPES.LONG_BREAK
                        ? 'common.longBreak'
                        : editingIntention.type === TIMER_TYPES.BREAK
                          ? 'common.break'
                          : 'common.work'
                    )}
                  </span>
                  {!editingIntention.parentIntentionId && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t('common.topLevel')}</span>
                    </>
                  )}
                </div>
              )}

              {!isEdit && hasBreakIntentions && (
                <div className="flex rounded-md bg-slate-800 p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNewType(TIMER_TYPES.WORK);
                      setNewParentIntentionId(null);
                      if (!newHasCustomDuration)
                        setNewCustomDuration(DEFAULT_WORK_INTENTION_MINUTES);
                    }}
                    aria-pressed={newType === TIMER_TYPES.WORK}
                    className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                      newType === TIMER_TYPES.WORK
                        ? 'bg-indigo-600 text-ink'
                        : 'text-slate-400 hover:text-ink'
                    }`}
                  >
                    {t('common.work')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewType(TIMER_TYPES.BREAK);
                      setNewParentIntentionId(null);
                      if (!newHasCustomDuration)
                        setNewCustomDuration(DEFAULT_BREAK_INTENTION_MINUTES);
                    }}
                    aria-pressed={newType === TIMER_TYPES.BREAK}
                    className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                      newType === TIMER_TYPES.BREAK
                        ? 'bg-green-600 text-ink'
                        : 'text-slate-400 hover:text-ink'
                    }`}
                  >
                    {t('common.break')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewType(TIMER_TYPES.LONG_BREAK);
                      setNewParentIntentionId(null);
                      if (!newHasCustomDuration)
                        setNewCustomDuration(
                          DEFAULT_LONG_BREAK_INTENTION_MINUTES
                        );
                    }}
                    aria-pressed={newType === TIMER_TYPES.LONG_BREAK}
                    className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                      newType === TIMER_TYPES.LONG_BREAK
                        ? 'bg-purple-600 text-ink'
                        : 'text-slate-400 hover:text-ink'
                    }`}
                  >
                    {t('common.longBreak')}
                  </button>
                </div>
              )}

              {preferences?.intentionSubIntentions &&
                (!isEdit || editingIntention?.parentIntentionId) && (
                  <div className="rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2">
                    <label
                      htmlFor={`parentIntention-${isEdit ? editingIntention?.slug : 'new'}`}
                      className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400"
                    >
                      {t('intention.parent')}
                    </label>
                    <select
                      id={`parentIntention-${isEdit ? editingIntention?.slug : 'new'}`}
                      value={newParentIntentionId ?? ''}
                      onChange={event =>
                        setNewParentIntentionId(event.target.value || null)
                      }
                      className="relative z-10 w-full rounded-md border border-slate-700/40 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:border-indigo-500/50 focus:outline-none"
                    >
                      <option value="">{t('common.topLevel')}</option>
                      {parentOptions.map(parent => (
                        <option key={parent.id} value={parent.id}>
                          {parent.emoji} {parent.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              <SheetOptions />
              {preferences?.destinationDescriptionsEnabled && (
                <details className="sheet-extra rounded-lg border border-slate-800 bg-slate-800/50">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                    {t('common.description')}
                    <span className="ml-2 normal-case tracking-normal text-slate-600">
                      {newDescription.trim()
                        ? t('common.added')
                        : t('common.optional')}
                    </span>
                  </summary>
                  <div className="px-3 pb-3">
                    <textarea
                      value={newDescription}
                      onChange={event => setNewDescription(event.target.value)}
                      maxLength={1000}
                      rows={3}
                      placeholder={t('intention.whatBelongs')}
                      className="w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-ink outline-none focus:border-indigo-500"
                    />
                  </div>
                </details>
              )}
              <div className="sheet-extra space-y-2">
                {preferences?.intentionHabits && (
                  <div className="rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2">
                    <label
                      htmlFor={`habit-${isEdit ? editingIntention?.slug : 'new'}`}
                      className="mb-1 block text-xs font-medium text-slate-300"
                    >
                      {t('intention.habitCadence')}
                    </label>
                    <select
                      id={`habit-${isEdit ? editingIntention?.slug : 'new'}`}
                      value={newHabitCadence}
                      onChange={event => {
                        const cadence = event.target.value as HabitCadence;
                        setNewHabitCadence(cadence);
                        setNewIsHabit(cadence !== 'off');
                      }}
                      className="w-full rounded-md border border-slate-700/40 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                    >
                      <option value="off">{t('common.off')}</option>
                      <option value="daily">{t('common.daily')}</option>
                      <option value="weekly">{t('common.weekly')}</option>
                    </select>
                  </div>
                )}

                <div className="rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2">
                  <ToggleField
                    id={`keepScreenAwake-${isEdit ? editingIntention?.slug : 'new'}`}
                    checked={newKeepScreenAwake}
                    onChange={checked => setNewKeepScreenAwake(checked)}
                    label={t('settings.keepScreenAwake')}
                  />
                </div>

                {!newParentIntentionId && (
                  <div className="rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2">
                    <ToggleField
                      id={`allowsTasks-${isEdit ? editingIntention?.slug : 'new'}`}
                      checked={newAllowsTasks}
                      onChange={checked => {
                        if (checked) {
                          setNewAllowsTasks(true);
                          return;
                        }
                        setShowDisableTasksConfirm(true);
                      }}
                      label={t('intention.allowLinkedTasks')}
                    />
                    <p className="mt-1 pr-8 text-[10px] leading-4 text-slate-500">
                      {t('intention.allowLinkedTasksDescription')}
                    </p>
                  </div>
                )}

                {preferences?.intentionCustomDurations && (
                  <div className="rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2">
                    <ToggleField
                      id={`customDuration-${isEdit ? editingIntention?.slug : 'new'}`}
                      checked={newHasCustomDuration}
                      onChange={checked => {
                        setNewHasCustomDuration(checked);
                        if (checked && newCustomDuration === 0)
                          setNewCustomDuration(defaultDuration);
                      }}
                      label={t('intention.customDuration')}
                    />
                    {newHasCustomDuration && (
                      <div className="mt-2 flex items-center gap-2 pl-1">
                        <FaClock className="text-slate-500" size={12} />
                        <Input
                          type="number"
                          value={
                            newCustomDuration === 0 ? '' : newCustomDuration
                          }
                          onChange={e => {
                            const val = e.target.value;
                            setNewCustomDuration(
                              val === '' ? 0 : parseInt(val, 10)
                            );
                          }}
                          className="w-16 text-center text-sm"
                          min={1}
                          max={240}
                          placeholder={defaultDuration.toString()}
                        />
                        <span className="text-xs text-slate-400">
                          {t('common.min')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-3 border-t border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-1 justify-end gap-3">
                <Button type="button" variant="ghost" onClick={cancelAction}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={!newTitle.trim() || !newEmoji.trim()}
                >
                  {isEdit ? t('common.save') : t('common.create')}
                </Button>
              </div>
            </div>
          </form>
        </BottomSheet>
        <UnsavedChangesDialog
          isOpen={showDiscardConfirm}
          title={t('intention.discardChanges')}
          message={t('intention.discardMessage')}
          stayLabel={t('common.stay')}
          discardLabel={t('common.discard')}
          onStay={() => setShowDiscardConfirm(false)}
          onDiscard={resetForm}
        />
      </>
    );
  };

  const renderListFormModal = () => (
    <>
      <BottomSheet
        isOpen={isListFormOpen}
        onClose={requestCloseListForm}
        title={editingList ? t('intention.editList') : t('intention.newList')}
        closeOnBackdropClick={true}
        closeOnEscape={true}
        className="max-h-[calc(100dvh-3rem)] overflow-hidden p-0"
      >
        <form
          className="flex min-h-0 max-h-[calc(100dvh-3rem)] flex-col overflow-hidden"
          onSubmit={saveList}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 pb-6">
            <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3">
              <FormField label={t('common.emoji')}>
                <Input
                  value={listEmoji}
                  onChange={event => setListEmoji(event.target.value)}
                  maxLength={16}
                  variant="centered"
                  placeholder="📋"
                />
              </FormField>
              <FormField label={t('common.name')}>
                <Input
                  autoFocus
                  value={listTitle}
                  onChange={event => setListTitle(event.target.value)}
                  maxLength={120}
                  required
                />
              </FormField>
            </div>
            {editingList && (
              <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 text-sm text-slate-200">
                {t('intention.favorite')}
                <input
                  type="checkbox"
                  checked={listIsFavorite}
                  onChange={event => setListIsFavorite(event.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>
            )}

            {editingList && (
              <section className="space-y-2 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t('settings.manage')}
                  </h3>
                  {hasUnsavedListChanges && (
                    <span className="text-[10px] text-amber-300">
                      {t('settings.saveChangesFirst')}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-start"
                  disabled={hasUnsavedListChanges}
                  onClick={() => void convertListToIntention(editingList)}
                >
                  {t('intention.makeAction')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="w-full justify-start"
                  disabled={hasUnsavedListChanges}
                  onClick={() => void archiveList(editingList)}
                >
                  <FaArchive size={11} /> {t('common.archive')}
                </Button>
              </section>
            )}
            <SheetOptions />
            {preferences?.destinationDescriptionsEnabled && (
              <details className="sheet-extra rounded-lg border border-slate-800 bg-slate-800/50">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  {t('common.description')}
                  <span className="ml-2 normal-case tracking-normal text-slate-600">
                    {listDescription.trim()
                      ? t('common.added')
                      : t('common.optional')}
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <textarea
                    value={listDescription}
                    onChange={event => setListDescription(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder={t('intention.whatBelongsInList')}
                    className="w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-ink outline-none focus:border-emerald-500"
                  />
                </div>
              </details>
            )}
          </div>
          <div className="shrink-0 flex gap-3 border-t border-slate-800 bg-slate-900 p-4">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={requestCloseListForm}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!listTitle.trim()}
            >
              {editingList ? t('common.save') : t('common.create')}
            </Button>
          </div>
        </form>
      </BottomSheet>
      <UnsavedChangesDialog
        isOpen={showListDiscardConfirm}
        title={t('intention.discardListChanges')}
        message={t('intention.discardListMessage')}
        stayLabel={t('common.stay')}
        discardLabel={t('common.discard')}
        onStay={() => setShowListDiscardConfirm(false)}
        onDiscard={() => {
          setShowListDiscardConfirm(false);
          closeListForm();
        }}
      />
    </>
  );

  if (editorOnly)
    return (
      <>
        {renderFormModal()}
        {renderListFormModal()}
      </>
    );

  return (
    <PageShell className="min-h-0! h-full overflow-hidden">
      <PageContainer className="text-ink h-full flex flex-col">
        <div className={`shrink-0 ${isDesktop ? 'pt-4' : 'pt-1'}`}>
          <div className="flex items-center justify-between mb-2">
            <BackButton
              targetTab="timer"
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-ink transition-colors cursor-pointer"
              wrapperClassName="shrink-0"
            />
            <div className="flex items-center gap-2">
              {archivedIntentions.length + archivedLists.length > 0 && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setIsArchivedModalOpen(true)}
                  className="gap-1.5 rounded-lg"
                >
                  <FaArchive size={10} />
                  <span>{t('common.archived')}</span>
                </Button>
              )}
              {listOverflows && !bottomButtonVisible && (
                <Button
                  size="xs"
                  onClick={() =>
                    currentTab === 'lists'
                      ? openListForm()
                      : openCreateIntentionModal()
                  }
                  disabled={isFormModalOpen || isListFormOpen}
                  className="gap-1.5 rounded-lg relative"
                >
                  <FaPlus size={10} />
                  <span>{t('common.new')}</span>
                  <KeyboardShortcut text="0" position="topRight" />
                </Button>
              )}
            </div>
          </div>

          {tabs.length > 1 && (
            <div className="flex gap-1 mb-3">
              {tabs.map(tab => {
                const isActive = currentTab === tab.key;
                const activeColor =
                  tab.key === 'break'
                    ? 'border-green-500 text-green-400'
                    : tab.key === 'longBreak'
                      ? 'border-purple-500 text-purple-400'
                      : tab.key === 'lists'
                        ? 'border-emerald-500 text-emerald-400'
                        : 'border-indigo-500 text-indigo-400';
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCurrentTab(tab.key)}
                    className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
                      isActive
                        ? activeColor
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pb-4"
        >
          {isLoading ? (
            <div className="py-8 flex justify-center">
              <Spinner />
            </div>
          ) : currentTab === 'lists' ? (
            lists.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                {t('intention.noLists')}
              </div>
            ) : (
              stableFavoriteFirst(lists).map(list => (
                <Card key={list.id} className="flex items-center px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => openListForm(list)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                    aria-label={t('task.editFor', { title: list.title })}
                  >
                    <span className="text-xl">{list.emoji ?? '📋'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {list.title}
                    </span>
                  </button>
                  <ManagerRowActions
                    isFavorite={list.isFavorite}
                    label={list.title}
                    onFavorite={() => void toggleFavoriteList(list)}
                    onEdit={() => openListForm(list)}
                  />
                </Card>
              ))
            )
          ) : currentTopIntentions.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              {t('intention.noIntentionsForType', {
                type: t(
                  `common.${currentTab === 'longBreak' ? 'longBreak' : currentTab}`
                ),
              })}
            </div>
          ) : (
            currentTopIntentions.map(intention => {
              const subIntentions = getSubIntentionsForParent(intention);
              const isExpanded = !!expandedParentIds[intention.id];
              const renderBadges = (target: Intention) => (
                <>
                  {target.hasCustomDuration && target.customDuration && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 shrink-0">
                      <FaClock size={8} />
                      {Math.round(
                        target.customDuration / MILLISECONDS_PER_MINUTE
                      )}
                      m
                    </span>
                  )}
                  {target.keepScreenAwake && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400 shrink-0">
                      {t('intention.awake')}
                    </span>
                  )}
                  {preferences?.intentionHabits && target.isHabit && (
                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 shrink-0">
                      {t('intention.habit')}
                    </span>
                  )}
                </>
              );

              return (
                <div key={`${intention.type}-${intention.slug}`}>
                  <Card className="relative flex items-center gap-2 px-3 py-2.5">
                    {preferences?.intentionSubIntentions &&
                    subIntentions.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleParentExpanded(intention.id)}
                        className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-ink"
                        aria-label={t(
                          isExpanded
                            ? 'intention.collapse'
                            : 'intention.expand',
                          { title: intention.title }
                        )}
                        title={t(
                          isExpanded
                            ? 'intention.collapse'
                            : 'intention.expand',
                          { title: intention.title }
                        )}
                      >
                        {isExpanded ? (
                          <FaCaretDown size={12} />
                        ) : (
                          <FaCaretRight size={12} />
                        )}
                      </button>
                    ) : (
                      <span className="w-5" />
                    )}
                    <button
                      type="button"
                      onClick={() => startEditing(intention)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                      aria-label={t('task.editFor', {
                        title: intention.title,
                      })}
                    >
                      <span className="text-xl shrink-0">
                        {intention.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-ink truncate min-w-0 shrink">
                            {intention.title}
                          </span>
                          {renderBadges(intention)}
                        </div>
                      </span>
                    </button>
                    <ManagerRowActions
                      isFavorite={intention.isFavorite}
                      label={intention.title}
                      onFavorite={() => void toggleFavoriteIntention(intention)}
                      onEdit={() => startEditing(intention)}
                    />
                  </Card>

                  {preferences?.intentionSubIntentions &&
                    isExpanded &&
                    subIntentions.map(subIntention => (
                      <Card
                        key={`${subIntention.type}-${subIntention.slug}`}
                        className="relative ml-7 mt-1 flex items-center gap-3 px-3 py-2 opacity-90"
                      >
                        <button
                          type="button"
                          onClick={() => startEditing(subIntention)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                          aria-label={t('task.editFor', {
                            title: subIntention.title,
                          })}
                        >
                          <span className="text-lg shrink-0">
                            {subIntention.emoji}
                          </span>
                          <span className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-ink truncate min-w-0 shrink">
                                {subIntention.title}
                              </span>
                              {renderBadges(subIntention)}
                            </div>
                          </span>
                        </button>
                        <ManagerRowActions
                          isFavorite={subIntention.isFavorite}
                          label={subIntention.title}
                          onFavorite={() =>
                            void toggleFavoriteIntention(subIntention)
                          }
                          onEdit={() => startEditing(subIntention)}
                        />
                      </Card>
                    ))}
                </div>
              );
            })
          )}
          {!isLoading && (
            <div ref={bottomButtonRef}>
              <Button
                onClick={() =>
                  currentTab === 'lists'
                    ? openListForm()
                    : openCreateIntentionModal()
                }
                disabled={isFormModalOpen || isListFormOpen}
                className="w-full rounded-lg gap-2 mt-2"
              >
                <FaPlus size={12} />
                <span>
                  {currentTab === 'lists'
                    ? t('intention.newList')
                    : t('intention.new')}
                </span>
              </Button>
            </div>
          )}
        </div>
      </PageContainer>

      {renderRemovalModal()}
      {renderReparentModal()}
      {renderFormModal()}
      {renderListFormModal()}

      <Modal
        isOpen={showDisableTasksConfirm}
        onClose={() => setShowDisableTasksConfirm(false)}
        title={t('intention.disableLinkedTasks')}
        closeOnBackdropClick={true}
        closeOnEscape={true}
      >
        <p className="text-sm leading-6 text-slate-300">
          {t('intention.disableLinkedTasksDescription')}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            onClick={() => setShowDisableTasksConfirm(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setNewAllowsTasks(false);
              setShowDisableTasksConfirm(false);
            }}
          >
            {t('common.disable')}
          </Button>
        </div>
      </Modal>

      <IntentionConversionModal
        intention={intentionToConvert}
        childCount={
          intentionToConvert
            ? getSubIntentionsForParent(intentionToConvert).length
            : 0
        }
        onClose={() => setIntentionToConvert(null)}
        onConvert={convertIntentionToList}
      />

      <Modal
        isOpen={isArchivedModalOpen}
        onClose={() => setIsArchivedModalOpen(false)}
        title={t('common.archived')}
        closeOnBackdropClick={true}
        closeOnEscape={true}
      >
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {archivedIntentions.length + archivedLists.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-500">
              {t('intention.nothingArchived')}
            </div>
          ) : (
            <>
              {archivedIntentions.map(intention => (
                <Card
                  key={`${intention.type}-${intention.slug}`}
                  className="flex items-center gap-3 px-3 py-2.5 opacity-70"
                >
                  <span className="text-xl shrink-0">{intention.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-ink truncate min-w-0 shrink">
                        {intention.title}
                      </span>
                      <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 shrink-0">
                        {intention.type}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() =>
                        handleUnarchiveIntention(intention.slug, intention.type)
                      }
                      className="p-1.5 rounded text-slate-500 hover:text-green-400 hover:bg-slate-800 transition-colors cursor-pointer"
                      title={t('common.unarchive')}
                    >
                      <FaUndo size={12} />
                    </button>
                    <button
                      onClick={() => {
                        setIsArchivedModalOpen(false);
                        promptRemoveIntention(intention);
                      }}
                      className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
                      title={t('common.deletePermanently')}
                    >
                      <FaTrash size={12} />
                    </button>
                  </div>
                </Card>
              ))}
              {archivedLists.map(list => (
                <Card
                  key={list.id}
                  className="flex items-center gap-3 px-3 py-2.5 opacity-70"
                >
                  <span className="text-xl">{list.emoji ?? '📋'}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {list.title}
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                    {t('intention.list')}
                  </span>
                  <button
                    type="button"
                    onClick={() => void archiveList(list)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-green-400"
                    title={t('intention.restoreList')}
                    aria-label={t('intention.restoreNamedList', {
                      title: list.title,
                    })}
                  >
                    <FaUndo size={12} />
                  </button>
                </Card>
              ))}
            </>
          )}
        </div>
      </Modal>
    </PageShell>
  );
}

function serializeIntentionFormState(state: {
  title: string;
  emoji: string;
  type: IntentionType;
  parentIntentionId: string | null;
  hasCustomDuration: boolean;
  customDuration: number;
  keepScreenAwake: boolean;
  isHabit: boolean;
  habitCadence: HabitCadence;
  allowsTasks: boolean;
  description: string;
}) {
  return JSON.stringify(state);
}
