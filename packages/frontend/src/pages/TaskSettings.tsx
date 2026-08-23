import { Preferences } from '@pomi/shared';
import {
  FaBell,
  FaCoffee,
  FaExchangeAlt,
  FaFileImport,
  FaList,
  FaPlane,
  FaThumbtack,
  FaWindowMinimize,
} from 'react-icons/fa';
import { useState } from 'react';
import { VacationSetupModal } from '../components/vacation/VacationSetupModal';
import { ExtrasSection } from '../components/ExtrasSection';
import { TaskImportModal } from '../components/tasks/TaskImportModal';
import { Button } from '../components/ui/Button';
import { NumberField } from '../components/ui/NumberField';
import { Separator } from '../components/ui/Separator';
import { ToggleField } from '../components/ui/ToggleField';
import { SettingsControlGroup } from '../components/settings/SettingsExperience';
import { submitUserMutation } from '../utils/userActionQueue';
import { useI18n } from '../i18n';

interface TaskSettingsProps {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: any) => Promise<void>;
  onShowNotificationSettings: () => void;
}

export function TaskSettings({
  preferences,
  updatePreference,
  onShowNotificationSettings,
}: TaskSettingsProps) {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [vacationSetupOpen, setVacationSetupOpen] = useState(false);
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <SettingsControlGroup title={t('settings.essentials')}>
        {preferences.tasksExtension && (
          <Button
            variant="secondary"
            onClick={onShowNotificationSettings}
            className="w-full gap-2"
          >
            <FaBell size={12} />
            {t('task.notifications')}
          </Button>
        )}

        <Separator />

        <label className="block space-y-2 text-sm text-slate-200">
          <span className="font-medium" title={t('task.defaultDueDateAbout')}>
            {t('task.defaultDueDate')}
          </span>
          <select
            aria-label={t('task.defaultDueDate')}
            value={preferences.taskDefaultDueDateMode ?? 'tomorrow'}
            onChange={event =>
              void updatePreference(
                'taskDefaultDueDateMode',
                event.target.value
              )
            }
            className="h-10 w-full rounded-md border border-slate-700/60 bg-slate-900 px-3 text-sm text-slate-100"
          >
            <option value="off">{t('common.off')}</option>
            <option value="tomorrow">{t('common.tomorrow')}</option>
            <option value="week">{t('common.inOneWeek')}</option>
            <option value="custom">{t('common.customDayOffset')}</option>
          </select>
        </label>

        {preferences.taskDefaultDueDateMode === 'custom' && (
          <NumberField
            id="taskDefaultDueDateDays"
            label={t('task.daysFromCreation')}
            min={1}
            max={365}
            value={preferences.taskDefaultDueDateDays ?? 1}
            onChange={event => {
              const days = Number(event.target.value);
              if (Number.isInteger(days) && days >= 1 && days <= 365) {
                void updatePreference('taskDefaultDueDateDays', days);
              }
            }}
            helperText={t('task.positiveDayOffset')}
          />
        )}

        <label className="block space-y-2 text-sm text-slate-200">
          <span className="font-medium" title={t('task.defaultSortAbout')}>
            {t('task.defaultSort')}
          </span>
          <select
            aria-label={t('task.defaultSort')}
            value={preferences.taskDefaultSortMode ?? 'default'}
            onChange={event =>
              void updatePreference('taskDefaultSortMode', event.target.value)
            }
            className="h-10 w-full rounded-md border border-slate-700/60 bg-slate-900 px-3 text-sm text-slate-100"
          >
            <option value="default">{t('task.sortDefault')}</option>
            <option value="created-desc">{t('task.sortNewest')}</option>
            <option value="created-asc">{t('task.sortOldest')}</option>
          </select>
          {(preferences.taskDefaultSortMode ?? 'default') === 'default' && (
            <span className="block text-xs text-slate-500">
              {t('task.sortDefaultDescription')}
            </span>
          )}
        </label>

        <label className="block space-y-2 text-sm text-slate-200">
          <span className="font-medium">{t('task.defaultView')}</span>
          <select
            aria-label={t('task.defaultView')}
            value={preferences.taskDefaultViewMode ?? 'list'}
            onChange={event =>
              void updatePreference('taskDefaultViewMode', event.target.value)
            }
            className="h-10 w-full rounded-md border border-slate-700/60 bg-slate-900 px-3 text-sm text-slate-100"
          >
            <option value="list">{t('common.list')}</option>
            <option value="calendar">{t('common.calendar')}</option>
          </select>
          <span className="block text-xs text-slate-500">
            {t('task.defaultViewAbout')}
          </span>
        </label>
      </SettingsControlGroup>

      <ExtrasSection sectionId="tasks">
        <ToggleField
          id="tasksShowInMinimizedTimer"
          checked={preferences.tasksShowInMinimizedTimer ?? false}
          onChange={value =>
            updatePreference('tasksShowInMinimizedTimer', value)
          }
          label={t('task.minimized')}
          icon={<FaWindowMinimize size={12} />}
          description={t('task.minimizedDescription')}
        />

        <Separator />

        <ToggleField
          id="tasksAutoSwitchToIntentionMode"
          checked={preferences.tasksAutoSwitchToIntentionMode ?? true}
          onChange={value =>
            updatePreference('tasksAutoSwitchToIntentionMode', value)
          }
          label={t('task.followPinned')}
          icon={<FaThumbtack size={12} />}
          description={t('task.followPinnedDescription')}
        />

        <Separator />

        <ToggleField
          id="listsExtension"
          checked={preferences.listsExtension ?? false}
          onChange={value => updatePreference('listsExtension', value)}
          label={t('task.lists')}
          icon={<FaList size={12} />}
          description={t('task.listsDescription')}
        />

        <Separator />

        <ToggleField
          id="tasksDuringBreaks"
          checked={preferences.tasksDuringBreaks ?? false}
          onChange={value => updatePreference('tasksDuringBreaks', value)}
          label={t('task.duringBreaks')}
          icon={<FaCoffee size={12} />}
          description={t('task.duringBreaksDescription')}
        />

        <Separator />

        <ToggleField
          id="vacationExtension"
          checked={preferences.vacationExtension ?? false}
          onChange={async value => {
            await updatePreference('vacationExtension', value);
            if (value) setVacationSetupOpen(true);
            else {
              await submitUserMutation({
                kind: 'vacation',
                label: t('task.endVacationMode'),
                payload: { operation: 'deactivate' },
              });
            }
          }}
          label={t('task.vacationMode')}
          icon={<FaPlane size={12} />}
          description={t('task.vacationModeDescription')}
        />
        {preferences.vacationExtension && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setVacationSetupOpen(true)}
          >
            {t('task.setVacationCoverage')}
          </Button>
        )}

        <Separator />

        <ToggleField
          id="longBreakToBreakEnabled"
          checked={preferences.longBreakToBreakEnabled ?? false}
          onChange={value => updatePreference('longBreakToBreakEnabled', value)}
          label={t('task.shortenLongBreaks')}
          icon={<FaExchangeAlt size={12} />}
          description={t('task.shortenLongBreaksDescription')}
        />
      </ExtrasSection>

      <SettingsControlGroup title={t('settings.manage')}>
        <Button
          variant="secondary"
          onClick={() => setIsImportOpen(true)}
          className="w-full gap-2"
        >
          <FaFileImport size={12} />
          {t('task.import')}
        </Button>
      </SettingsControlGroup>

      <TaskImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />
      <VacationSetupModal
        isOpen={vacationSetupOpen}
        onClose={() => setVacationSetupOpen(false)}
      />
    </div>
  );
}
