import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
interface Alert {
  id: string;
  ride_id: string;
  user_id: string;
  display_name: string;
  type: 'emergency' | 'break' | 'fuel' | 'mechanical';
  message?: string;
  lat: number;
  lng: number;
  created_at: string;
  acknowledged_at?: string;
}
import { RealtimeChannel } from '@supabase/supabase-js';

export type AlertType = 'emergency' | 'break' | 'fuel' | 'mechanical';

export function useAlerts(rideId: string, userId: string, displayName: string) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [latestAlert, setLatestAlert] = useState<Alert | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!rideId) return;

    const channel = supabase.channel(`alerts:${rideId}`);

    channel
      .on('broadcast', { event: 'alert' }, (payload) => {
        const alert = payload.payload as Alert;
        setAlerts((prev) => [alert, ...prev]);
        setLatestAlert(alert);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [rideId]);

  const sendAlert = useCallback(async (type: AlertType, lat: number, lng: number, message?: string) => {
    if (!channelRef.current) return;

    const alert: Alert = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      ride_id: rideId,
      user_id: userId,
      display_name: displayName,
      type,
      message,
      lat,
      lng,
      created_at: new Date().toISOString(),
    };

    // Broadcast to all participants
    await channelRef.current.send({
      type: 'broadcast',
      event: 'alert',
      payload: alert,
    });

    // Persist to database
    await supabase.from('alerts').insert({
      ride_id: rideId,
      user_id: userId,
      type,
      message,
      lat,
      lng,
    });

    setAlerts((prev) => [alert, ...prev]);
  }, [rideId, userId, displayName]);

  const dismissAlert = useCallback(() => {
    setLatestAlert(null);
  }, []);

  return { alerts, latestAlert, sendAlert, dismissAlert };
}
