'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  buildCreateTripPlanArgs, fetchDrivingRoute, formatRouteDistance, formatRouteDuration, routeCoordinates,
  tripDates, validateTripPlanDraft, TRIP_TYPE_LABELS, WAYPOINT_META, PLAN_LIMITS,
  type PlaceResult, type TripPlanDraft, type TripPlanType,
} from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { friendlyTripError, MAPBOX_TOKEN, routePointLimit, useEffectiveTier, useRequiredSession } from '@/lib/planner';
import PlaceSearch from '@/components/place-search';

const TripMap = dynamic(() => import('@/components/trip-map'), { ssr: false, loading: () => <div className="h-full min-h-80 rounded-lg bg-map" /> });

type StopKind = TripPlanDraft['stops'][number]['kind'];
const STOP_KINDS: StopKind[] = ['stop', 'fuel', 'food', 'rest', 'sightseeing', 'meetup'];
type Stop = { key: string; place: PlaceResult | null; kind: StopKind };
type RouteResult = { geometry: { type: 'LineString'; coordinates: number[][] }; distance: number; duration: number };

const inputClass = 'field';
const labelClass = 'field-label';

export default function NewTripPage() {
  const session = useRequiredSession();
  const router = useRouter();
  const tier = useEffectiveTier(session?.user.id);
  const limit = routePointLimit(tier);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tripType, setTripType] = useState<TripPlanType>('group');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [origin, setOrigin] = useState<PlaceResult | null>(null);
  const [destination, setDestination] = useState<PlaceResult | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [routeState, setRouteState] = useState<{ key: string; route: RouteResult | null; error: string | null }>({ key: '', route: null, error: null });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ordered = useMemo(() => [
    ...(origin ? [{ ...origin, type: 'origin' }] : []),
    ...stops.filter(s => s.place).map(s => ({ ...(s.place as PlaceResult), type: s.kind as string })),
    ...(destination ? [{ ...destination, type: 'destination' }] : []),
  ], [origin, destination, stops]);
  const routeKey = origin && destination ? ordered.map(p => `${p.longitude},${p.latitude}`).join(';') : '';

  useEffect(() => {
    if (!routeKey || !MAPBOX_TOKEN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchDrivingRoute(routeCoordinates(ordered), { token: MAPBOX_TOKEN, signal: controller.signal })
        .then(result => setRouteState({ key: routeKey, route: result, error: null }))
        .catch(e => { if (!controller.signal.aborted) setRouteState({ key: routeKey, route: null, error: e instanceof Error ? e.message : 'Could not work out a route.' }); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
    // routeKey captures every coordinate change in `ordered`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  const current = routeKey && routeState.key === routeKey;
  const route = current ? routeState.route : null;
  const routeError = current ? routeState.error : null;
  const routing = !!routeKey && !!MAPBOX_TOKEN && !current;

  const days = tripDates(startDate, endDate);
  const maxDays = PLAN_LIMITS[tier].maxTripDays;
  const pointCount = 2 + stops.length;

  function addStop() {
    if (pointCount >= limit) { setError(`Your ${tier === 'free' ? 'Free' : 'Pro Tourer'} plan allows up to ${limit} route points, including start and end.`); return; }
    setError(null);
    setStops(s => [...s, { key: crypto.randomUUID(), place: null, kind: 'stop' }]);
  }
  function moveStop(index: number, delta: number) {
    setStops(s => {
      const next = [...s]; const target = index + delta;
      if (target < 0 || target >= next.length) return s;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const draft: TripPlanDraft = { name, description, tripType, startDate, endDate, origin, destination, stops: stops.map(s => ({ place: s.place, kind: s.kind })) };
    const problem = validateTripPlanDraft(draft, limit) || (maxDays != null && days.length > maxDays ? `The Free plan covers trips of up to ${maxDays} days.` : null);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('create_trip_plan', buildCreateTripPlanArgs(draft, route));
      if (rpcError) throw rpcError;
      if (!data) throw new Error('The trip was not created. Please try again.');
      router.push('/app/trips/' + data);
    } catch (err) {
      setError(friendlyTripError(err, 'Could not create the trip.'));
      setSaving(false);
    }
  }

  return (
    <main>
      <form onSubmit={create} className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <Link href="/app/trips" className="text-sm text-muted hover:text-fg">← All trips</Link>
          <h1 className="mt-3 display text-3xl sm:text-4xl">Plan a <em>trip</em></h1>
          <p className="mt-2 text-sm text-muted">Invite riders and split it into stages from the app once it is saved.</p>

          <div className="mt-8 space-y-5">
            <div>
              <label htmlFor="trip-name" className={labelClass}>Trip name</label>
              <input id="trip-name" className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="Spiti loop" maxLength={120} aria-required="true" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="trip-type" className={labelClass}>Type</label>
                <select id="trip-type" className={inputClass} value={tripType} onChange={e => setTripType(e.target.value as TripPlanType)}>
                  {Object.entries(TRIP_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="start-date" className={labelClass}>Start date</label>
                <input id="start-date" type="date" className={inputClass} value={startDate} onChange={e => { setStartDate(e.target.value); if (!endDate || e.target.value > endDate) setEndDate(e.target.value); }} />
              </div>
              <div>
                <label htmlFor="end-date" className={labelClass}>End date</label>
                <input id="end-date" type="date" className={inputClass} value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            {days.length > 0 && <p className="text-xs text-muted">{days.length} {days.length === 1 ? 'day' : 'days'}{maxDays != null && days.length > maxDays ? ` · the Free plan covers up to ${maxDays}` : ''}</p>}

            <fieldset className="space-y-4 panel p-5">
              <legend className="px-1 text-sm font-semibold">Route</legend>
              <PlaceSearch label="Start" value={origin} onChange={setOrigin} placeholder="Search a town, landmark or PIN code" />
              {stops.map((stop, index) => (
                <div key={stop.key} className="rounded border border-line bg-raise p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={'kind-' + stop.key}>Stop {index + 1} type</label>
                    <select id={'kind-' + stop.key} value={stop.kind} className="rounded border border-line2 bg-bg px-2 py-1 text-xs"
                      onChange={e => setStops(s => s.map(x => x.key === stop.key ? { ...x, kind: e.target.value as StopKind } : x))}>
                      {STOP_KINDS.map(k => <option key={k} value={k}>{WAYPOINT_META[k].label}</option>)}
                    </select>
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label={`Move stop ${index + 1} up`} disabled={index === 0} onClick={() => moveStop(index, -1)} className="rounded px-2 py-1 text-xs hover:bg-surface disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`Move stop ${index + 1} down`} disabled={index === stops.length - 1} onClick={() => moveStop(index, 1)} className="rounded px-2 py-1 text-xs hover:bg-surface disabled:opacity-30">↓</button>
                      <button type="button" aria-label={`Remove stop ${index + 1}`} onClick={() => { setError(null); setStops(s => s.filter(x => x.key !== stop.key)); }} className="rounded px-2 py-1 text-xs text-danger hover:bg-surface">Remove</button>
                    </span>
                  </div>
                  <PlaceSearch label={`Stop ${index + 1}`} value={stop.place} proximity={origin ? [origin.longitude, origin.latitude] : null}
                    onChange={place => setStops(s => s.map(x => x.key === stop.key ? { ...x, place } : x))} placeholder="Fuel pump, dhaba, viewpoint…" />
                </div>
              ))}
              <button type="button" onClick={addStop} className="text-sm font-semibold text-accent hover:underline">+ Add a stop</button>
              <span className="ml-3 text-xs text-faint">{pointCount} of {limit} route points</span>
              <PlaceSearch label="End" value={destination} onChange={setDestination} placeholder="Where does the trip finish?" proximity={origin ? [origin.longitude, origin.latitude] : null} />
            </fieldset>

            <div>
              <label htmlFor="trip-notes" className={labelClass}>Notes for riders (optional)</label>
              <textarea id="trip-notes" className={inputClass + ' min-h-24'} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} placeholder="Meet at the fuel pump at 5:30 AM, full tank." />
            </div>

            {error && <p role="alert" className="notice notice-error">{error}</p>}
            <button type="submit" disabled={saving} className="w-full btn btn-primary py-3.5">
              {saving ? 'Saving trip…' : 'Save trip'}
            </button>
          </div>
        </div>

        <aside className="flex min-h-[420px] flex-col gap-3 lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">
          <TripMap points={ordered} route={route?.geometry ?? null} className="min-h-80 flex-1" />
          <div role="status" aria-live="polite" className="flex flex-wrap gap-x-6 gap-y-1 panel px-5 py-4 text-sm">
            {!origin || !destination ? <span className="text-muted">Choose a start and an end to see the route.</span>
              : routing ? <span className="text-muted">Working out the route…</span>
              : route ? <><span><strong>{formatRouteDistance(route.distance)}</strong> riding</span><span><strong>{formatRouteDuration(route.duration)}</strong> in the saddle</span><span className="text-muted">{ordered.length} points</span></>
              : <span className="text-accent">{routeError ?? 'Route preview unavailable. You can still save the trip.'}</span>}
          </div>
        </aside>
      </form>
    </main>
  );
}
