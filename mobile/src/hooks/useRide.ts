import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { type Ride, type LocationUpdate, type Alert, type RideMessage, fetchRideMessages, mergeAlerts, mergeLocations, watchRide, type Connection } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { getRideValue, saveRideValue } from '../lib/tripCache';

/** F8-b: the pack's last known positions survive an app restart in a dead zone. */
const PACK_CACHE_SAVE_MS = 30_000;
const packKey = (rideId: string) => `pack-positions:${rideId}`;
function mergeMessages(previous: RideMessage[], incoming: RideMessage[]): RideMessage[] {
  const byId = new Map<string, RideMessage>();
  for (const m of previous) byId.set(m.id, m);
  for (const m of incoming) {
    const existing = byId.get(m.id);
    byId.set(m.id, existing ? { ...existing, ...m } : m);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export function useRide(rideId: string, userId: string, isOnline: boolean = true) {
  const [ride, setRide] = useState<Ride | null>(null);
  const [liveParticipants, setParticipants] = useState<LocationUpdate[]>([]);
  const [cachedParticipants, setCachedParticipants] = useState<LocationUpdate[]>([]);
  const lastPackSave = useRef(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const feed = useRef<ReturnType<typeof watchRide> | null>(null);
  useEffect(() => {
    if (!rideId || !userId) return;
    let cancelled = false;
    setRide(null); setParticipants([]); setCachedParticipants([]); setAlerts([]); setMessages([]); setError(null);
    lastPackSave.current = 0;
    void getRideValue<LocationUpdate[]>(packKey(rideId)).then(cached => {
      if (!cancelled && Array.isArray(cached)) setCachedParticipants(cached);
    }).catch(() => {});
    void fetchRideMessages(supabase, rideId, 50)
      .then(history => {
        if (!cancelled) setMessages(previous => mergeMessages(previous, history));
      })
      .catch(() => {});
    const watcher = watchRide(supabase, rideId, userId, {
      ride: setRide,
      locations: setParticipants,
      alerts: incoming => setAlerts(previous => mergeAlerts(previous, incoming)),
      onMessage: msg => {
        if (!cancelled) setMessages(previous => mergeMessages(previous, [msg]));
      },
      connection: setConnection,
      error: setError,
    });
    watcher.setOnline(isOnline);
    feed.current = watcher;
    return () => { cancelled = true; watcher.stop(); feed.current = null; };
  }, [rideId, userId]);
  useEffect(() => {
    feed.current?.setOnline(isOnline);
  }, [isOnline]);
  // Never hide a rider: a cached position stays (shown with its age) until a newer one arrives.
  const participants = useMemo(
    () => (cachedParticipants.length ? mergeLocations(cachedParticipants, liveParticipants) : liveParticipants),
    [cachedParticipants, liveParticipants],
  );
  useEffect(() => {
    if (!rideId || !liveParticipants.length || Date.now() - lastPackSave.current < PACK_CACHE_SAVE_MS) return;
    lastPackSave.current = Date.now();
    void saveRideValue(packKey(rideId), participants).catch(() => {});
  }, [rideId, liveParticipants, participants]);
  const publish = useCallback((point: LocationUpdate) => feed.current?.publish(point), []);
  const refresh = useCallback(() => feed.current?.refresh(), []);
  return { ride, participants, alerts, messages, connection, error, publish, refresh, setRide };
}
