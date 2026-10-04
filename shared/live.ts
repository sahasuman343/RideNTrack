import type { SupabaseClient } from '@supabase/supabase-js';
import { type Ride, type LocationUpdate, type Alert, mergeLocations, validCoordinates } from './types';
export type Connection = 'connecting' | 'live' | 'reconnecting';
export interface RideObserver {
  ride: (ride: Ride) => void; locations: (points: LocationUpdate[]) => void;
  alerts: (alerts: Alert[]) => void; connection: (status: Connection) => void;
  error: (message: string | null) => void;
}
export function watchRide(client: SupabaseClient, rideId: string, userId: string, observer: RideObserver) {
  let disposed = false, refreshing = false, connected = false, again = false;
  let points: LocationUpdate[] = [];
  let members = new Map<string, string>();
  let lastPublished: LocationUpdate | null = null;
  const emit = (incoming: LocationUpdate[]) => {
    if (disposed) return;
    points = mergeLocations(points, incoming).filter(p => members.has(p.user_id));
    observer.locations(points);
  };
  async function refresh() {
    if (disposed) return;
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      const [ride, names, locations, alerts] = await Promise.all([
        client.from('rides').select('*').eq('id', rideId).single(),
        client.rpc('get_ride_members', { p_ride_id: rideId }),
        client.rpc('get_latest_ride_locations', { p_ride_id: rideId }),
        client.from('alerts').select('*').eq('ride_id', rideId).order('created_at', { ascending: false }).limit(100),
      ]);
      for (const result of [ride, names, locations, alerts]) if (result.error) throw new Error(result.error.message);
      if (disposed) return;
      members = new Map((names.data as { user_id: string; display_name: string }[]).map(p => [p.user_id, p.display_name]));
      observer.ride(ride.data as Ride);
      emit(locations.data as LocationUpdate[]);
      observer.alerts((alerts.data as Alert[]).map(a => ({ ...a, display_name: members.get(a.user_id) || 'Rider' })));
      observer.error(null);
    } catch (e) { if (!disposed) observer.error(e instanceof Error ? e.message : 'Unable to load this ride.'); }
    finally { refreshing = false; if (again) { again = false; void refresh(); } }
  }
  const presence = client.channel('ride:' + rideId, { config: { private: true, presence: { key: userId } } });
  presence.on('presence', { event: 'sync' }, () => {
    const incoming: LocationUpdate[] = [];
    for (const [id, entries] of Object.entries(presence.presenceState<LocationUpdate>())) {
      if (!members.has(id)) continue;
      for (const entry of entries) if (validCoordinates(entry.lat, entry.lng))
        incoming.push({ ...entry, user_id: id, display_name: members.get(id)! });
    }
    emit(incoming);
  })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts', filter: 'ride_id=eq.' + rideId }, () => void refresh())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: 'id=eq.' + rideId }, payload => {
      if (!disposed) observer.ride(payload.new as Ride);
    }).subscribe(status => {
    if (disposed) return;
    connected = status === 'SUBSCRIBED';
    observer.connection(connected ? 'live' : 'reconnecting');
    if (connected) { void refresh(); if (lastPublished) void presence.track(lastPublished); }
  });
  void refresh();
  const timer = setInterval(() => void refresh(), 15000);
  return {
    refresh,
    async publish(point: LocationUpdate) {
      lastPublished = point;
      if (disposed || !connected) return;
      if (await presence.track(point) !== 'ok' && !disposed) observer.connection('reconnecting');
    },
    stop() { disposed = true; clearInterval(timer); void client.removeChannel(presence); },
  };
}
