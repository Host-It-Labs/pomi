import type { AssistantDebugLogEntry } from '@pomi/shared';
import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FaChevronDown, FaChevronUp, FaFlag } from 'react-icons/fa';
import { useToast } from '../toast/ToastContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SectionHeader } from '../ui/SectionHeader';
import { type TranslateFunction, useI18n } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { apiClient } from '../../utils/apiClient';
import { submitUserMutation } from '../../utils/userActionQueue';

const MAX_FLAGGED_LOGS = 200;

export function AssistantCaptureLogs() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const user = useAuthStore.use.user();
  const [enabled, setEnabled] = useState(false);
  const [logs, setLogs] = useState<AssistantDebugLogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [updatingLogId, setUpdatingLogId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{
    kind: 'initial' | 'refresh';
    message: string;
  } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const logsRef = useRef<AssistantDebugLogEntry[]>([]);
  const expandedIdRef = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingAnchorRef = useRef<{ id: string; top: number } | null>(null);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    expandedIdRef.current = expandedId;
  }, [expandedId]);

  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    pendingAnchorRef.current = null;
    const row = rowRefs.current.get(anchor.id);
    if (!row) return;
    window.scrollBy({ top: row.getBoundingClientRect().top - anchor.top });
  }, [logs]);

  const rememberAnchor = useCallback(() => {
    const expanded = expandedIdRef.current;
    const visible = logsRef.current.find(log => {
      const bounds = rowRefs.current.get(log.id)?.getBoundingClientRect();
      return bounds
        ? bounds.bottom > 0 && bounds.top < window.innerHeight
        : false;
    })?.id;
    const id = expanded ?? visible;
    const row = id ? rowRefs.current.get(id) : null;
    return id && row ? { id, top: row.getBoundingClientRect().top } : null;
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const generation = requestGeneration.current + 1;
      requestGeneration.current = generation;
      const previousLogs = logsRef.current;
      const anchor = mode === 'refresh' ? rememberAnchor() : null;
      if (mode === 'initial') setInitialLoading(true);
      else setRefreshing(true);
      setLoadError(null);
      try {
        const [statusResponse, logsResponse] = await Promise.all([
          apiClient.assistant.debugStatus(),
          apiClient.assistant.debugLogs(),
        ]);
        if (statusResponse.status !== 200 || logsResponse.status !== 200) {
          throw new Error(t('debug.loadFailed'));
        }
        if (requestGeneration.current !== generation) return;
        setEnabled(statusResponse.body.enabled);
        const nextLogs = logsResponse.body;
        const currentExpanded = expandedIdRef.current;
        let nextAnchor = anchor;
        if (
          currentExpanded &&
          !nextLogs.some(log => log.id === currentExpanded)
        ) {
          setExpandedId(null);
        }
        if (nextAnchor) {
          const missingAnchorId = nextAnchor.id;
          if (!nextLogs.some(log => log.id === missingAnchorId)) {
            const oldIndex = previousLogs.findIndex(
              log => log.id === missingAnchorId
            );
            const nearest =
              nextLogs[Math.min(Math.max(oldIndex, 0), nextLogs.length - 1)];
            nextAnchor = nearest ? { ...nextAnchor, id: nearest.id } : null;
          }
        }
        pendingAnchorRef.current = nextAnchor;
        setLogs(nextLogs);
      } catch (error) {
        if (requestGeneration.current !== generation) return;
        const message =
          error instanceof Error ? error.message : t('debug.loadFailed');
        setLoadError({ kind: mode, message });
        if (mode === 'refresh') showToast(t('debug.refreshFailed'), 'error');
      } finally {
        if (requestGeneration.current === generation) {
          if (mode === 'initial') setInitialLoading(false);
          else setRefreshing(false);
        }
      }
    },
    [rememberAnchor, showToast, t]
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const toggleLogging = async () => {
    if (saving || clearing || refreshing) return;
    const nextEnabled = !enabled;
    const confirmation = nextEnabled
      ? t('debug.turnOnConsentConfirm')
      : t('debug.turnOffDeleteLogs');
    if (!window.confirm(confirmation)) return;
    setSaving(true);
    setMutationError(null);
    requestGeneration.current += 1;
    try {
      const result = await submitUserMutation({
        kind: 'assistant',
        label: nextEnabled
          ? t('debug.enableLogging')
          : t('debug.disableLogging'),
        payload: {
          operation: 'updateDebugStatus',
          payload: { enabled: nextEnabled },
        },
      });
      const response = unwrapResponse<{ enabled: boolean }>(result);
      if (response.status !== 200) throw new Error();
      setEnabled(response.body.enabled);
      if (!response.body.enabled) {
        setLogs([]);
        setExpandedId(null);
      }
      showToast(
        response.body.enabled
          ? t('debug.loggingEnabled')
          : t('debug.loggingDisabled'),
        'success'
      );
    } catch {
      setMutationError(t('debug.updateLoggingFailed'));
      showToast(t('debug.updateLoggingFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearLogs = async () => {
    if (clearing || saving || refreshing) return;
    if (!window.confirm(t('debug.deleteCaptureLogsConfirm'))) return;
    setClearing(true);
    setMutationError(null);
    requestGeneration.current += 1;
    try {
      const response = unwrapResponse<{ success: boolean }>(
        await submitUserMutation({
          kind: 'assistant',
          label: t('debug.clearLogsAction'),
          payload: { operation: 'clearDebugLogs' },
        })
      );
      if (response.status !== 200) throw new Error();
      setLogs([]);
      setExpandedId(null);
      showToast(t('debug.logsCleared'), 'success');
    } catch {
      setMutationError(t('debug.clearLogsFailed'));
      showToast(t('debug.clearLogsFailed'), 'error');
    } finally {
      setClearing(false);
    }
  };

  const toggleFlag = async (log: AssistantDebugLogEntry) => {
    if (updatingLogId) return;
    setUpdatingLogId(log.id);
    setMutationError(null);
    try {
      const response = unwrapResponse<AssistantDebugLogEntry>(
        await submitUserMutation({
          kind: 'assistant',
          label: t('debug.updateLogFlagAction'),
          payload: {
            operation: 'updateDebugLogFlag',
            payload: { id: log.id, flagged: !log.flagged },
          },
        })
      );
      if (response.status !== 200) throw new Error();
      setLogs(current =>
        current.map(item => (item.id === log.id ? response.body : item))
      );
    } catch {
      setMutationError(t('debug.updateFlagFailed'));
      showToast(t('debug.updateFlagFailed'), 'error');
    } finally {
      setUpdatingLogId(null);
    }
  };

  const exportFlagged = async () => {
    if (exporting || !logs.some(log => log.flagged)) return;
    setExporting(true);
    try {
      const response = await apiClient.assistant.exportFlaggedDebugLogs();
      if (response.status !== 200) throw new Error();
      const blob = new Blob([JSON.stringify(response.body, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = captureLogFileName(user?.username);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(t('debug.exported'), 'success');
    } catch {
      showToast(t('debug.exportFailed'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const flaggedCount = logs.filter(log => log.flagged).length;

  return (
    <section className="space-y-3" data-setting-id="captureLogs">
      <SectionHeader
        title={t('debug.captureLogs')}
        description={t('debug.captureLogsDescription')}
      />
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => void toggleLogging()}
            disabled={initialLoading || saving || clearing || refreshing}
            variant={enabled ? 'danger' : 'primary'}
            size="sm"
          >
            {saving
              ? t('debug.saving')
              : enabled
                ? t('debug.turnOffLogging')
                : t('debug.turnOnLogging')}
          </Button>
          <Button
            type="button"
            onClick={() => void load('refresh')}
            disabled={initialLoading || refreshing || saving || clearing}
            variant="outline"
            size="sm"
          >
            {refreshing ? t('debug.refreshing') : t('debug.refresh')}
          </Button>
          <Button
            type="button"
            onClick={() => void exportFlagged()}
            disabled={exporting || flaggedCount === 0}
            variant="outline"
            size="sm"
          >
            {exporting ? t('debug.exporting') : t('debug.exportFlaggedLogs')}
          </Button>
          <Button
            type="button"
            onClick={() => void clearLogs()}
            disabled={logs.length === 0 || clearing || saving || refreshing}
            variant="outline"
            size="sm"
          >
            {clearing ? t('debug.clearing') : t('debug.clearLogs')}
          </Button>
        </div>

        <p className="text-xs text-slate-400">
          {enabled ? t('debug.captureEnabled') : t('debug.captureDisabled')}{' '}
          {t('debug.flagLimit', {
            count: flaggedCount,
            limit: MAX_FLAGGED_LOGS,
          })}
        </p>

        {mutationError && <ErrorMessage>{mutationError}</ErrorMessage>}
        {loadError?.kind === 'refresh' && (
          <p className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {t('debug.showingSavedResults')} {loadError.message}
          </p>
        )}

        <div className="min-h-[7.75rem]">
          {initialLoading ? (
            <LoadingRows label={t('debug.loadingLogs')} />
          ) : loadError?.kind === 'initial' ? (
            <div className="flex min-h-[7.75rem] items-center justify-between gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              <span>{loadError.message}</span>
              <Button
                type="button"
                onClick={() => void load('initial')}
                size="xs"
              >
                {t('common.retry')}
              </Button>
            </div>
          ) : logs.length === 0 ? (
            <p className="min-h-[7.75rem] rounded-md border border-slate-800/70 bg-slate-950/30 px-3 py-2 text-xs text-slate-500">
              {t('debug.noLogs')}
            </p>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <CaptureLogRow
                  key={log.id}
                  log={log}
                  expanded={expandedId === log.id}
                  updating={updatingLogId !== null}
                  onExpand={() =>
                    setExpandedId(current =>
                      current === log.id ? null : log.id
                    )
                  }
                  onFlag={() => void toggleFlag(log)}
                  rowRef={element => {
                    if (element) rowRefs.current.set(log.id, element);
                    else rowRefs.current.delete(log.id);
                  }}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}

function CaptureLogRow({
  log,
  expanded,
  updating,
  onExpand,
  onFlag,
  rowRef,
  t,
}: {
  log: AssistantDebugLogEntry;
  expanded: boolean;
  updating: boolean;
  onExpand: () => void;
  onFlag: () => void;
  rowRef: (element: HTMLDivElement | null) => void;
  t: TranslateFunction;
}) {
  return (
    <div
      ref={rowRef}
      className="overflow-hidden rounded-md border border-slate-800/70 bg-slate-950/35"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onExpand}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-xs text-slate-300"
        >
          <span className="min-w-0 truncate">
            {formatSource(log.source, t)} ·{' '}
            {new Date(log.createdAt).toLocaleString()}
            {typeof log.timings.totalMs === 'number' &&
              ` · ${log.timings.totalMs}ms`}
          </span>
          <span
            className={clsx(
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
              log.status === 'failed' && 'bg-red-950/70 text-red-300',
              log.status === 'fallback' && 'bg-amber-950/70 text-amber-300',
              log.status === 'dictated' && 'bg-sky-950/70 text-sky-300',
              log.status === 'succeeded' && 'bg-emerald-950/70 text-emerald-300'
            )}
          >
            {formatStatus(log.status, t)}
          </span>
          {expanded ? <FaChevronUp /> : <FaChevronDown />}
        </button>
        <Button
          type="button"
          onClick={onFlag}
          disabled={updating}
          aria-label={
            log.flagged ? t('debug.removeLogFlag') : t('debug.flagLogForExport')
          }
          aria-pressed={log.flagged}
          title={log.flagged ? t('debug.removeFlag') : t('debug.flagForExport')}
          variant="ghost"
          size="xs"
          className={clsx(
            'mr-2 shrink-0 p-1.5',
            log.flagged
              ? 'text-amber-300 hover:text-amber-200'
              : 'text-slate-500 hover:text-slate-300'
          )}
        >
          <FaFlag aria-hidden="true" />
        </Button>
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-slate-800/70 px-3 py-3 text-xs text-slate-300">
          <LogField label={t('debug.submittedInput')} value={log.userPrompt} />
          <CaptureOutput output={log.processedOutput} t={t} />
          <LogField
            label={t('debug.timingBreakdown')}
            value={formatTimings(log.timings, t)}
          />
          <LogField label={t('debug.outcome')} value={log.error} />
          {log.contentTruncated && (
            <p className="text-amber-300">{t('debug.contentTruncated')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function CaptureOutput({
  output,
  t,
}: {
  output: AssistantDebugLogEntry['processedOutput'];
  t: TranslateFunction;
}) {
  if (!output || output.tasks.length === 0) {
    return <LogField label={t('debug.normalizedOutput')} value={null} />;
  }
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {t('debug.normalizedOutput')}
      </p>
      <div className="space-y-2">
        {output.tasks.map((task, index) => (
          <details
            key={`${task.title}-${index}`}
            open={output.tasks.length === 1}
            className="rounded border border-slate-800 px-2 py-1.5"
          >
            <summary className="cursor-pointer break-words font-medium text-slate-200">
              {task.title}
            </summary>
            <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-slate-400">
              {JSON.stringify(task, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}

function LogField({ label, value }: { label: string; value?: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-950/60 p-2 text-[11px] text-slate-300">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div aria-label={label} className="space-y-2">
      {[0, 1, 2].map(index => (
        <div
          key={index}
          className="h-9 animate-pulse rounded-md border border-slate-800/70 bg-slate-950/35"
        />
      ))}
    </div>
  );
}

function ErrorMessage({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
      {children}
    </p>
  );
}

function unwrapResponse<T>(result: unknown): { status: number; body: T } {
  return result &&
    typeof result === 'object' &&
    'status' in result &&
    'body' in result
    ? (result as { status: number; body: T })
    : { status: 200, body: result as T };
}

function formatSource(
  source: AssistantDebugLogEntry['source'],
  t: TranslateFunction
) {
  if (source === 'assistantVoice') return t('debug.assistantVoice');
  if (source === 'dictation') return t('debug.dictation');
  return t('debug.typed');
}

function formatStatus(
  status: AssistantDebugLogEntry['status'],
  t: TranslateFunction
) {
  if (status === 'dictated') return t('debug.notCaptured');
  if (status === 'fallback') return t('debug.fallback');
  if (status === 'failed') return t('common.error');
  return t('common.success');
}

function formatTimings(
  timings: AssistantDebugLogEntry['timings'],
  t: TranslateFunction
) {
  const labels: Record<keyof typeof timings, string> = {
    transcriptionMs: t('debug.transcription'),
    contextMs: t('debug.context'),
    modelRequestMs: t('debug.modelRequest'),
    modelRepairMs: t('debug.modelRepair'),
    modelReviewMs: t('debug.modelReview'),
    outputProcessingMs: t('debug.outputProcessing'),
    validationMs: t('debug.validation'),
    taskCreationMs: t('debug.taskCreation'),
    timerActionMs: t('debug.timerAction'),
    speechSynthesisMs: t('debug.speechSynthesis'),
    totalMs: t('debug.processingTotal'),
  };
  const lines = Object.entries(timings).map(
    ([key, value]) => `${labels[key as keyof typeof timings]}: ${value}ms`
  );
  return lines.length > 0 ? lines.join('\n') : null;
}

function captureLogFileName(username?: string | null) {
  const safeUsername =
    username
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `pomi-ai-capture-logs-${safeUsername}-${timestamp}.json`;
}
