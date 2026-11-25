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
interface Context {
  rideId: string;
  userId: string;
  displayName: string;
  startedAtMs?: number;
  destination?: { latitude: number; longitude: number } | null;
}
interface Params extends Context {
  onLocationUpdate?: (point: LocationUpdate) => void;
  publish?: (point: LocationUpdate) => Promise<void> | void;
  onError?: (message: string) => void;
  onGpsRecovered?: () => void;
  onAutoStop?: (reason: 'arrived' | 'timeout') => void;
  batterySaver?: boolean;
  activeRidersCount?: number;
  maxRideDurationMs?: number;
}
let context: Params | null = null;
let fallback: Location.LocationSubscription | null = null;
let generation = 0, lastSync = 0, lastFixTimestamp = 0;
let nativeOptionsKey: string | null = null;
let trackingStartedAtMs = 0;
let stationarySinceMs: number | null = null;
let lastMovedCoords: { lat: number; lng: number } | null = null;
let adaptiveLowPower = false;
let lastAdaptivePublishMs = 0;
let arrivedAtDestSinceMs: number | null = null;
const GPS_INTERVAL_MS = 5000;
const GPS_DISTANCE_METERS = 15;
const QUEUE_SYNC_INTERVAL_MS = 30000;
const STATIONARY_THRESHOLD_MS = 2 * 60 * 1000;
const STATIONARY_SPEED_MPS = 2 / 3.6; // 2 km/h
const STATIONARY_DISPLACEMENT_M = 25;
const ADAPTIVE_PUBLISH_INTERVAL_MS = 30_000;
const ARRIVAL_RADIUS_METERS = 200;
const ARRIVAL_DWELL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_RIDE_DURATION_MS = 12 * 60 * 60 * 1000;

function approxDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
let operations: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = operations.then(fn, fn); operations = result.catch(() => {}); return result;
}

export interface ActiveTracking { rideId: string; userId: string }
const trackingListeners = new Set<(tracking: ActiveTracking | null) => void>();
let announced: ActiveTracking | null = null;
function setContext(next: Params | null) {
  context = next;
  const tracking = next ? { rideId: next.rideId, userId: next.userId } : null;
  if (tracking?.rideId === announced?.rideId && tracking?.userId === announced?.userId) return;
  announced = tracking;
  for (const listener of trackingListeners) {
    try { listener(tracking); } catch { /* Listener errors must not affect GPS */ }
  }
}

/**
 * The persisted context is what a headless (app-killed) background task sees,
 * so it must carry everything record() needs: start time for the ride
 * timeout and the destination for arrival auto-stop.
 */
function persistContext(params: Context) {
  const saved: Context = {
    rideId: params.rideId,
    userId: params.userId,
    displayName: params.displayName,
    startedAtMs: params.startedAtMs,
    destination: params.destination ?? null,
  };
  return AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(saved));
}

/** Ride whose location is currently being shared, or null. */
export function getActiveTracking(): ActiveTracking | null {
  return announced;
}

export function subscribeActiveTracking(listener: (tracking: ActiveTracking | null) => void): () => void {
  trackingListeners.add(listener);
  return () => { trackingListeners.delete(listener); };
}

/**
 * Screen unmount must not stop location sharing: riders routinely leave the
 * live map to check the itinerary. Drop only the screen's UI callbacks; the
 * tracker keeps saving and syncing breadcrumbs until an explicit stop.
 */
export function detachBackgroundLocationCallbacks(rideId: string) {
  if (!context || context.rideId !== rideId) return;
  setContext({
    rideId: context.rideId, userId: context.userId, displayName: context.displayName,
    startedAtMs: context.startedAtMs, destination: context.destination, maxRideDurationMs: context.maxRideDurationMs,
  });
}

function trackingOptions(params: Pick<Params, 'batterySaver'>) {
  return {
    accuracy: params.batterySaver ? Location.Accuracy.Balanced : Location.Accuracy.High,
    timeInterval: params.batterySaver ? 15000 : GPS_INTERVAL_MS,
    distanceInterval: params.batterySaver ? 25 : GPS_DISTANCE_METERS,
  };
}

const optionsKey = (params: Pick<Params, 'batterySaver'>) => (params.batterySaver ? 'saver' : 'normal');

async function startNativeUpdates(params: Params, restart = false) {
  if (restart) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    ...trackingOptions(params),
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'RideNTrack · Sharing location',
      notificationBody: params.activeRidersCount && params.activeRidersCount > 0
        ? `Live pack: ${params.activeRidersCount} rider${params.activeRidersCount === 1 ? '' : 's'} active`
        : 'Your group can see your position.',
      notificationColor: '#FF6B00',
    },
  });
  nativeOptionsKey = optionsKey(params);
}

async function nativeUpdatesRunning() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}
async function record(locations: Location.LocationObject[]) {
  const version = generation;
  const saved = context || JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
  if (!saved) return;
  if (!trackingStartedAtMs && saved.startedAtMs) {
    trackingStartedAtMs = saved.startedAtMs;
  }
  const sessionRes = await supabase.auth.getSession().catch(() => null);
  const session = sessionRes?.data?.session;
  // If a session exists, ensure it matches the active rider. Do not drop offline
  // breadcrumbs solely because token refresh failed without connectivity.
  if ((session && session.user.id !== saved.userId) || version !== generation) return;
  for (const location of locations) {
    if (version !== generation || !location || !location.coords) return;
    const { latitude: lat, longitude: lng, speed, heading, accuracy } = location.coords;
    if (!validCoordinates(lat, lng) || (accuracy !== null && accuracy > 100)) continue;
    if (!Number.isFinite(location.timestamp) || location.timestamp > Date.now()
        || !Number.isFinite(new Date(location.timestamp).getTime())) continue;
    const timestamp = new Date(location.timestamp).toISOString();
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
    // Presence delivery is best-effort; throttle when adaptive low-power is active.
    const nowMs = Date.now();
    if (!lastMovedCoords || approxDistanceMeters(lastMovedCoords.lat, lastMovedCoords.lng, lat, lng) >= STATIONARY_DISPLACEMENT_M || point.speed >= STATIONARY_SPEED_MPS) {
      lastMovedCoords = { lat, lng };
      stationarySinceMs = null;
      adaptiveLowPower = false;
    } else {
      stationarySinceMs ??= nowMs;
      if (nowMs - stationarySinceMs >= STATIONARY_THRESHOLD_MS) {
        adaptiveLowPower = true;
      }
    }

    if (!adaptiveLowPower || nowMs - lastAdaptivePublishMs >= ADAPTIVE_PUBLISH_INTERVAL_MS) {
      lastAdaptivePublishMs = nowMs;
      void Promise.resolve(context?.publish?.(point)).catch(() => {});
    }

    if (lastFixTimestamp > 0 && location.timestamp - lastFixTimestamp > 30000 && nowMs - location.timestamp <= 30000) {
      context?.onGpsRecovered?.();
    }
    lastFixTimestamp = Math.max(lastFixTimestamp, location.timestamp);

    // Auto-stop on arrival within 200m of destination for 10 minutes, or max ride timeout.
    const dest = context?.destination ?? saved.destination;
    if (dest && validCoordinates(dest.latitude, dest.longitude)) {
      if (approxDistanceMeters(lat, lng, dest.latitude, dest.longitude) <= ARRIVAL_RADIUS_METERS) {
        arrivedAtDestSinceMs ??= nowMs;
        if (nowMs - arrivedAtDestSinceMs >= ARRIVAL_DWELL_MS) {
          context?.onAutoStop?.('arrived');
          void stopBackgroundLocationUpdates(saved.rideId);
          return;
        }
      } else {
        arrivedAtDestSinceMs = null;
      }
    }
    const maxDuration = context?.maxRideDurationMs ?? DEFAULT_MAX_RIDE_DURATION_MS;
    if (trackingStartedAtMs > 0 && nowMs - trackingStartedAtMs >= maxDuration) {
      context?.onAutoStop?.('timeout');
      void stopBackgroundLocationUpdates(saved.rideId);
      return;
    }
  }
  if (Date.now() - lastSync > QUEUE_SYNC_INTERVAL_MS) {
    lastSync = Date.now();
    void (async () => {
      await syncQueue();
      const { data } = await supabase.from('rides').select('status').eq('id', saved.rideId).maybeSingle();
      if (version === generation && data?.status === 'completed') await stopBackgroundLocationUpdates(saved.rideId);
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
  mode: 'stopped' | 'foreground' | 'background';
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
    if (version !== generation) return { mode: 'stopped' };
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (version !== generation) return { mode: 'stopped' };
    if (foreground.status !== 'granted') {
      throw new Error('Enable location permission in Settings to share your position.');
    }

    // The native service survives screen unmounts and app restarts. Reattach
    // the screen to it instead of downgrading the rider to foreground GPS.
    if (await nativeUpdatesRunning()) {
      if (version !== generation) return { mode: 'stopped' };
      const saved = context || JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
      if (saved?.rideId === params.rideId && saved.userId === params.userId) {
        if (nativeOptionsKey !== optionsKey(params)) await startNativeUpdates(params, true);
        if (version !== generation) return { mode: 'stopped' };
        fallback?.remove();
        fallback = null;
        const restoredStartedAtMs = saved.startedAtMs ?? (trackingStartedAtMs || Date.now());
        trackingStartedAtMs = restoredStartedAtMs;
        const next = { ...params, startedAtMs: restoredStartedAtMs, destination: params.destination ?? saved.destination };
        setContext(next);
        await persistContext(next);
        return { mode: 'background', permissionGranted: true };
      }
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      nativeOptionsKey = null;
      if (version !== generation) return { mode: 'stopped' };
    }

    const startedAtMs = Date.now();
    trackingStartedAtMs = startedAtMs;
    const next = { ...params, startedAtMs };
    setContext(next);
    await persistContext(next);
    fallback?.remove();
    fallback = null;
    lastFixTimestamp = 0;
    stationarySinceMs = null;
    lastMovedCoords = null;
    adaptiveLowPower = false;
    arrivedAtDestSinceMs = null;

    // Keep ride tracking useful while background permission is optional.
    // Background permission is requested only from an explicit user action.
    try {
      fallback = await Location.watchPositionAsync(trackingOptions(params), location => {
        if (version === generation) void record([location]).catch(e => params.onError?.(e instanceof Error ? e.message : 'GPS update failed.'));
      }, reason => { if (version === generation) params.onError?.(reason); });
    } catch (e) {
      setContext(null);
      await AsyncStorage.removeItem(CONTEXT_KEY);
      throw e instanceof Error ? e : new Error('Unable to start foreground location tracker.');
    }
    if (version !== generation) {
      fallback.remove();
      fallback = null;
      return { mode: 'stopped' };
    }
    return { mode: 'foreground' };
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
    if (version !== generation) return { mode: 'stopped' };
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      params.onError?.('Background GPS requires an installed Android development or preview build.');
      return { mode: fallback ? 'foreground' : 'stopped', permissionGranted: false };
    }
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      params.onError?.('Allow location while using the app before enabling background GPS.');
      return { mode: fallback ? 'foreground' : 'stopped', permissionGranted: false };
    }

    let background = await Location.getBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      background = await Location.requestBackgroundPermissionsAsync();
      // Do not start the native service in the same callback that returns
      // from Android Settings. Ask the user to tap again after the app resumes.
      return { mode: fallback ? 'foreground' : 'stopped', permissionGranted: background.status === 'granted' };
    }

    try {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (!alreadyStarted || nativeOptionsKey !== optionsKey(params)) await startNativeUpdates(params, alreadyStarted);
      if (version !== generation) return { mode: 'stopped' };
      fallback?.remove();
      fallback = null;
      // Upgrading to background GPS continues the same ride session, so keep
      // the original start time; otherwise the 12-hour limit would restart.
      const saved = context || JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
      const sameRide = saved?.rideId === params.rideId && saved.userId === params.userId;
      const startedAtMs = (sameRide && saved?.startedAtMs) || trackingStartedAtMs || Date.now();
      trackingStartedAtMs = startedAtMs;
      const next = { ...params, startedAtMs, destination: params.destination ?? (sameRide ? saved?.destination : null) };
      setContext(next);
      await persistContext(next);
      return { mode: 'background', permissionGranted: true };
    } catch (e) {
      if (version !== generation) return { mode: 'stopped' };
      // Keep foreground GPS alive if Android rejects the foreground service.
      const message = e instanceof Error ? e.message : 'Android could not start background GPS.';
      params.onError?.(message);
      return { mode: fallback ? 'foreground' : 'stopped', permissionGranted: true };
    }
  });
}
export function stopBackgroundLocationUpdates(targetRideId?: string): Promise<void> {
  if (targetRideId && context?.rideId && context.rideId !== targetRideId) {
    return Promise.resolve();
  }
  if (!targetRideId || (context?.rideId && context.rideId === targetRideId)) {
    ++generation;
    setContext(null);
  }
  return serialize(async () => {
    if (targetRideId) {
      const saved = JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
      if (saved?.rideId && saved.rideId !== targetRideId) return;
      ++generation;
      setContext(null);
    }
    fallback?.remove(); fallback = null;
    await AsyncStorage.removeItem(CONTEXT_KEY);
    if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
      && await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    nativeOptionsKey = null;
  });
}

/**
 * After an app restart the native service may still be sharing a ride while
 * no screen has attached. Surface it so the rider can see and stop it.
 */
export function restoreActiveTracking(): Promise<ActiveTracking | null> {
  return serialize(async () => {
    if (context) return announced;
    const saved = JSON.parse(await AsyncStorage.getItem(CONTEXT_KEY) || 'null') as Context | null;
    if (!saved || context) return announced;
    if (await nativeUpdatesRunning()) setContext(saved);
    else await AsyncStorage.removeItem(CONTEXT_KEY);
    return announced;
  });
}
