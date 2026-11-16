import type { SupabaseClient } from '@supabase/supabase-js';
import { type Ride, type LocationUpdate, type Alert, mergeLocations, validCoordinates } from './types';
export type Connection = 'connecting' | 'live' | 'reconnecting';
export interface RideObserver {
  ride: (ride: Ride) => void; locations: (points: LocationUpdate[]) => void;
  alerts: (alerts: Alert[]) => void; connection: (status: Connection) => void;
  error: (message: string | null) => void;
}

const RECONCILE_INTERVAL_MS = 60_000;

export function watchRide(client: SupabaseClient, rideId: string, userId: string, observer: RideObserver) {
  let disposed = false;
  let refreshing = false;
  let refreshingLocations = false;
  let refreshingAlerts = false;
  let pendingAlerts = false;
  let pendingRefresh = false;
  let connected = false;
  let points: LocationUpdate[] = [];
  let members = new Map<string, string>();
  let lastPublished: LocationUpdate | null = null;

  const emit = (incoming: LocationUpdate[]) => {
    if (disposed) return;
    const next = mergeLocations(points, incoming).filter(p => members.has(p.user_id));
    // Avoid waking React and the map when Presence/reconciliation repeats the
    // exact same rider positions.
    const previousById = new Map(points.map(point => [point.user_id, point]));
    if (next.length === points.length && next.every(point => {
      const old = previousById.get(point.user_id);
      return old === point || (old?.timestamp === point.timestamp
        && old.lat === point.lat && old.lng === point.lng
        && old.speed === point.speed && old.heading === point.heading);
    })) return;
    points = next;
    observer.locations(points);
  };

  async function refreshAlerts() {
    if (disposed) return;
    if (refreshingAlerts) { pendingAlerts = true; return; }
    refreshingAlerts = true;
    try {
      const { data, error } = await client.from('alerts').select('*')
        .eq('ride_id', rideId).order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      if (disposed) return;
      observer.alerts((data || []).map(a => ({
        ...a,
        display_name: members.get(a.user_id) || 'Rider',
      })) as Alert[]);
    } catch (e) {
      if (!disposed) observer.error(e instanceof Error ? e.message : 'Unable to refresh ride alerts.');
    } finally {
      refreshingAlerts = false;
      if (pendingAlerts && !disposed) { pendingAlerts = false; void refreshAlerts(); }
    }
  }

  async function refreshLocations() {
    if (disposed || refreshingLocations) return;
    refreshingLocations = true;
    try {
      const [names, locations] = await Promise.all([
        client.rpc('get_ride_members', { p_ride_id: rideId }),
        client.rpc('get_latest_ride_locations', { p_ride_id: rideId }),
      ]);
      if (names.error) throw new Error(names.error.message);
      if (locations.error) throw new Error(locations.error.message);
      if (!disposed) {
        members = new Map((names.data as { user_id: string; display_name: string }[]).map(p => [p.user_id, p.display_name]));
        emit((locations.data || []) as LocationUpdate[]);
        observer.error(null);
      }
    } catch (e) {
      if (!disposed) observer.error(e instanceof Error ? e.message : 'Unable to refresh rider locations.');
    } finally {
      refreshingLocations = false;
    }
  }

  async function refresh() {
    if (disposed) return;
    if (refreshing) { pendingRefresh = true; return; }
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
    } catch (e) {
      if (!disposed) observer.error(e instanceof Error ? e.message : 'Unable to load this ride.');
    } finally {
      refreshing = false;
      if (pendingRefresh && !disposed) { pendingRefresh = false; void refresh(); }
    }
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts', filter: 'ride_id=eq.' + rideId }, () => void refreshAlerts())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: 'id=eq.' + rideId }, payload => {
      if (!disposed) observer.ride(payload.new as Ride);
    }).subscribe(status => {
      if (disposed) return;
      connected = status === 'SUBSCRIBED';
      observer.connection(connected ? 'live' : 'reconnecting');
      // Reconcile once after subscribe/reconnect. The periodic fallback below
      // only fetches locations, rather than reloading all ride metadata.
      if (connected) {
        void refresh();
        if (lastPublished) void presence.track(lastPublished);
      }
    });

  void refresh();
  const timer = setInterval(() => void refreshLocations(), RECONCILE_INTERVAL_MS);

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
