import { useEffect, useState, useRef, useCallback } from 'react';
import { type Ride, type LocationUpdate, type Alert, mergeAlerts, watchRide, type Connection } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
export function useRide(rideId: string, userId: string) {
  const [ride, setRide] = useState<Ride | null>(null);
  const [participants, setParticipants] = useState<LocationUpdate[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const feed = useRef<ReturnType<typeof watchRide> | null>(null);
  useEffect(() => {
    if (!rideId || !userId) return;
    setRide(null); setParticipants([]); setAlerts([]); setError(null);
    const watcher = watchRide(supabase, rideId, userId, { ride: setRide, locations: setParticipants,
      alerts: incoming => setAlerts(previous => mergeAlerts(previous, incoming)), connection: setConnection, error: setError });
    feed.current = watcher;
    return () => { watcher.stop(); feed.current = null; };
  }, [rideId, userId]);
  const publish = useCallback((point: LocationUpdate) => feed.current?.publish(point), []);
  const refresh = useCallback(() => feed.current?.refresh(), []);
  return { ride, participants, alerts, connection, error, publish, refresh, setRide };
}
