import { Platform } from 'react-native';
import { performanceProfile, type DeviceFacts, type PerformanceProfile } from '@ridentrack/shared';

let facts: DeviceFacts | null = null;

/** Read once: RAM and year class do not change while the app runs. */
export function deviceFacts(): DeviceFacts {
  if (facts) return facts;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require('expo-device') as typeof import('expo-device');
    facts = { totalMemory: Device.totalMemory ?? null, yearClass: Device.deviceYearClass ?? null, platform: Platform.OS };
  } catch {
    facts = { totalMemory: null, yearClass: null, platform: Platform.OS };
  }
  return facts;
}

export function devicePerformanceProfile(enabled: boolean, override?: Record<string, unknown> | null): PerformanceProfile {
  return performanceProfile(enabled ? deviceFacts() : { platform: 'ios' }, enabled ? override : null);
}
