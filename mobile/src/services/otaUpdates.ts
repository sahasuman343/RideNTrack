import { AppState } from 'react-native';

/*
 * Over-the-air JavaScript updates (EAS Update). A downloaded update is applied
 * on the next cold start, never by reloading a running app: reloading the ride
 * screen in the middle of a Himalayan pass would drop the GPS session.
 */

type UpdatesModule = typeof import('expo-updates');
let Updates: UpdatesModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Updates = require('expo-updates') as UpdatesModule;
} catch {
  Updates = null;
}

const MIN_CHECK_INTERVAL_MS = 30 * 60 * 1000;
let lastCheck = 0;
let checking = false;

export async function checkForOtaUpdate(): Promise<'none' | 'downloaded' | 'unavailable'> {
  if (!Updates || __DEV__ || !Updates.isEnabled) return 'unavailable';
  if (checking || Date.now() - lastCheck < MIN_CHECK_INTERVAL_MS) return 'none';
  checking = true;
  lastCheck = Date.now();
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return 'none';
    await Updates.fetchUpdateAsync();
    return 'downloaded';
  } catch {
    return 'unavailable';
  } finally {
    checking = false;
  }
}

let started = false;
export function startOtaUpdateChecks() {
  if (started) return;
  started = true;
  void checkForOtaUpdate();
  AppState.addEventListener('change', state => {
    if (state === 'active') void checkForOtaUpdate();
  });
}

export function currentUpdateInfo() {
  if (!Updates) return { channel: null as string | null, updateId: null as string | null, runtimeVersion: null as string | null };
  return { channel: Updates.channel ?? null, updateId: Updates.updateId ?? null, runtimeVersion: Updates.runtimeVersion ?? null };
}
