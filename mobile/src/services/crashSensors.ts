import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { MotionSample } from '@ridentrack/shared';

/*
 * Motion samples for crash detection (F7).
 *
 * Two sources, one shape:
 * - native: the CrashDetector Expo module (modules/crash-detector, see
 *   docs/features/crash-detection.md) samples inside the location foreground
 *   service, so it keeps working with the screen locked. It is not in the
 *   build yet; when it is, it is picked up here with no other change.
 * - foreground: expo-sensors while the ride screen is open. The ride screen
 *   keeps the display awake, which covers riders with a mounted phone.
 *
 * Samples are combined at 25 Hz: enough to see a 50 ms impact spike without
 * the battery cost of 100 Hz.
 */

export type CrashSensorSource = 'native' | 'foreground';

const SAMPLE_INTERVAL_MS = 40;
const RAD_TO_DEG = 180 / Math.PI;

interface NativeCrashDetector {
  start(intervalMs: number): void;
  stop(): void;
  addListener(event: 'onSample', listener: (s: { t: number; g: number; gyroDps: number }) => void): { remove(): void };
}

const native = Platform.OS === 'web' ? null : requireOptionalNativeModule<NativeCrashDetector>('CrashDetector');

export function crashSensorSource(): CrashSensorSource {
  return native ? 'native' : 'foreground';
}

/**
 * Starts sampling. speedKmh is read on every sample so the caller can hand in
 * the latest GPS speed without restarting sensors. Returns a stop function.
 */
export async function startCrashSensors(
  onSample: (sample: MotionSample) => void,
  speedKmh: () => number | null,
): Promise<() => void> {
  if (Platform.OS === 'web') return () => {};

  if (native) {
    native.start(SAMPLE_INTERVAL_MS);
    const sub = native.addListener('onSample', s => onSample({ t: s.t, g: s.g, gyroDps: s.gyroDps, speedKmh: speedKmh() }));
    return () => {
      sub.remove();
      native.stop();
    };
  }

  let sensors: typeof import('expo-sensors');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sensors = require('expo-sensors') as typeof import('expo-sensors');
  } catch {
    return () => {};
  }
  const { Accelerometer, Gyroscope } = sensors;
  const [hasAccel, hasGyro] = await Promise.all([
    Accelerometer.isAvailableAsync().catch(() => false),
    Gyroscope.isAvailableAsync().catch(() => false),
  ]);
  if (!hasAccel) return () => {};

  let gyroDps = 0;
  Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
  const subs = [
    Accelerometer.addListener(({ x, y, z }) => {
      onSample({ t: Date.now(), g: Math.sqrt(x * x + y * y + z * z), gyroDps, speedKmh: speedKmh() });
    }),
  ];
  if (hasGyro) {
    Gyroscope.setUpdateInterval(SAMPLE_INTERVAL_MS);
    subs.push(Gyroscope.addListener(({ x, y, z }) => {
      gyroDps = Math.sqrt(x * x + y * y + z * z) * RAD_TO_DEG;
    }));
  }
  return () => subs.forEach(s => s.remove());
}
