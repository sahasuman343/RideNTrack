'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  buildSaveTripRouteArgs, fetchDrivingRoute, formatRouteDistance, formatRouteDuration, routeCoordinates,
  validateRoutePoints, EDITABLE_WAYPOINT_TYPES, WAYPOINT_META,
  type PlaceResult, type Ride, type RoutePoint, type RouteWaypointType, type TripDay, type TripWaypoint,
} from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { friendlyTripError, MAPBOX_TOKEN, routePointLimit, useEffectiveTier, useRequiredSession } from '@/lib/planner';
import PlaceSearch from '@/components/place-search';

const TripMap = dynamic(() => import('@/components/trip-map'), { ssr: false, loading: () => <div className="h-full min-h-80 rounded-lg bg-map" /> });

type Point = {
  key: string;
  id: string | null;
  place: PlaceResult | null;
  kind: RouteWaypointType;
  tripDayId: string | null;
  notes: string | null;
  optional: boolean;
};
type RouteResult = { geometry: { type: 'LineString'; coordinates: number[][] }; distance: number; duration: number };

function fromWaypoint(w: TripWaypoint): Point {
  return {
    key: w.id, id: w.id, kind: w.waypoint_type as RouteWaypointType, tripDayId: w.trip_day_id ?? null, notes: w.notes ?? null, optional: !!w.is_optional,
    place: { id: w.provider_place_id || w.id, name: w.name, address: w.address || w.name, longitude: w.longitude, latitude: w.latitude },
  };
}

function endpoints(trip: Ride): Point[] {
  return [
    { key: 'origin', id: null, kind: 'origin', tripDayId: null, notes: null, optional: false, place: { id: 'origin', name: trip.origin, address: trip.origin, longitude: trip.origin_coords[0], latitude: trip.origin_coords[1] } },
    { key: 'destination', id: null, kind: 'destination', tripDayId: null, notes: null, optional: false, place: { id: 'destination', name: trip.destination, address: trip.destination, longitude: trip.destination_coords[0], latitude: trip.destination_coords[1] } },
  ];
}

export default function RouteEditor({ tripId }: { tripId: string }) {
  const session = useRequiredSession();
  const router = useRouter();
  const tier = useEffectiveTier(session?.user.id);
  const [trip, setTrip] = useState<Ride | null>(null);
  const [days, setDays] = useState<TripDay[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [routeState, setRouteState] = useState<{ key: string; route: RouteResult | null; error: string | null }>({ key: '', route: null, error: null });

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    Promise.all([
      supabase.from('rides').select('*').eq('id', tripId).single(),
      supabase.from('trip_waypoints').select('*').eq('ride_id', tripId).order('sequence'),
      supabase.from('trip_days').select('*').eq('ride_id', tripId).order('day_number'),
    ]).then(([rideRes, wpRes, dayRes]) => {
      if (cancelled) return;
      if (rideRes.error || wpRes.error) { setLoadError('This trip could not be loaded. Check your connection and try again.'); return; }
      const ride = rideRes.data as Ride;
      const wps = (wpRes.data as TripWaypoint[]) ?? [];
      setTrip(ride);
      setDays((dayRes.data as TripDay[] | null) ?? []);
      setPoints(wps.length >= 2 ? wps.map(fromWaypoint) : endpoints(ride));
      setLoadError(null);
      // Show the saved line until something changes.
      const saved = ride.route_geometry?.geometry;
      if (saved && ride.estimated_distance_meters != null) {
        const key = (wps.length >= 2 ? wps : []).map(w => `${w.longitude},${w.latitude}`).join(';');
        if (key) setRouteState({ key, route: { geometry: saved, distance: ride.estimated_distance_meters, duration: ride.estimated_duration_seconds ?? 0 }, error: null });
      }
    }, () => { if (!cancelled) setLoadError('This trip could not be loaded. Check your connection and try again.'); });
    return () => { cancelled = true; };
  }, [session, tripId, retry]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const complete = points.length >= 2 && points.every(p => p.place);
  const mapPoints = useMemo(() => points.filter(p => p.place).map(p => ({ ...(p.place as PlaceResult), type: p.kind as string })), [points]);
  const routeKey = complete ? mapPoints.map(p => `${p.longitude},${p.latitude}`).join(';') : '';

  useEffect(() => {
    if (!routeKey || !MAPBOX_TOKEN || routeState.key === routeKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchDrivingRoute(routeCoordinates(mapPoints), { token: MAPBOX_TOKEN, signal: controller.signal })
        .then(result => setRouteState({ key: routeKey, route: result as RouteResult, error: null }))
        .catch(e => { if (!controller.signal.aborted) setRouteState({ key: routeKey, route: null, error: e instanceof Error ? e.message : 'Could not work out a route.' }); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
    // routeKey captures every coordinate change in mapPoints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const current = !!routeKey && routeState.key === routeKey;
  const route = current ? routeState.route : null;
  const routeError = current ? routeState.error : null;
  const routing = !!routeKey && !!MAPBOX_TOKEN && !current;
  const limit = routePointLimit(tier);
  const isLeader = !!trip && trip.admin_id === session?.user.id;

  function edit(fn: (p: Point[]) => Point[]) { setPoints(fn); setDirty(true); setError(null); }
  function setPlace(key: string, place: PlaceResult | null) { edit(ps => ps.map(p => p.key === key ? { ...p, place } : p)); }
  function addStop() {
    if (points.length >= limit) { setError(`Your ${tier === 'free' ? 'Free' : 'Pro Tourer'} plan allows up to ${limit} route points, including start and end.`); return; }
    edit(ps => [...ps.slice(0, -1), { key: crypto.randomUUID(), id: null, place: null, kind: 'stop', tripDayId: null, notes: null, optional: false }, ps[ps.length - 1]]);
  }
  function move(index: number, delta: number) {
    edit(ps => {
      const target = index + delta;
      if (target < 1 || target > ps.length - 2) return ps;
      const next = [...ps]; [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!trip || saving) return;
    if (!complete) { setError('Choose a place for every stop, or remove the empty ones.'); return; }
    const routePoints: RoutePoint[] = points.map((p, sequence) => ({
      id: p.id, sequence, waypoint_type: p.kind, name: (p.place as PlaceResult).name, address: (p.place as PlaceResult).address,
      latitude: (p.place as PlaceResult).latitude, longitude: (p.place as PlaceResult).longitude,
      provider_place_id: p.id ? undefined : (p.place as PlaceResult).id, notes: p.notes, is_optional: p.optional, trip_day_id: p.tripDayId,
    }));
    const problem = validateRoutePoints(routePoints);
    if (problem) { setError(problem); return; }
    if (!route) { setError(routing ? 'The route is still being worked out. Try again in a moment.' : 'The road route could not be worked out, so it cannot be saved yet.'); return; }
    setSaving(true); setError(null);
    const { error: rpcError } = await supabase.rpc('save_trip_route', buildSaveTripRouteArgs(trip.id, routePoints, days, route));
    if (rpcError) { setSaving(false); setError(friendlyTripError(rpcError, 'Could not save the route.')); return; }
    setDirty(false);
    router.push('/app/trips/' + trip.id);
  }

  if (loadError) return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8"><div role="alert" className="notice notice-error">{loadError} <button className="ml-2 underline" onClick={() => { setLoadError(null); setRetry(v => v + 1); }}>Try again</button></div></main>;
  if (!trip) return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8"><p role="status" className="text-muted">Loading route…</p></main>;
  if (!isLeader) return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <Link href={'/app/trips/' + trip.id} className="text-sm text-muted hover:text-fg">← {trip.name}</Link>
      <p className="notice mt-6 max-w-xl">Only the trip leader can change the route. Ask them to add the stop you have in mind.</p>
    </main>
  );

  const proximity: [number, number] | null = points[0]?.place ? [points[0].place.longitude, points[0].place.latitude] : null;

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0">
        <Link href={'/app/trips/' + trip.id} className="text-sm text-muted hover:text-fg">← {trip.name}</Link>
        <h1 className="display mt-3 text-3xl sm:text-4xl">Edit <em>route</em></h1>
        <p className="mt-2 text-sm text-muted">Changes reach every rider’s app when you save.</p>

        <ol className="mt-8 space-y-3" aria-label="Route points">
          {points.map((point, index) => {
            const end = index === 0 || index === points.length - 1;
            const label = index === 0 ? 'Start' : index === points.length - 1 ? 'End' : `Stop ${index}`;
            return (
              <li key={point.key} className={end ? 'panel p-3' : 'rounded border border-line bg-raise p-3'}>
                {!end && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={'kind-' + point.key}>{label} type</label>
                    <select id={'kind-' + point.key} value={point.kind} className="rounded border border-line2 bg-bg px-2 py-1 text-xs"
                      onChange={e => edit(ps => ps.map(p => p.key === point.key ? { ...p, kind: e.target.value as RouteWaypointType } : p))}>
                      {EDITABLE_WAYPOINT_TYPES.map(k => <option key={k} value={k}>{WAYPOINT_META[k].label}</option>)}
                    </select>
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label={`Move ${label.toLowerCase()} up`} disabled={index === 1} onClick={() => move(index, -1)} className="rounded px-2 py-1 text-xs hover:bg-surface disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`Move ${label.toLowerCase()} down`} disabled={index === points.length - 2} onClick={() => move(index, 1)} className="rounded px-2 py-1 text-xs hover:bg-surface disabled:opacity-30">↓</button>
                      <button type="button" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => edit(ps => ps.filter(p => p.key !== point.key))} className="rounded px-2 py-1 text-xs text-danger hover:bg-surface">Remove</button>
                    </span>
                  </div>
                )}
                <PlaceSearch label={label} value={point.place} onChange={place => setPlace(point.key, place)} proximity={index === 0 ? null : proximity}
                  placeholder={index === 0 ? 'Where does the trip start?' : end ? 'Where does the trip finish?' : 'Fuel pump, dhaba, viewpoint…'} />
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={addStop} className="text-sm font-semibold text-accent hover:underline">+ Add a stop</button>
          <span className="text-xs text-faint">{points.length} of {limit} route points</span>
        </div>

        {error && <p role="alert" className="notice notice-error mt-6">{error}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="btn btn-primary">{saving ? 'Saving route…' : 'Save route'}</button>
          <Link href={'/app/trips/' + trip.id} className="btn hover:bg-raise">Cancel</Link>
        </div>
      </div>

      <aside className="flex min-h-[420px] flex-col gap-3 lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">
        <TripMap points={mapPoints} route={route?.geometry ?? null} className="min-h-80 flex-1" />
        <div role="status" aria-live="polite" className="panel flex flex-wrap gap-x-6 gap-y-1 px-5 py-4 text-sm">
          {!complete ? <span className="text-muted">Choose a place for every point to see the route.</span>
            : routing ? <span className="text-muted">Working out the route…</span>
            : route ? <><span><strong className="font-mono">{formatRouteDistance(route.distance)}</strong> riding</span><span><strong className="font-mono">{formatRouteDuration(route.duration)}</strong> in the saddle</span><span className="text-muted">{points.length} points</span></>
            : <span className="text-danger">{routeError ?? 'Route preview unavailable.'}</span>}
        </div>
      </aside>
    </main>
  );
}
