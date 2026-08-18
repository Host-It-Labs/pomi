import type {
  AssistantModelOption,
  AssistantSettings as AssistantSettingsValue,
} from '@pomi/shared';
import { ASSISTANT_MAX_RECORDING_MINUTES } from '@pomi/shared/src/constants';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaCheck, FaExclamationTriangle, FaInfoCircle } from 'react-icons/fa';
import { Alert } from '../components/ui/Alert';
import { Separator } from '../components/ui/Separator';
import { getLanguage, translate, useI18n } from '../i18n';
import { apiClient } from '../utils/apiClient';
import { submitUserMutation } from '../utils/userActionQueue';
import { getApiErrorMessage } from '../utils/apiError';

type AssistantSettingsResponse = AssistantSettingsValue & {
  apiKeyConfigured: boolean;
};

type AssistantSettingsProps = {
  onSaved: () => void | Promise<void>;
};

type AssistantModelsQuery = {
  inputModalities: string;
  outputModalities: string;
};

const ASSISTANT_MODEL_QUERIES: AssistantModelsQuery[] = [
  { inputModalities: 'text', outputModalities: 'text' },
  { inputModalities: 'audio', outputModalities: 'transcription' },
  { inputModalities: 'text', outputModalities: 'speech' },
];
const MAX_ASSISTANT_SETTINGS_LOAD_ATTEMPTS = 3;

const DEFAULT_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
];

const RECOMMENDED_ASSISTANT_MODELS = {
  textModel: ['google/gemini-3.5-flash-lite'],
  transcriptionModel: [
    'mistralai/voxtral-mini-3b-2507',
    'mistralai/voxtral-mini-2507',
    'nvidia/parakeet-tdt-0.6b-v3',
  ],
  speechModel: ['hexgrad/kokoro-82m'],
} satisfies Pick<
  Record<keyof Required<AssistantSettingsValue>, string[]>,
  'textModel' | 'transcriptionModel' | 'speechModel'
>;

export function AssistantSettings({ onSaved }: AssistantSettingsProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AssistantSettingsResponse | null>(
    null
  );
  const [draft, setDraft] = useState<AssistantSettingsValue | null>(null);
  const [textModels, setTextModels] = useState<AssistantModelOption[]>([]);
  const [transcriptionModels, setTranscriptionModels] = useState<
    AssistantModelOption[]
  >([]);
  const [speechModels, setSpeechModels] = useState<AssistantModelOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsLoadAttempts, setSettingsLoadAttempts] = useState(0);
  const [modelLoadAttempts, setModelLoadAttempts] = useState(0);
  const [isRetryingModels, setIsRetryingModels] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [recordingLimitInput, setRecordingLimitInput] = useState('10');
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestSaveRequestIdRef = useRef(0);
  const settingsLoadAttemptsRef = useRef(0);
  const modelLoadAttemptsRef = useRef(0);

  const applySettingsResponse = useCallback(
    (nextSettings: AssistantSettingsResponse) => {
      const recordingMaxMinutes = normalizeRecordingLimit(
        nextSettings.assistantRecordingMaxMinutes
      );
      setSettings(nextSettings);
      setDraft({
        textModel: nextSettings.textModel,
        transcriptionModel: nextSettings.transcriptionModel,
        speechModel: nextSettings.speechModel,
        speechVoice: nextSettings.speechVoice,
        assistantRecordingMaxMinutes: recordingMaxMinutes,
        usageBudgetPeriod: nextSettings.usageBudgetPeriod,
        usageBudgetCapUsd: nextSettings.usageBudgetCapUsd,
      });
      setBudgetInput(formatBudgetInput(nextSettings.usageBudgetCapUsd));
      setRecordingLimitInput(formatRecordingLimitInput(recordingMaxMinutes));
    },
    []
  );

  const loadModelLists = useCallback(async () => {
    if (modelLoadAttemptsRef.current >= MAX_ASSISTANT_SETTINGS_LOAD_ATTEMPTS) {
      return false;
    }
    const attempt = modelLoadAttemptsRef.current + 1;
    modelLoadAttemptsRef.current = attempt;
    setModelLoadAttempts(attempt);
    const [
      textModelsResponse,
      transcriptionModelsResponse,
      speechModelsResponse,
    ] = await Promise.all(ASSISTANT_MODEL_QUERIES.map(loadModelOptions));

    if (textModelsResponse.status === 200) {
      setTextModels(
        orderRecommendedModels(
          textModelsResponse.body,
          RECOMMENDED_ASSISTANT_MODELS.textModel
        )
      );
    }
    if (transcriptionModelsResponse.status === 200) {
      setTranscriptionModels(
        orderRecommendedModels(
          transcriptionModelsResponse.body,
          RECOMMENDED_ASSISTANT_MODELS.transcriptionModel
        )
      );
    }
    if (speechModelsResponse.status === 200) {
      setSpeechModels(
        orderRecommendedModels(
          speechModelsResponse.body,
          RECOMMENDED_ASSISTANT_MODELS.speechModel
        )
      );
    }

    return [
      textModelsResponse,
      transcriptionModelsResponse,
      speechModelsResponse,
    ].every(response => response.status === 200);
  }, []);

  const loadSettings = useCallback(async () => {
    if (
      settingsLoadAttemptsRef.current >= MAX_ASSISTANT_SETTINGS_LOAD_ATTEMPTS
    ) {
      return;
    }
    settingsLoadAttemptsRef.current += 1;
    setSettingsLoadAttempts(settingsLoadAttemptsRef.current);
    setIsLoading(true);
    setError(null);
    try {
      const [settingsResponse, modelsLoaded] = await Promise.all([
        apiClient.assistant.settings(),
        loadModelLists(),
      ]);

      if (settingsResponse.status !== 200) {
        setError(t('assistant.adminOnly'));
        return;
      }

      applySettingsResponse(settingsResponse.body);

      if (!modelsLoaded) {
        setError(t('assistant.modelListsFailed'));
      }
    } catch (loadError) {
      console.error('Failed to load Assistant settings:', loadError);
      setError(t('assistant.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [applySettingsResponse, loadModelLists, t]);

  const reconcileSettings = useCallback(async () => {
    const response = await apiClient.assistant.settings();
    if (response.status !== 200) {
      throw new Error(t('assistant.refreshFailed'));
    }
    applySettingsResponse(response.body);
  }, [applySettingsResponse, t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const retryModelLoading = useCallback(async () => {
    if (isRetryingModels) return;
    setIsRetryingModels(true);
    setError(null);
    try {
      const loaded = await loadModelLists();
      if (loaded) {
        setNotice(t('assistant.modelListsRefreshed'));
      } else {
        setError(t('assistant.modelListsUnavailable'));
      }
    } finally {
      setIsRetryingModels(false);
    }
  }, [isRetryingModels, loadModelLists, t]);

  const selectedSpeechModel = useMemo(
    () => speechModels.find(model => model.id === draft?.speechModel) ?? null,
    [draft?.speechModel, speechModels]
  );
  const voiceOptions = selectedSpeechModel?.supportedVoices?.length
    ? selectedSpeechModel.supportedVoices
    : DEFAULT_VOICES;
  const isComplete = Boolean(draft?.textModel);

  const saveSettings = useCallback(
    async (nextDraft: AssistantSettingsValue) => {
      if (settings?.apiKeyConfigured !== true) {
        return;
      }
      const requestId = latestSaveRequestIdRef.current + 1;
      latestSaveRequestIdRef.current = requestId;
      setIsSaving(true);
      setError(null);
      setNotice(null);

      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const result = await submitUserMutation({
            kind: 'assistant',
            label: t('assistant.updateSettings'),
            payload: { operation: 'updateSettings', payload: nextDraft },
            reconcile: reconcileSettings,
          });
          const response =
            result &&
            typeof result === 'object' &&
            'status' in result &&
            'body' in result
              ? (result as { status: number; body: AssistantSettingsResponse })
              : { status: 200, body: result as AssistantSettingsResponse };
          if (requestId !== latestSaveRequestIdRef.current) {
            return;
          }
          if (response.status !== 200) {
            setError(
              getApiErrorMessage(response.body, t('assistant.saveFailed'))
            );
            return;
          }

          setSettings(response.body);
          setNotice(t('assistant.saved'));
          await onSaved();
        })
        .catch(saveError => {
          if (requestId !== latestSaveRequestIdRef.current) {
            return;
          }
          console.error('Failed to save Assistant settings:', saveError);
          setError(t('assistant.saveFailed'));
        })
        .finally(() => {
          if (requestId === latestSaveRequestIdRef.current) {
            setIsSaving(false);
          }
        });

      await saveQueueRef.current;
    },
    [onSaved, reconcileSettings, settings?.apiKeyConfigured, t]
  );

  const updateDraftValues = (updates: Partial<AssistantSettingsValue>) => {
    setDraft(current => {
      if (!current) {
        return current;
      }
      const nextDraft = { ...current, ...updates };
      void saveSettings(nextDraft);
      return nextDraft;
    });
    setNotice(null);
    setError(null);
  };

  const updateDraft = <K extends keyof AssistantSettingsValue>(
    key: K,
    value: AssistantSettingsValue[K]
  ) => {
    updateDraftValues({ [key]: value } as Partial<AssistantSettingsValue>);
  };

  const handleMissingRequiredModel = () => {
    if (!draft || !isComplete) {
      setError(t('assistant.selectTaskModel'));
    }
  };

  const commitBudgetInput = () => {
    if (!isCompleteBudgetInput(budgetInput)) {
      setBudgetInput(formatBudgetInput(draft?.usageBudgetCapUsd ?? null));
      return;
    }
    const nextBudget = parseBudgetInput(budgetInput);
    setBudgetInput(formatBudgetInput(nextBudget));
    updateDraft('usageBudgetCapUsd', nextBudget);
  };

  const commitRecordingLimitInput = () => {
    if (!isCompleteRecordingLimitInput(recordingLimitInput)) {
      const currentLimit = normalizeRecordingLimit(
        draft?.assistantRecordingMaxMinutes
      );
      setRecordingLimitInput(formatRecordingLimitInput(currentLimit));
      return;
    }
    const nextLimit = parseRecordingLimitInput(recordingLimitInput);
    setRecordingLimitInput(formatRecordingLimitInput(nextLimit));
    updateDraft('assistantRecordingMaxMinutes', nextLimit);
  };

  if (error && !draft && !settings) {
    return (
      <Alert variant="error">
        <div className="flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            className="shrink-0 underline"
            onClick={() => void loadSettings()}
            disabled={
              settingsLoadAttempts >= MAX_ASSISTANT_SETTINGS_LOAD_ATTEMPTS
            }
          >
            {t('common.retry')}
          </button>
        </div>
      </Alert>
    );
  }

  if (isLoading || !draft || !settings) {
    return (
      <div className="rounded-lg border border-slate-800/70 bg-slate-950/20 px-3 py-4 text-sm text-slate-400">
        {t('assistant.loadingSettings')}
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      {!settings.apiKeyConfigured && (
        <Alert variant="warning">{t('assistant.apiKeyRequired')}</Alert>
      )}
      {error && (
        <Alert variant="error">
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            {(error === t('assistant.modelListsFailed') ||
              error === t('assistant.modelListsUnavailable')) && (
              <button
                type="button"
                className="shrink-0 underline"
                onClick={() => void retryModelLoading()}
                disabled={
                  isRetryingModels ||
                  modelLoadAttempts >= MAX_ASSISTANT_SETTINGS_LOAD_ATTEMPTS
                }
              >
                {isRetryingModels
                  ? t('assistant.retryingModels')
                  : t('assistant.retryModelLoading')}
              </button>
            )}
          </div>
        </Alert>
      )}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="flex items-center gap-2 text-xs text-slate-400">
        {settings.apiKeyConfigured ? (
          <>
            <FaCheck className="text-emerald-300" />
            {t('assistant.openRouterDetected')}
          </>
        ) : (
          <>
            <FaExclamationTriangle className="text-amber-300" />
            {t('assistant.openRouterMissing')}
          </>
        )}
      </div>

      <AssistantSelect
        label={t('assistant.taskCaptureModel')}
        value={draft.textModel ?? ''}
        options={textModels}
        recommendedModelIds={RECOMMENDED_ASSISTANT_MODELS.textModel}
        onChange={value => updateDraft('textModel', value || null)}
      />

      <Separator />

      <AssistantSelect
        label={t('assistant.transcriptionModel')}
        value={draft.transcriptionModel ?? ''}
        options={transcriptionModels}
        recommendedModelIds={RECOMMENDED_ASSISTANT_MODELS.transcriptionModel}
        onChange={value => updateDraft('transcriptionModel', value || null)}
      />

      <AssistantSelect
        label={t('assistant.spokenReplyModel')}
        value={draft.speechModel ?? ''}
        options={speechModels}
        recommendedModelIds={RECOMMENDED_ASSISTANT_MODELS.speechModel}
        onChange={value => {
          const nextModel = speechModels.find(model => model.id === value);
          const nextVoices = nextModel?.supportedVoices?.length
            ? nextModel.supportedVoices
            : DEFAULT_VOICES;
          updateDraftValues({
            speechModel: value || null,
            speechVoice: nextVoices[0] ?? null,
          });
        }}
      />

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-300">
          {t('assistant.spokenReplyVoice')}
        </span>
        <select
          value={draft.speechVoice ?? ''}
          onChange={event =>
            updateDraft('speechVoice', event.target.value || null)
          }
          className="h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition-colors focus:border-indigo-400/70"
        >
          <option value="">{t('assistant.selectVoice')}</option>
          {voiceOptions.map(voice => (
            <option key={voice} value={voice}>
              {voice}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="flex items-center gap-2 text-xs font-medium text-slate-300">
          {t('assistant.recordingLimit')}
          <button
            type="button"
            aria-label={t('assistant.recordingLimitAbout')}
            title={t('assistant.recordingLimitTitle', {
              max: ASSISTANT_MAX_RECORDING_MINUTES,
            })}
            className="text-slate-600 hover:text-slate-300"
          >
            <FaInfoCircle size={12} />
          </button>
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={recordingLimitInput}
          placeholder={String(ASSISTANT_MAX_RECORDING_MINUTES)}
          max={ASSISTANT_MAX_RECORDING_MINUTES}
          onChange={event => {
            const value = event.target.value;
            if (!isValidRecordingLimitInput(value)) {
              return;
            }
            setRecordingLimitInput(value);
            if (isCompleteRecordingLimitInput(value)) {
              updateDraft(
                'assistantRecordingMaxMinutes',
                parseRecordingLimitInput(value)
              );
            }
          }}
          onBlur={commitRecordingLimitInput}
          className="h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition-colors focus:border-indigo-400/70"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-300">
          {t('assistant.usageBudgetPeriod')}
        </span>
        <select
          value={draft.usageBudgetPeriod}
          onChange={event =>
            updateDraft(
              'usageBudgetPeriod',
              event.target.value as AssistantSettingsValue['usageBudgetPeriod']
            )
          }
          className="h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition-colors focus:border-indigo-400/70"
        >
          <option value="daily">{t('assistant.daily')}</option>
          <option value="monthly">{t('assistant.monthly')}</option>
        </select>
      </label>

      <label className="block space-y-1">
        <span className="flex items-center gap-2 text-xs font-medium text-slate-300">
          {t('assistant.budgetPerUser')}
          <button
            type="button"
            aria-label={t('assistant.budgetAbout')}
            title={t('assistant.unlimitedBudget')}
            className="text-slate-600 hover:text-slate-300"
          >
            <FaInfoCircle size={12} />
          </button>
        </span>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center overflow-hidden rounded-md border border-slate-800 bg-slate-950 focus-within:border-indigo-400/70">
          <span className="px-3 text-sm text-slate-500">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={budgetInput}
            onChange={event => {
              const value = event.target.value.replace(',', '.');
              if (!isValidBudgetInput(value)) {
                return;
              }
              setBudgetInput(value);
              if (isCompleteBudgetInput(value)) {
                updateDraft('usageBudgetCapUsd', parseBudgetInput(value));
              }
            }}
            onBlur={commitBudgetInput}
            className="h-10 w-full bg-transparent px-0 pr-3 text-sm text-slate-100 outline-none"
          />
        </div>
      </label>

      <Separator />

      <div className="flex justify-end text-xs text-slate-500">
        {!isComplete ? (
          <button
            type="button"
            onClick={handleMissingRequiredModel}
            className="text-amber-300"
          >
            {t('assistant.selectTaskModel')}
          </button>
        ) : isSaving ? (
          <span>{t('assistant.saving')}</span>
        ) : notice ? (
          <span className="text-emerald-300">{notice}</span>
        ) : (
          <span>{t('assistant.autosaves')}</span>
        )}
      </div>
    </div>
  );
}

function AssistantSelect({
  label,
  value,
  options,
  recommendedModelIds,
  onChange,
}: {
  label: string;
  value: string;
  options: AssistantModelOption[];
  recommendedModelIds: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const recommendedModelId = getRecommendedModelId(
    options,
    recommendedModelIds
  );
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition-colors focus:border-indigo-400/70"
      >
        <option value="">{t('assistant.selectModel')}</option>
        {options.map(model => (
          <option key={model.id} value={model.id}>
            {formatModelOptionLabel(model, recommendedModelId)}
          </option>
        ))}
      </select>
    </label>
  );
}

async function loadModelOptions(query: AssistantModelsQuery) {
  try {
    return await apiClient.assistant.models({ query });
  } catch (error) {
    console.error('Failed to load Assistant models:', error);
    return {
      status: 400,
      body: {
        message: translate(
          'assistant.modelListsFailed',
          undefined,
          getLanguage()
        ),
      },
    } as Awaited<ReturnType<typeof apiClient.assistant.models>>;
  }
}

function orderRecommendedModels(
  options: AssistantModelOption[],
  recommendedModelIds: string[]
) {
  const recommendedModelId = getRecommendedModelId(
    options,
    recommendedModelIds
  );
  return [...options].sort((a, b) => {
    const aRecommended = a.id === recommendedModelId;
    const bRecommended = b.id === recommendedModelId;
    if (aRecommended !== bRecommended) {
      return aRecommended ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function formatModelOptionLabel(
  model: AssistantModelOption,
  recommendedModelId: string | null
) {
  const label = model.name || model.id;
  return model.id === recommendedModelId ? `Recommended - ${label}` : label;
}

function getRecommendedModelId(
  options: AssistantModelOption[],
  recommendedModelIds: string[]
) {
  return (
    recommendedModelIds.find(modelId =>
      options.some(option => option.id === modelId)
    ) ?? null
  );
}

function formatBudgetInput(value: number | null) {
  return value === null ? '' : String(value);
}

function isValidBudgetInput(value: string) {
  return /^\d*(?:\.\d*)?$/.test(value);
}

function isCompleteBudgetInput(value: string) {
  return value === '' || /^\d+(?:\.\d*)?$/.test(value);
}

function parseBudgetInput(value: string) {
  return value === '' ? null : Number(value);
}

function normalizeRecordingLimit(value: number | null | undefined) {
  if (value === null) return ASSISTANT_MAX_RECORDING_MINUTES;
  if (value === undefined || !Number.isInteger(value) || value < 1) return 10;
  return Math.min(value, ASSISTANT_MAX_RECORDING_MINUTES);
}

function formatRecordingLimitInput(value: number | null | undefined) {
  return String(normalizeRecordingLimit(value));
}

function isValidRecordingLimitInput(value: string) {
  return /^\d*$/.test(value);
}

function isCompleteRecordingLimitInput(value: string) {
  return value === '' || /^[1-9]\d*$/.test(value);
}

function parseRecordingLimitInput(value: string) {
  return value === ''
    ? ASSISTANT_MAX_RECORDING_MINUTES
    : Math.min(Number(value), ASSISTANT_MAX_RECORDING_MINUTES);
}
