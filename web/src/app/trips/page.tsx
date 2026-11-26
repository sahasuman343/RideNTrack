'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatRouteDistance, TRIP_TYPE_LABELS, type Ride, type TripPlanType } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { formatTripDates, useRequiredSession } from '@/lib/planner';
import AppHeader from '@/components/app-header';


type Filter = 'upcoming' | 'past' | 'all';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
];

export default function TripsPage() {
  const session = useRequiredSession();
  const [trips, setTrips] = useState<Ride[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function load() {
      try {
        const [profile, rides] = await Promise.all([
          supabase.from('profiles').select('display_name').eq('id', session!.user.id).single(),
          supabase.from('ride_participants')
            .select('ride_id, rides(id, name, ride_code, origin, destination, status, admin_id, trip_type, start_date, end_date, estimated_distance_meters, estimated_duration_seconds, created_at)')
            .eq('user_id', session!.user.id).eq('is_active', true).order('joined_at', { ascending: false }),
        ]);
        if (rides.error) throw rides.error;
        if (cancelled) return;
        setName((profile.data as { display_name?: string } | null)?.display_name ?? null);
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
    <main className="min-h-screen bg-[#f7f8f3] text-[#203c43]">
      <AppHeader name={name} />
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.2em] text-[#718084]">PLAN IT ON THE BIG SCREEN</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">My Trips</h1>
            <p className="mt-3 text-sm text-[#718084]">Trips you plan here show up in the RideNTrack app on your phone.</p>
          </div>
          <Link href="/trips/new" className="rounded-full bg-[#d66029] px-5 py-3 text-sm font-semibold text-white hover:bg-[#bf5422]">Plan a trip</Link>
        </div>
        <div role="tablist" aria-label="Filter trips" className="mt-8 flex gap-2">
          {FILTERS.map(f => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={'rounded-full border px-4 py-1.5 text-sm ' + (filter === f.key ? 'border-[#203c43] bg-[#203c43] text-white' : 'border-[#d9e1d4] bg-white hover:border-[#203c43]')}>
              {f.label}
            </button>
          ))}
        </div>
        {error && <div role="alert" className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm">{error}<button className="ml-4 underline" onClick={() => { setError(null); setLoading(true); setRetry(v => v + 1); }}>Try again</button></div>}
        {loading ? <p role="status" className="mt-10 text-[#718084]">Loading your trips…</p>
          : shown.length === 0 && !error ? (
            <div className="mt-8 rounded-2xl border border-dashed border-[#ccd8c8] bg-white p-12 text-center">
              <h2 className="text-xl font-semibold">{filter === 'past' ? 'No finished trips yet.' : 'No trips planned yet.'}</h2>
              <p className="mt-3 text-sm text-[#718084]">Pick a start, an end and a few stops. We will work out the route.</p>
              <Link href="/trips/new" className="mt-6 inline-block text-sm font-semibold text-[#d66029] underline">Plan your first trip</Link>
            </div>
          ) : (
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              {shown.map(trip => (
                <Link key={trip.id} href={'/trip?id=' + trip.id} className="trip-card rounded-2xl border border-[#e0e7da] bg-white p-6 transition hover:border-[#df9b6d] hover:shadow-sm focus-visible:outline-2 focus-visible:outline-[#d66029]">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold">{trip.name}</h2>
                    <span className={'shrink-0 rounded-full px-3 py-1 text-[10px] uppercase tracking-wide ' + (trip.status === 'active' ? 'bg-green-50 text-green-700' : trip.status === 'planned' ? 'bg-[#fbeee6] text-[#a2502a]' : 'bg-stone-100 text-stone-500')}>{trip.status}</span>
                  </div>
                  <p className="mt-2 text-xs text-[#718084]">{formatTripDates(trip.start_date, trip.end_date)} · {TRIP_TYPE_LABELS[(trip.trip_type ?? 'group') as TripPlanType]}</p>
                  <p className="mt-4 truncate text-sm">{trip.origin} → {trip.destination}</p>
                  <div className="mt-5 flex justify-between border-t border-[#edf1e9] pt-4 text-xs">
                    <span className="text-[#718084]">{formatRouteDistance(trip.estimated_distance_meters)}{trip.admin_id === session?.user.id ? ' · You lead' : ''}</span>
                    <span className="font-semibold text-[#d66029]">Open plan ↗</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
      </section>
    </main>
  );
}
