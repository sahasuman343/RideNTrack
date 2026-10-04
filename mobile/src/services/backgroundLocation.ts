import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { validCoordinates, type LocationUpdate } from '@ridentrack/shared';
import { enqueueLocation } from '../lib/offlineQueue';
import { supabase } from '../lib/supabase';
import { syncQueue } from './syncQueue';
export const BACKGROUND_LOCATION_TASK = 'RIDENTRACK_BACKGROUND_LOCATION_TASK';
const CONTEXT_KEY = '@ridentrack/active-ride';
interface Context { rideId: string; userId: string; displayName: string }
interface Params extends Context {
  onLocationUpdate?: (point: LocationUpdate) => void;
  publish?: (point: LocationUpdate) => Promise<void> | void;
  onError?: (message: string) => void;
}
let context: Params | null = null;
let fallback: Location.LocationSubscription | null = null;
let generation = 0, lastSync = 0;
let operations: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = operations.then(fn, fn); operations = result.catch(() => {}); return result;
}
async function record(locations: Location.LocationObject[]) {
  const version = generation;
  const saved = context || JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
  if (!saved) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.id !== saved.userId || version !== generation) return;
  for (const location of locations) {
    if (version !== generation) return;
    const { latitude: lat, longitude: lng, speed, heading, accuracy } = location.coords;
    if (!validCoordinates(lat, lng) || (accuracy !== null && accuracy > 100)) continue;
    const point: LocationUpdate = { user_id: saved.userId, display_name: saved.displayName, lat, lng,
      speed: Math.max(0, speed ?? 0), heading: Math.max(0, heading ?? 0), timestamp: new Date(location.timestamp).toISOString() };
    await enqueueLocation({ ride_id: saved.rideId, user_id: point.user_id, lat, lng, speed: point.speed, heading: point.heading, timestamp: point.timestamp });
    // A ride/account switch can happen while SQLite commits. Never publish that
    // previous ride's fix through the newly installed live callback.
    if (version !== generation) return;
    context?.onLocationUpdate?.(point);
    // Presence delivery is best-effort; it must not block saving the next breadcrumb.
    void Promise.resolve(context?.publish?.(point)).catch(() => {});
  }
  if (Date.now() - lastSync > 10000) {
    lastSync = Date.now();
    void (async () => {
      await syncQueue();
      const { data } = await supabase.from('rides').select('status').eq('id', saved.rideId).maybeSingle();
      if (version === generation && data?.status === 'completed') await stopBackgroundLocationUpdates();
    })().catch(e => context?.onError?.(e.message));
  }
}
if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) { context?.onError?.(error.message); return; }
    try { if (data?.locations) await record(data.locations); }
    catch (e) { context?.onError?.(e instanceof Error ? e.message : 'Could not save GPS update.'); }
  });
}
export function startBackgroundLocationUpdates(params: Params): Promise<{ isBackgroundEnabled: boolean }> {
  const version = ++generation;
  return serialize(async () => {
    if (version !== generation) return { isBackgroundEnabled: false };
    if ((await Location.requestForegroundPermissionsAsync()).status !== 'granted')
      throw new Error('Enable location permission in Settings to share your position.');
    let background = false;
    if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
      try { background = await Location.isBackgroundLocationAvailableAsync()
        && (await Location.requestBackgroundPermissionsAsync()).status === 'granted'; } catch { background = false; }
    }
    if (version !== generation) return { isBackgroundEnabled: false };
    context = params;
    await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify({ rideId: params.rideId, userId: params.userId, displayName: params.displayName }));
    fallback?.remove(); fallback = null;
    if (background) {
      try {
        if (!await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10,
            pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
            foregroundService: { notificationTitle: 'RideNTrack · Sharing location',
              notificationBody: 'Your group can see your position.', notificationColor: '#FF6B00' },
          });
        return { isBackgroundEnabled: true };
      } catch { /* Foreground tracking remains useful if a native background start fails. */ }
    }
    fallback = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10 },
      location => { void record([location]).catch(e => params.onError?.(e.message)); });
    return { isBackgroundEnabled: false };
  });
}
export function stopBackgroundLocationUpdates(): Promise<void> {
  ++generation; context = null;
  return serialize(async () => {
    fallback?.remove(); fallback = null;
    await AsyncStorage.removeItem(CONTEXT_KEY);
    if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
      && await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  });
}
