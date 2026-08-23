import { FaArrowRight } from 'react-icons/fa6';
import { PomiProductScene } from '../../components/brand/PomiProductScene';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n';
import { AccessShell } from './AccessShell';

interface FeatureTourProps {
  index: number;
  count: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

const TOUR_FEATURES = ['focus', 'plan', 'sync'] as const;

export function FeatureTour({
  index,
  count,
  onBack,
  onNext,
  onSkip,
}: FeatureTourProps) {
  const { t } = useI18n();
  const feature = TOUR_FEATURES[index] ?? TOUR_FEATURES[0];
  const scene =
    feature === 'focus' ? 'timer' : feature === 'plan' ? 'tasks' : 'sync';

  return (
    <AccessShell
      onBack={onBack}
      backLabel={t('common.back')}
      badge={t('access.step', { current: index + 1, total: count })}
    >
      <div className="flex flex-1 flex-col pt-4 [@media(max-height:720px)]:pt-2">
        <PomiProductScene
          scene={scene}
          className="h-64 [@media(max-height:720px)]:h-56"
        />

        <div className="mt-5 [@media(max-height:720px)]:mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-300">
            {t(`access.feature.${feature}.eyebrow`)}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white [@media(max-height:720px)]:text-2xl">
            {t(`access.feature.${feature}.title`)}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400 [@media(max-height:720px)]:leading-5">
            {t(`access.feature.${feature}.body`)}
          </p>
        </div>

        <div className="mt-auto pt-6 [@media(max-height:720px)]:pt-3">
          <div className="mb-4 flex justify-center gap-1.5 [@media(max-height:720px)]:mb-2">
            {TOUR_FEATURES.map((item, itemIndex) => (
              <span
                key={item}
                className={`h-1.5 rounded-full transition-all ${
                  itemIndex === index
                    ? 'w-7 bg-indigo-400'
                    : 'w-1.5 bg-slate-800'
                }`}
              />
            ))}
          </div>
          <Button
            size="lg"
            onClick={onNext}
            className="group w-full rounded-xl bg-indigo-600 py-3.5 text-white hover:bg-indigo-500"
          >
            {index === count - 1 ? t('access.seePlans') : t('access.continue')}
            <FaArrowRight className="ml-2 text-xs transition-transform group-hover:translate-x-0.5" />
          </Button>
          <button
            type="button"
            onClick={onSkip}
            className="mt-2 w-full py-2 text-xs text-slate-600 transition hover:text-slate-300"
          >
            {t('access.skipTour')}
          </button>
        </div>
      </div>
    </AccessShell>
  );
}

export const ACCESS_FEATURE_COUNT = TOUR_FEATURES.length;
