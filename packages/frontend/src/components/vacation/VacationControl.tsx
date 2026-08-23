import { useEffect, useState } from 'react';
import { FaUmbrellaBeach } from 'react-icons/fa';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useVacationStore } from '../../stores/vacationStore';
import { submitUserMutation } from '../../utils/userActionQueue';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { useI18n } from '../../i18n';
import { VacationSetupModal } from './VacationSetupModal';

export function VacationControl() {
  const { t } = useI18n();
  const preferences = usePreferencesStore.use.preferences();
  const timeZone = preferences?.timeZone ?? 'UTC';
  const updatePreferenceWithResult =
    usePreferencesStore.use.updatePreferenceWithResult();
  const state = useVacationStore.use.status();
  const load = useVacationStore.use.loadStatus();
  const [open, setOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [endsOn, setEndsOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [hideCoveredTasks, setHideCoveredTasks] = useState(
    preferences?.tasksShowVacationCovered !== true
  );

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!state.active) return;
    const interval = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(interval);
  }, [load, state.active]);
  const tomorrow = (() => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  })();

  const deactivate = async () => {
    setBusy(true);
    try {
      await submitUserMutation({
        kind: 'vacation',
        label: t('vacation.endMode'),
        payload: { operation: 'deactivate' },
        reconcile: load,
      });
      await load();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    try {
      const showCoveredTasks = !hideCoveredTasks;
      if (preferences?.tasksShowVacationCovered !== showCoveredTasks) {
        const didUpdate = await updatePreferenceWithResult(
          'tasksShowVacationCovered',
          showCoveredTasks
        );
        if (!didUpdate) return;
      }
      await submitUserMutation({
        kind: 'vacation',
        label: t('vacation.startMode'),
        payload: { operation: 'activate', endsOn: endsOn || null },
        reconcile: load,
      });
      await load();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const click = () => {
    if (state.active && !state.endsOn) void deactivate();
    else {
      setHideCoveredTasks(preferences?.tasksShowVacationCovered !== true);
      setOpen(true);
    }
  };

  return (
    <>
      <IconButton
        label={state.active ? t('vacation.modeOn') : t('vacation.mode')}
        size="sm"
        variant={state.active ? 'primary' : 'secondary'}
        onClick={click}
        className={`h-8 w-8 !p-0 ${state.active ? '!bg-amber-500 !text-slate-950 ring-2 ring-amber-300/40' : ''}`}
      >
        <FaUmbrellaBeach size={12} />
      </IconButton>
      <Modal
        isOpen={open && !coverageOpen}
        onClose={() => setOpen(false)}
        title={state.active ? t('vacation.endEarly') : t('vacation.start')}
        closeOnBackdropClick
        closeOnEscape
      >
        {state.active ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {t('vacation.endsAutomaticallyOn', {
                date: state.endsOn ?? '',
              })}
            </p>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => void deactivate()}
            >
              {t('vacation.endNow')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">{t('vacation.modeEffect')}</p>
            <ToggleSwitch
              id="vacationHideCoveredTasks"
              checked={hideCoveredTasks}
              onChange={setHideCoveredTasks}
              label={t('vacation.hideCoveredTasks')}
            />
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setCoverageOpen(true)}
              disabled={busy}
            >
              {t('vacation.reconfigureCoverage')}
            </Button>
            <label className="block text-sm text-slate-300">
              <span className="mb-2 block">
                {t('vacation.returnDate')}{' '}
                <span className="text-slate-500">({t('common.optional')})</span>
              </span>
              <input
                type="date"
                value={endsOn}
                min={tomorrow}
                onChange={event => setEndsOn(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
              />
            </label>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => void activate()}
            >
              {t('vacation.start')}
            </Button>
          </div>
        )}
      </Modal>
      <VacationSetupModal
        isOpen={coverageOpen}
        onClose={() => setCoverageOpen(false)}
      />
    </>
  );
}
