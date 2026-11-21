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
  onGpsRecovered?: () => void;
  batterySaver?: boolean;
}
let context: Params | null = null;
let fallback: Location.LocationSubscription | null = null;
let generation = 0, lastSync = 0, lastFixTimestamp = 0;
const GPS_INTERVAL_MS = 5000;
const GPS_DISTANCE_METERS = 15;
const QUEUE_SYNC_INTERVAL_MS = 30000;
let operations: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = operations.then(fn, fn); operations = result.catch(() => {}); return result;
}
async function record(locations: Location.LocationObject[]) {
  const version = generation;
  const saved = context || JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
  if (!saved) return;
  const sessionRes = await supabase.auth.getSession().catch(() => null);
  const session = sessionRes?.data?.session;
  // If a session exists, ensure it matches the active rider. Do not drop offline
  // breadcrumbs solely because token refresh failed without connectivity.
  if ((session && session.user.id !== saved.userId) || version !== generation) return;
  for (const location of locations) {
    if (version !== generation || !location || !location.coords) return;
    const { latitude: lat, longitude: lng, speed, heading, accuracy } = location.coords;
    if (!validCoordinates(lat, lng) || (accuracy !== null && accuracy > 100)) continue;
    const timestamp = (typeof location.timestamp === 'number' && Number.isFinite(location.timestamp))
      ? new Date(location.timestamp).toISOString()
      : new Date().toISOString();
    const point: LocationUpdate = {
      user_id: saved.userId,
      display_name: saved.displayName,
      lat,
      lng,
      speed: Math.max(0, typeof speed === 'number' && Number.isFinite(speed) ? speed : 0),
      heading: Math.max(0, typeof heading === 'number' && Number.isFinite(heading) ? heading : 0),
      timestamp,
    };
    try {
      await enqueueLocation({
        ride_id: saved.rideId,
        user_id: point.user_id,
        lat,
        lng,
        speed: point.speed,
        heading: point.heading,
        timestamp: point.timestamp,
      });
    } catch (e) {
      context?.onError?.(e instanceof Error ? e.message : 'Could not queue location update.');
    }
    // A ride/account switch can happen while SQLite commits. Never publish that
    // previous ride's fix through the newly installed live callback.
    if (version !== generation) return;
    try {
      context?.onLocationUpdate?.(point);
    } catch {
      /* Ignore UI update error */
    }
    // Presence delivery is best-effort; it must not block saving the next breadcrumb.
    void Promise.resolve(context?.publish?.(point)).catch(() => {});
    const nowMs = Date.now();
    if (lastFixTimestamp > 0 && nowMs - lastFixTimestamp > 30000) {
      context?.onGpsRecovered?.();
    }
    lastFixTimestamp = nowMs;
  }
  if (Date.now() - lastSync > QUEUE_SYNC_INTERVAL_MS) {
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
export interface BackgroundLocationResult {
  isBackgroundEnabled: boolean;
  permissionGranted?: boolean;
}

/**
 * Start foreground GPS immediately. Do not open Android's background-location
 * Settings flow from a screen effect: on Android 11+ that flow leaves and
 * resumes the app, and starting a native foreground service in the same
 * permission callback is fragile on some OEM builds.
 */
export function startBackgroundLocationUpdates(params: Params): Promise<BackgroundLocationResult> {
  const version = ++generation;
  return serialize(async () => {
    if (version !== generation) return { isBackgroundEnabled: false };
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      throw new Error('Enable location permission in Settings to share your position.');
    }
    context = params;
    await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify({
      rideId: params.rideId, userId: params.userId, displayName: params.displayName,
    }));
    fallback?.remove();
    fallback = null;

    const interval = params.batterySaver ? 15000 : GPS_INTERVAL_MS;
    const distance = params.batterySaver ? 25 : GPS_DISTANCE_METERS;
    const accuracy = params.batterySaver ? Location.Accuracy.Balanced : Location.Accuracy.High;

    // Keep ride tracking useful while background permission is optional.
    // Background permission is requested only from an explicit user action.
    try {
      fallback = await Location.watchPositionAsync({
        accuracy,
        timeInterval: interval,
        distanceInterval: distance,
      }, location => {
        void record([location]).catch(e => params.onError?.(e instanceof Error ? e.message : 'GPS update failed.'));
      });
    } catch (e) {
      params.onError?.(e instanceof Error ? e.message : 'Unable to start foreground location tracker.');
    }
    return { isBackgroundEnabled: false };
  });
}

/**
 * Two-step background enablement:
 * 1. First tap requests ACCESS_BACKGROUND_LOCATION. On Android 11+ Expo opens
 *    system Settings; after the user returns, this call only reports the grant.
 * 2. A second explicit tap starts the location foreground service while the
 *    app is visibly foregrounded. This avoids starting native service work
 *    during the permission Settings return transition.
 */
export function enableBackgroundLocationUpdates(params: Params): Promise<BackgroundLocationResult> {
  const version = generation;
  return serialize(async () => {
    if (version !== generation) return { isBackgroundEnabled: false };
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      params.onError?.('Background GPS requires an installed Android development or preview build.');
      return { isBackgroundEnabled: false, permissionGranted: false };
    }
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      params.onError?.('Allow location while using the app before enabling background GPS.');
      return { isBackgroundEnabled: false, permissionGranted: false };
    }

    let background = await Location.getBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      background = await Location.requestBackgroundPermissionsAsync();
      // Do not start the native service in the same callback that returns
      // from Android Settings. Ask the user to tap again after the app resumes.
      return { isBackgroundEnabled: false, permissionGranted: background.status === 'granted' };
    }

    const interval = params.batterySaver ? 15000 : GPS_INTERVAL_MS;
    const distance = params.batterySaver ? 25 : GPS_DISTANCE_METERS;
    const accuracy = params.batterySaver ? Location.Accuracy.Balanced : Location.Accuracy.High;

    try {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (!alreadyStarted) {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy,
          timeInterval: interval,
          distanceInterval: distance,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'RideNTrack · Sharing location',
            notificationBody: 'Your group can see your position.',
            notificationColor: '#FF6B00',
          },
        });
      }
      if (version !== generation) return { isBackgroundEnabled: false };
      fallback?.remove();
      fallback = null;
      context = params;
      await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify({
        rideId: params.rideId, userId: params.userId, displayName: params.displayName,
      }));
      return { isBackgroundEnabled: true, permissionGranted: true };
    } catch (e) {
      if (version !== generation) return { isBackgroundEnabled: false };
      // Keep foreground GPS alive if Android rejects the foreground service.
      const message = e instanceof Error ? e.message : 'Android could not start background GPS.';
      params.onError?.(message);
      if (!fallback) {
        try {
          fallback = await Location.watchPositionAsync({
            accuracy,
            timeInterval: interval,
            distanceInterval: distance,
          }, location => {
            void record([location]).catch(error => params.onError?.(error instanceof Error ? error.message : 'GPS update failed.'));
          });
        } catch (watchError) {
          params.onError?.(watchError instanceof Error ? watchError.message : 'Foreground GPS fallback failed.');
        }
      }
      return { isBackgroundEnabled: false, permissionGranted: true };
    }
  });
}
export function stopBackgroundLocationUpdates(targetRideId?: string): Promise<void> {
  if (targetRideId && context?.rideId && context.rideId !== targetRideId) {
    return Promise.resolve();
  }
  ++generation; context = null;
  return serialize(async () => {
    if (targetRideId) {
      const saved = JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
      if (saved?.rideId && saved.rideId !== targetRideId) return;
    }
    fallback?.remove(); fallback = null;
    await AsyncStorage.removeItem(CONTEXT_KEY);
    if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
      && await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  });
}
