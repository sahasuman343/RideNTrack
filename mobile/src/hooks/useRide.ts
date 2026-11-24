import { useEffect, useState, useRef, useCallback } from 'react';
import { type Ride, type LocationUpdate, type Alert, type RideMessage, fetchRideMessages, mergeAlerts, watchRide, type Connection } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
export function useRide(rideId: string, userId: string, isOnline: boolean = true) {
  const [ride, setRide] = useState<Ride | null>(null);
  const [participants, setParticipants] = useState<LocationUpdate[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const feed = useRef<ReturnType<typeof watchRide> | null>(null);
  useEffect(() => {
    if (!rideId || !userId) return;
    setRide(null); setParticipants([]); setAlerts([]); setMessages([]); setError(null);
    void fetchRideMessages(supabase, rideId, 50).then(setMessages).catch(() => {});
    const watcher = watchRide(supabase, rideId, userId, {
      ride: setRide,
      locations: setParticipants,
      alerts: incoming => setAlerts(previous => mergeAlerts(previous, incoming)),
      onMessage: msg => setMessages(previous => previous.some(m => m.id === msg.id) ? previous : [...previous, msg]),
      connection: setConnection,
      error: setError,
    });
    watcher.setOnline(isOnline);
    feed.current = watcher;
    return () => { watcher.stop(); feed.current = null; };
  }, [rideId, userId]);
  useEffect(() => {
    feed.current?.setOnline(isOnline);
  }, [isOnline]);
  const publish = useCallback((point: LocationUpdate) => feed.current?.publish(point), []);
  const refresh = useCallback(() => feed.current?.refresh(), []);
  return { ride, participants, alerts, messages, connection, error, publish, refresh, setRide };
}
