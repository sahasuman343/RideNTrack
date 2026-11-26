'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatRouteDistance, TRIP_TYPE_LABELS, type Ride, type TripPlanType } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { formatTripDates, useRequiredSession } from '@/lib/planner';


type Filter = 'upcoming' | 'past' | 'all';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
];

export default function TripsPage() {
  const session = useRequiredSession();
  const [trips, setTrips] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function load() {
      try {
        const rides = await supabase.from('ride_participants')
            .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id, trip_type, start_date, end_date, estimated_distance_meters, estimated_duration_seconds, created_at)')
            .eq('user_id', session!.user.id).eq('is_active', true).order('joined_at', { ascending: false });
        if (rides.error) throw rides.error;
        if (cancelled) return;
        setTrips((rides.data as { rides: unknown }[]).map(r => r.rides).filter(Boolean) as Ride[]);
        setError(null);
      } catch {
        if (!cancelled) setError('Could not load your trips. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [session, retry]);

  const shown = useMemo(() => {
    const isPast = (t: Ride) => t.status === 'completed' || t.status === 'archived';
    const list = trips.filter(t => filter === 'all' ? true : filter === 'past' ? isPast(t) : !isPast(t));
    const key = (t: Ride) => t.start_date || t.created_at || '';
    return list.sort((a, b) => filter === 'upcoming' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a)));
  }, [trips, filter]);

  return (
    <main>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow-label">Trip planner</p>
            <h1 className="mt-3 display text-4xl sm:text-5xl">Your <em>trips</em></h1>
            <p className="mt-3 text-sm text-muted">Trips you plan here show up in the RideNTrack app on your phone.</p>
          </div>
          <Link href="/app/trips/new" className="btn btn-primary">Plan a trip</Link>
        </div>
        <div role="tablist" aria-label="Filter trips" className="mt-8 flex gap-2">
          {FILTERS.map(f => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={'rounded border px-3.5 py-1.5 text-sm ' + (filter === f.key ? 'border-accent text-fg' : 'border-line2 text-muted hover:text-fg')}>
              {f.label}
            </button>
          ))}
        </div>
        {error && <div role="alert" className="mt-6 notice notice-error">{error}<button className="ml-4 underline" onClick={() => { setError(null); setLoading(true); setRetry(v => v + 1); }}>Try again</button></div>}
        {loading ? <p role="status" className="mt-10 text-muted">Loading your trips…</p>
          : shown.length === 0 && !error ? (
            <div className="mt-8 panel border-dashed p-10 text-center">
              <h2 className="display text-2xl">{filter === 'past' ? 'No finished trips yet.' : 'No trips planned yet.'}</h2>
              <p className="mt-3 text-sm text-muted">Pick a start, an end and a few stops. We will work out the route.</p>
              <Link href="/app/trips/new" className="mt-6 inline-block text-sm font-semibold text-accent underline">Plan your first trip</Link>
            </div>
          ) : (
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              {shown.map(trip => (
                <Link key={trip.id} href={'/app/trips/' + trip.id} className="trip-card panel p-5 transition-colors hover:border-line2 hover:bg-raise">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-xl font-semibold">{trip.name}</h2>
                    <span className={'chip shrink-0 ' + (trip.status === 'active' ? 'chip-live' : trip.status === 'planned' ? 'chip-accent' : '')}>{trip.status}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">{formatTripDates(trip.start_date, trip.end_date)} · {TRIP_TYPE_LABELS[(trip.trip_type ?? 'group') as TripPlanType]}</p>
                  <p className="mt-4 truncate text-sm">{trip.origin} → {trip.destination}</p>
                  <div className="mt-5 flex justify-between border-t border-line pt-4 text-xs">
                    <span className="text-muted">{formatRouteDistance(trip.estimated_distance_meters)}{trip.admin_id === session?.user.id ? ' · You lead' : ''}</span>
                    <span className="font-semibold text-accent">Open plan ↗</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
      </section>
    </main>
  );
}
