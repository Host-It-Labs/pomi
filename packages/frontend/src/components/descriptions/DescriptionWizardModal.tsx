import type { Intention, List } from '@pomi/shared';
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiClient } from '../../utils/apiClient';
import { submitUserMutation } from '../../utils/userActionQueue';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

type Draft = {
  kind: 'intention' | 'list';
  id: string;
  title: string;
  description: string;
  initialDescription: string;
};

type DestinationData = {
  intentions: Intention[];
  lists: List[];
};

export function DescriptionWizardModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [stage, setStage] = useState<
    'choice' | 'loading' | 'generating' | 'review' | 'saving' | 'error'
  >('choice');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDrafts([]);
    setIntentions([]);
    setStage('choice');
    setError('');
  }, [isOpen]);

  const loadDestinations = async (): Promise<DestinationData> => {
    const [intentionResponse, listResponse] = await Promise.all([
      apiClient.intentions.list({ query: { includeSubIntentions: true } }),
      apiClient.lists.list({ query: {} }),
    ]);
    if (intentionResponse.status !== 200 || listResponse.status !== 200) {
      throw new Error(t('description.loadFailed'));
    }
    const activeIntentions = intentionResponse.body.filter(
      item => !item.isArchived
    );
    const disabledParentIds = new Set(
      activeIntentions
        .filter(item => !item.parentIntentionId && item.allowsTasks === false)
        .map(item => item.id)
    );
    return {
      intentions: activeIntentions.filter(
        item =>
          item.allowsTasks !== false &&
          (!item.parentIntentionId ||
            !disabledParentIds.has(item.parentIntentionId))
      ),
      lists: listResponse.body.filter(item => !item.isArchived),
    };
  };

  const editManually = async () => {
    setStage('loading');
    setError('');
    try {
      const destinations = await loadDestinations();
      setIntentions(destinations.intentions);
      setDrafts([
        ...destinations.intentions.map(intention => ({
          kind: 'intention' as const,
          id: intention.slug,
          title: intention.title,
          description: intention.description ?? '',
          initialDescription: intention.description ?? '',
        })),
        ...destinations.lists.map(list => ({
          kind: 'list' as const,
          id: list.id,
          title: list.title,
          description: list.description ?? '',
          initialDescription: list.description ?? '',
        })),
      ]);
      setStage('review');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('description.loadFailed')
      );
      setStage('error');
    }
  };

  const generate = async () => {
    setStage('generating');
    setError('');
    try {
      const [response, destinations] = await Promise.all([
        apiClient.descriptions.generate({ body: {} }),
        loadDestinations(),
      ]);
      if (response.status !== 200)
        throw new Error(t('description.generateFailed'));
      setIntentions(destinations.intentions);
      setDrafts(
        response.body.drafts.map(draft => {
          const destination =
            draft.kind === 'list'
              ? destinations.lists.find(item => item.id === draft.id)
              : destinations.intentions.find(item => item.slug === draft.id);
          return {
            ...draft,
            initialDescription: destination?.description ?? '',
          };
        })
      );
      setStage('review');
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : t('description.generateFailed')
      );
      setStage('error');
    }
  };

  const save = async () => {
    setStage('saving');
    try {
      for (const draft of drafts.filter(
        item => item.description.trim() !== item.initialDescription.trim()
      )) {
        if (draft.kind === 'list') {
          await submitUserMutation({
            kind: 'lists',
            label: t('description.saveList'),
            payload: {
              operation: 'update',
              listId: draft.id,
              description: draft.description.trim() || null,
            },
          });
          continue;
        }
        const intention = intentions.find(item => item.slug === draft.id);
        if (!intention) continue;
        await submitUserMutation({
          kind: 'intentions',
          label: t('description.saveIntention'),
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
            isFavorite: intention.isFavorite,
            parentIntentionId: intention.parentIntentionId,
            description: draft.description.trim() || null,
          },
        });
      }
      onClose();
      setStage('choice');
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t('description.saveFailed')
      );
      setStage('error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('description.title')}
      closeOnBackdropClick
      closeOnEscape
      className="max-h-[85dvh] overflow-hidden"
    >
      {stage === 'choice' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void editManually()}
            className="flex min-h-32 flex-col justify-center rounded-xl border border-slate-700 bg-slate-900/70 p-5 text-left transition hover:border-slate-500 hover:bg-slate-800/80"
          >
            <span className="text-sm font-semibold text-ink">
              {t('description.writeManually')}
            </span>
            <span className="mt-2 text-xs leading-relaxed text-slate-400">
              {t('description.writeManuallyDescription')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            className="flex min-h-32 flex-col justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-5 text-left transition hover:border-indigo-400/60 hover:bg-indigo-500/15"
          >
            <span className="text-sm font-semibold text-ink">
              {t('description.generateWithAi')}
            </span>
            <span className="mt-2 text-xs leading-relaxed text-slate-300">
              {t('description.generateWithAiDescription')}
            </span>
          </button>
        </div>
      ) : stage === 'loading' || stage === 'generating' ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            {stage === 'generating'
              ? t('description.generating')
              : t('description.loading')}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 max-h-[calc(85dvh-7rem)] flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3 pr-1">
            {error && <p className="text-sm text-red-300">{error}</p>}
            {drafts.map((draft, index) => (
              <label
                key={`${draft.kind}:${draft.id}`}
                className="block space-y-1"
              >
                <span className="text-xs font-medium text-slate-300">
                  {draft.kind === 'list' ? t('task.list') : t('task.intention')}{' '}
                  · {draft.title}
                </span>
                <textarea
                  rows={2}
                  maxLength={240}
                  value={draft.description}
                  onChange={event =>
                    setDrafts(current =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, description: event.target.value }
                          : item
                      )
                    )
                  }
                  className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-ink outline-none focus:border-indigo-500"
                />
              </label>
            ))}
            {drafts.length === 0 && (
              <p className="text-sm text-slate-400">
                {t('description.noneFound')}
              </p>
            )}
          </div>
          <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-slate-800 bg-slate-900/95 pt-3 backdrop-blur-sm">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                stage === 'saving' ||
                drafts.every(
                  draft =>
                    draft.description.trim() === draft.initialDescription.trim()
                )
              }
              onClick={() => void save()}
            >
              {stage === 'saving'
                ? t('common.savingEllipsis')
                : t('common.saveChanges')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
