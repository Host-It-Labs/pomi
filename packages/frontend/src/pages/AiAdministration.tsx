import { useAuthStore } from '../stores/authStore';
import { useAssistantStore } from '../stores/assistantStore';
import { useI18n } from '../i18n';
import { AssistantSettings } from './AssistantSettings';
import { PageShell } from '../components/ui/PageShell';
import { PageContainer } from '../components/ui/PageContainer';
import { BackButton } from '../components/BackButton';
import { AssistantCaptureLogs } from '../components/assistant/AssistantCaptureLogs';
import { SectionHeader } from '../components/ui/SectionHeader';

export function AiAdministration() {
  const { t } = useI18n();
  const user = useAuthStore.use.user();
  const reload = useAssistantStore.use.loadStatus();
  return (
    <PageShell>
      <PageContainer>
        <header className="flex items-center gap-4 py-4">
          <BackButton targetTab="settings" />
          <h1 className="text-base font-semibold">{t('settings.admin')}</h1>
          <div id="assistant-session-slot-ai-admin" />
          <div id="feedback-session-slot-ai-admin" />
        </header>
        {user?.isAdmin === true ? (
          <div className="space-y-6 pb-6">
            <section className="space-y-3" data-setting-id="aiAdministration">
              <SectionHeader
                title={t('workspace.aiAdministration')}
                description={t('settings.aiInfrastructure')}
              />
              <AssistantSettings onSaved={reload} />
            </section>
            <AssistantCaptureLogs />
          </div>
        ) : (
          <p role="alert">{t('workspace.adminOnly')}</p>
        )}
      </PageContainer>
    </PageShell>
  );
}
