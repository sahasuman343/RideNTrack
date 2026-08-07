import { useEffect, useState, useRef, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import {
  getQueuedLocations,
  clearQueuedLocations,
  getQueuedLocationsCount,
  getQueuedAlerts,
  clearQueuedAlert,
  getQueuedAlertsCount,
} from '../lib/offlineQueue';

export function useOfflineSync(rideId?: string) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingLocationsCount, setPendingLocationsCount] = useState(0);
  const [pendingAlertsCount, setPendingAlertsCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  const updateCounts = useCallback(async () => {
    const locCount = await getQueuedLocationsCount();
    const alertCount = await getQueuedAlertsCount();
    setPendingLocationsCount(locCount);
    setPendingAlertsCount(alertCount);
  }, []);

  const flushQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);

    try {
      // 1. Flush offline alerts first (highest priority)
      const alerts = await getQueuedAlerts();
      for (const alert of alerts) {
        const { error } = await supabase.from('alerts').insert({
          id: alert.id,
          ride_id: alert.ride_id,
          user_id: alert.user_id,
          type: alert.type,
          message: alert.message,
          lat: alert.lat,
          lng: alert.lng,
          created_at: alert.created_at,
        });

        if (!error) {
          await clearQueuedAlert(alert.id);
        }
      }

      // 2. Flush queued locations in batches
      let batch = await getQueuedLocations(100);
      while (batch.length > 0) {
        const payload = batch.map((item) => ({
          ride_id: item.ride_id,
          user_id: item.user_id,
          lat: item.lat,
          lng: item.lng,
          speed: item.speed,
          heading: item.heading,
          timestamp: item.timestamp,
        }));

        const { error } = await supabase.rpc('bulk_insert_location_updates', {
          updates: payload,
        });

        if (error) {
          console.warn('Batch location sync failed:', error.message);
          break;
        }

        const timestamps = batch.map((b) => b.timestamp);
        await clearQueuedLocations(timestamps);

        // Fetch next batch if available
        batch = await getQueuedLocations(100);
      }
    } catch (err) {
      console.error('Error during offline sync flush:', err);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      await updateCounts();
    }
  }, [updateCounts]);

  useEffect(() => {
    updateCounts();

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = Boolean(state.isConnected && (state.isInternetReachable ?? true));
      setIsOnline(online);
      if (online) {
        flushQueue();
      }
    });

    // Periodic check interval
    const interval = setInterval(() => {
      updateCounts();
    }, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [flushQueue, updateCounts, rideId]);

  return {
    isOnline,
    pendingLocationsCount,
    pendingAlertsCount,
    isSyncing,
    flushQueue,
    updateCounts,
  };
}
