import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { enqueueLocation } from '../lib/offlineQueue';

export const BACKGROUND_LOCATION_TASK = 'RIDENTRACK_BACKGROUND_LOCATION_TASK';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient || (Constants as any).appOwnership === 'expo';

interface ActiveRideContext {
  rideId: string;
  userId: string;
  displayName: string;
  onLocationUpdate?: (coords: { lat: number; lng: number; speed: number; heading: number }) => void;
  broadcastFn?: (lat: number, lng: number, speed: number, heading: number) => Promise<void> | void;
}

let activeRideContext: ActiveRideContext | null = null;
let fallbackSubscription: Location.LocationSubscription | null = null;

// Register background task at module scope
if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(
    BACKGROUND_LOCATION_TASK,
    async ({ data, error }: { data: any; error: any }) => {
      if (error) {
        console.error('Background location task error:', error.message);
        return;
      }

      if (data) {
        const { locations } = data as { locations: Location.LocationObject[] };
        if (locations && locations.length > 0) {
          const latest = locations[locations.length - 1];
          const { latitude, longitude, speed, heading } = latest.coords;
          const timestamp = new Date(latest.timestamp).toISOString();

          if (activeRideContext) {
            const { rideId, userId, broadcastFn, onLocationUpdate } = activeRideContext;

            // 1. Always store to local offline queue for durability
            await enqueueLocation({
              ride_id: rideId,
              user_id: userId,
              lat: latitude,
              lng: longitude,
              speed: speed || 0,
              heading: heading || 0,
              timestamp,
            });

            // 2. Broadcast over realtime presence if broadcast function is attached
            if (broadcastFn) {
              try {
                await broadcastFn(latitude, longitude, speed || 0, heading || 0);
              } catch (err) {
                console.warn('Realtime broadcast failed in background (offline buffer preserved):', err);
              }
            }

            // 3. Notify in-memory listener
            if (onLocationUpdate) {
              onLocationUpdate({
                lat: latitude,
                lng: longitude,
                speed: speed || 0,
                heading: heading || 0,
              });
            }
          }
        }
      }
    }
  );
}

export async function startBackgroundLocationUpdates(params: {
  rideId: string;
  userId: string;
  displayName: string;
  broadcastFn?: (lat: number, lng: number, speed: number, heading: number) => Promise<void> | void;
  onLocationUpdate?: (coords: { lat: number; lng: number; speed: number; heading: number }) => void;
}): Promise<{ isBackgroundEnabled: boolean }> {
  activeRideContext = params;

  // 1. Request foreground permissions
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    throw new Error('Location permission is required for group ride tracking.');
  }

  // 2. Check and request background permissions (Skip in Expo Go to avoid warning popup)
  let isBackgroundAvailable = false;
  if (!isExpoGo) {
    try {
      const isAvailable = await Location.isBackgroundLocationAvailableAsync();
      if (isAvailable) {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        isBackgroundAvailable = bgStatus === 'granted';
      }
    } catch (e) {
      console.warn('Background location check error:', e);
    }
  }

  if (isBackgroundAvailable) {
    // Check if task already running
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (!hasStarted) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 10,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'RideNTrack Live Ride',
          notificationBody: 'Sharing your real-time ride location with your group',
          notificationColor: '#FF6B00',
        },
      });
    }
    return { isBackgroundEnabled: true };
  } else {
    // Graceful fallback to foreground watchPositionAsync
    if (fallbackSubscription) {
      fallbackSubscription.remove();
    }

    fallbackSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 10,
      },
      async (location: Location.LocationObject) => {
        const { latitude, longitude, speed, heading } = location.coords;
        const timestamp = new Date(location.timestamp).toISOString();

        await enqueueLocation({
          ride_id: params.rideId,
          user_id: params.userId,
          lat: latitude,
          lng: longitude,
          speed: speed || 0,
          heading: heading || 0,
          timestamp,
        });

        if (params.broadcastFn) {
          try {
            await params.broadcastFn(latitude, longitude, speed || 0, heading || 0);
          } catch (e) {
            console.warn('Broadcast failed in foreground watcher:', e);
          }
        }

        if (params.onLocationUpdate) {
          params.onLocationUpdate({
            lat: latitude,
            lng: longitude,
            speed: speed || 0,
            heading: heading || 0,
          });
        }
      }
    );

    return { isBackgroundEnabled: false };
  }
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  activeRideContext = null;

  if (fallbackSubscription) {
    fallbackSubscription.remove();
    fallbackSubscription = null;
  }

  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch (err) {
    console.warn('Error stopping background location task:', err);
  }
}
