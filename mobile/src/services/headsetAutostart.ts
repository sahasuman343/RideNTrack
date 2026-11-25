import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { headsetPromptFor, type HeadsetRide } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { getActiveTracking } from './backgroundLocation';
import { track } from './analytics';

/*
 * F20 headset auto-start. The HeadsetMonitor Expo module (Android only, see
 * docs/features/headset-autostart.md) emits onHeadsetConnected when a
 * Bluetooth audio device connects. We never start sharing from here: we post
 * a local notification for today's ride and the tap opens the ride screen,
 * where the rider starts sharing themselves.
 *
 * Without the native module this file does nothing.
 */

interface NativeHeadsetMonitor {
  start(): void;
  stop(): void;
  /** Names of bonded audio devices, for the "which headset" list. */
  bondedAudioDevices(): Promise<string[]>;
  addListener(event: 'onHeadsetConnected', listener: (e: { name: string | null }) => void): { remove(): void };
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<NativeHeadsetMonitor>('HeadsetMonitor') : null;

const SETTINGS_KEY = 'ridentrack.headset.settings';
const LAST_PROMPT_KEY = 'ridentrack.headset.lastPromptAt';

export interface HeadsetSettings {
  enabled: boolean;
  /** Empty: any device whose name looks like a helmet communicator. */
  devices: string[];
}

export const headsetMonitorAvailable = (): boolean => native != null;

export async function loadHeadsetSettings(): Promise<HeadsetSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { enabled: !!parsed.enabled, devices: Array.isArray(parsed.devices) ? parsed.devices.filter((d: unknown) => typeof d === 'string') : [] };
    }
  } catch {
    // fall through to defaults
  }
  return { enabled: false, devices: [] };
}

export async function saveHeadsetSettings(settings: HeadsetSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function bondedAudioDevices(): Promise<string[]> {
  if (!native) return [];
  try {
    return await native.bondedAudioDevices();
  } catch {
    return [];
  }
}

function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function myUpcomingRides(userId: string): Promise<HeadsetRide[]> {
  const { data, error } = await supabase
    .from('ride_participants')
    .select('rides(id, name, status, start_date)')
    .eq('user_id', userId)
    .eq('is_active', true);
  if (error || !data) return [];
  return (data as any[]).map(p => p.rides).filter((r): r is HeadsetRide => !!r && (r.status === 'active' || r.status === 'planned'));
}

/** Handles one connect event. Exported for tests and for the native module's headless task. */
export async function handleHeadsetConnected(deviceName: string | null, userId: string): Promise<boolean> {
  const settings = await loadHeadsetSettings();
  if (!settings.enabled) return false;
  const lastRaw = await AsyncStorage.getItem(LAST_PROMPT_KEY);
  const now = Date.now();
  const prompt = headsetPromptFor({
    now,
    deviceName,
    allowedDevices: settings.devices,
    rides: await myUpcomingRides(userId),
    sharing: getActiveTracking() != null,
    lastPromptAt: lastRaw ? Number(lastRaw) : null,
    todayIso: localIsoDate(new Date(now)),
  });
  if (!prompt) return false;
  await AsyncStorage.setItem(LAST_PROMPT_KEY, String(now));
  await Notifications.scheduleNotificationAsync({
    content: { title: prompt.title, body: prompt.body, data: { rideId: prompt.ride.id, kind: 'headset_prompt' } },
    trigger: null,
  });
  track('headset_prompt_shown', { ride_status: prompt.ride.status });
  return true;
}

/** Starts listening while the app runs. Returns a stop function. */
export function startHeadsetMonitor(userId: string): () => void {
  if (!native) return () => {};
  native.start();
  const sub = native.addListener('onHeadsetConnected', e => {
    void handleHeadsetConnected(e.name, userId).catch(() => {});
  });
  return () => {
    sub.remove();
    native.stop();
  };
}
