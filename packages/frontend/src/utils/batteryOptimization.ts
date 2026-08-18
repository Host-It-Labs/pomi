import {
  checkBatteryOptimizationStatus as checkStatus,
  openBatterySettings as openSettings,
  requestBatteryOptimizationExemption as requestExemption,
  type BatteryStatus,
} from 'tauri-plugin-android-battery-optimization-api';
import { isAndroid, isTauri } from './osUtils';

declare global {
  interface Window {
    __POMI_TEST_BATTERY_OPTIMIZATION__?: BatteryStatus;
  }
}

export async function checkBatteryOptimizationStatus(): Promise<BatteryStatus> {
  if (!isAndroid) {
    return { isOptimized: false, isIgnoringOptimizations: true };
  }

  if (!isTauri) {
    return (
      window.__POMI_TEST_BATTERY_OPTIMIZATION__ ?? {
        isOptimized: false,
        isIgnoringOptimizations: true,
      }
    );
  }

  try {
    const result = await checkStatus();
    console.info('[BatteryOptimization] Status:', result);
    return result;
  } catch (error) {
    console.error('[BatteryOptimization] Error checking status:', error);
    return { isOptimized: true, isIgnoringOptimizations: false };
  }
}

export async function requestBatteryOptimizationExemption(): Promise<boolean> {
  if (!isAndroid) {
    return true;
  }

  if (!isTauri) {
    window.__POMI_TEST_BATTERY_OPTIMIZATION__ = {
      isOptimized: false,
      isIgnoringOptimizations: true,
    };
    return true;
  }

  try {
    console.info('[BatteryOptimization] Requesting exemption...');
    await requestExemption();
    console.info('[BatteryOptimization] Exemption request sent successfully');
    return true;
  } catch (error) {
    console.error('[BatteryOptimization] Error requesting exemption:', error);
    return false;
  }
}

export async function openBatterySettings(): Promise<boolean> {
  if (!isAndroid) {
    return true;
  }

  if (!isTauri) {
    return true;
  }

  try {
    await openSettings();
    return true;
  } catch (error) {
    console.error('Error opening battery settings:', error);
    return false;
  }
}
