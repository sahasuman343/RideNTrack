import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

const TOKEN_KEY = '@ridentrack/push-token';
// Channel IDs and the sound name are shared with supabase/functions/notify-ride-alert.
export const SOS_CHANNEL_ID = 'sos-alerts';
export const RIDE_CHANNEL_ID = 'ride-alerts';

let configured = false;
export function configureNotifications() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(SOS_CHANNEL_ID, {
    name: 'SOS & emergencies',
    description: 'A rider in your group needs immediate help.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'alert_chime.wav',
    vibrationPattern: [0, 600, 250, 600, 250, 600],
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(RIDE_CHANNEL_ID, {
    name: 'Ride alerts',
    description: 'Regroup calls, breakdowns, riders falling behind and captain announcements.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 200, 300],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

function pushSupported() {
  // Remote push is unavailable in Expo Go; use a development or preview build.
  return Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

/**
 * Registers this device for ride alert pushes. With `prompt: false` it only
 * refreshes an existing grant, so the permission dialog appears in context
 * (when the rider opens a live ride) rather than at sign-in.
 */
export async function registerPushToken(userId: string, { prompt }: { prompt: boolean }): Promise<boolean> {
  if (!pushSupported()) return false;
  await ensureChannels();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && prompt) ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return false;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  if (error) throw new Error(error.message);
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify({ token, userId }));
  return true;
}

/** Call while still signed in so the server stops pushing to this device. */
export async function unregisterPushToken(): Promise<void> {
  const saved = JSON.parse(await AsyncStorage.getItem(TOKEN_KEY) || 'null') as { token?: string } | null;
  if (saved?.token) {
    const { error } = await supabase.rpc('unregister_push_token', { p_token: saved.token });
    if (error) console.warn('Could not unregister push token:', error.message);
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export function rideIdFromNotification(response: Notifications.NotificationResponse | null | undefined): string | null {
  const rideId = response?.notification.request.content.data?.rideId;
  return typeof rideId === 'string' && /^[0-9a-f-]{36}$/i.test(rideId) ? rideId : null;
}
