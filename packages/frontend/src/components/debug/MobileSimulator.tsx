import { useLayoutEffect, useMemo, useState } from 'react';
import { FaRedoAlt } from 'react-icons/fa';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useI18n } from '../../i18n';

export const MOBILE_SIMULATOR_PRESETS = [
  {
    id: 'android-20-9',
    label: 'Android 20:9',
    platform: 'android',
    width: 412,
    height: 915,
    topSafeZone: 24,
    bottomSafeZone: 24,
  },
  {
    id: 'iphone-pro-max',
    label: 'iPhone Pro Max',
    platform: 'ios',
    width: 440,
    height: 956,
    topSafeZone: 62,
    bottomSafeZone: 34,
  },
] as const;

export type MobileSimulatorPresetId =
  (typeof MOBILE_SIMULATOR_PRESETS)[number]['id'];

interface MobileSimulatorProps {
  initialPresetId: MobileSimulatorPresetId;
  isOpen: boolean;
  onClose: () => void;
}

export function MobileSimulator({
  initialPresetId,
  isOpen,
  onClose,
}: MobileSimulatorProps) {
  const { t } = useI18n();
  const [presetId, setPresetId] = useState(initialPresetId);
  const [reloadKey, setReloadKey] = useState(0);
  const [scale, setScale] = useState(1);
  const preset =
    MOBILE_SIMULATOR_PRESETS.find(candidate => candidate.id === presetId) ??
    MOBILE_SIMULATOR_PRESETS[0];
  const contentHeight =
    preset.height - preset.topSafeZone - preset.bottomSafeZone;

  useLayoutEffect(() => {
    if (!isOpen) return;
    setPresetId(initialPresetId);
  }, [initialPresetId, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updateScale = () => {
      const availableWidth = Math.max(240, window.innerWidth - 96);
      const availableHeight = Math.max(320, window.innerHeight - 180);
      setScale(
        Math.min(
          1,
          availableWidth / preset.width,
          availableHeight / preset.height
        )
      );
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [isOpen, preset.height, preset.width]);

  const simulatorUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('__pomi_platform', preset.platform);
    url.searchParams.set('__pomi_mobile_simulator', '1');
    return url.toString();
  }, [preset.platform]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('debug.mobileSimulator')}
      closeOnBackdropClick
      closeOnEscape
      className="!w-auto !max-w-none p-3"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {MOBILE_SIMULATOR_PRESETS.map(candidate => (
          <Button
            key={candidate.id}
            type="button"
            size="xs"
            variant={candidate.id === preset.id ? 'primary' : 'outline'}
            aria-pressed={candidate.id === preset.id}
            onClick={() => setPresetId(candidate.id)}
          >
            {candidate.label} · {candidate.width}×{candidate.height}
          </Button>
        ))}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="ml-auto gap-1.5"
          onClick={() => setReloadKey(current => current + 1)}
        >
          <FaRedoAlt aria-hidden="true" size={10} />
          {t('common.reset')}
        </Button>
      </div>

      <div
        data-testid="mobile-simulator-viewport"
        data-device-height={preset.height}
        data-device-width={preset.width}
        data-device-platform={preset.platform}
        data-safe-zone-bottom={preset.bottomSafeZone}
        data-safe-zone-top={preset.topSafeZone}
        data-simulated-content-height={contentHeight}
        className="relative overflow-hidden rounded-[28px] border-4 border-slate-700 bg-slate-950 shadow-2xl shadow-black/60"
        style={{
          width: preset.width * scale + 8,
          height: preset.height * scale + 8,
        }}
      >
        <div
          className="absolute left-0 top-0 bg-slate-950"
          style={{
            width: preset.width,
            height: preset.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <div
            aria-hidden="true"
            data-testid="mobile-simulator-top-safe-zone"
            className="absolute left-0 top-0 z-10 w-full bg-slate-950"
            style={{ height: preset.topSafeZone }}
          >
            {preset.platform === 'ios' ? (
              <div className="absolute left-1/2 top-2 h-7 w-32 -translate-x-1/2 rounded-full bg-black" />
            ) : (
              <div className="absolute left-1/2 top-2 h-2 w-2 -translate-x-1/2 rounded-full bg-slate-800" />
            )}
          </div>

          <iframe
            key={`${preset.id}-${reloadKey}`}
            title={`${preset.label} simulator`}
            src={simulatorUrl}
            data-content-height={contentHeight}
            data-safe-zone-bottom={preset.bottomSafeZone}
            data-safe-zone-top={preset.topSafeZone}
            className="absolute left-0 border-0 bg-slate-950"
            style={{
              top: preset.topSafeZone,
              width: preset.width,
              height: contentHeight,
            }}
          />

          <div
            aria-hidden="true"
            data-testid="mobile-simulator-bottom-safe-zone"
            className="absolute bottom-0 left-0 z-10 w-full bg-slate-950"
            style={{ height: preset.bottomSafeZone }}
          >
            <div className="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-slate-500/80" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
