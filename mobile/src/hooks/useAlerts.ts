import { useEffect, useRef, useState, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Alert, AlertType, ALERT_LABELS } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { enqueueAlert } from '../lib/offlineQueue';

export type { AlertType };
export { ALERT_LABELS };

export function useAlerts(rideId: string, userId: string, displayName: string) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [latestAlert, setLatestAlert] = useState<Alert | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!rideId) return;

    const channel = supabase.channel(`alerts:${rideId}`);

    channel
      .on('broadcast', { event: 'alert' }, (payload: { payload: Alert }) => {
        const alert = payload.payload as Alert;
        setAlerts((prev: Alert[]) => [alert, ...prev]);
        setLatestAlert(alert);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [rideId]);

  const sendAlert = useCallback(
    async (type: AlertType, lat: number, lng: number, message?: string) => {
      const alertId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const createdAt = new Date().toISOString();

      const alert: Alert = {
        id: alertId,
        ride_id: rideId,
        user_id: userId,
        display_name: displayName,
        type,
        message,
        lat,
        lng,
        created_at: createdAt,
      };

      // Always enqueue to local offline queue first for resilience
      await enqueueAlert({
        id: alertId,
        ride_id: rideId,
        user_id: userId,
        type,
        message,
        lat,
        lng,
        created_at: createdAt,
      });

      // Attempt live broadcast
      if (channelRef.current) {
        try {
          await channelRef.current.send({
            type: 'broadcast',
            event: 'alert',
            payload: alert,
          });
        } catch (err) {
          console.warn('Realtime alert broadcast failed, offline queue will sync:', err);
        }
      }

      // Attempt immediate database insertion
      try {
        await supabase.from('alerts').insert({
          id: alertId,
          ride_id: rideId,
          user_id: userId,
          type,
          message,
          lat,
          lng,
        });
      } catch (err) {
        console.warn('Alert DB insert failed, offline queue will sync upon reconnect:', err);
      }

      setAlerts((prev: Alert[]) => [alert, ...prev]);
    },
    [rideId, userId, displayName]
  );

  const dismissAlert = useCallback(() => {
    setLatestAlert(null);
  }, []);

  return { alerts, latestAlert, sendAlert, dismissAlert };
}
