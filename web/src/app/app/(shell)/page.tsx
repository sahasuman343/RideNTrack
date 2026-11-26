'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { type Ride } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { APP_DOWNLOAD_URL } from '@/lib/links';

export default function RidesHome() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: { session }, error: authError } = await supabase.auth.getSession();
        if (authError) throw authError;
        if (!session) { router.replace('/login?next=/app'); return; }
        const result = await supabase.from('ride_participants').select('rides(*)').eq('user_id', session.user.id).eq('is_active', true).order('joined_at', { ascending: false });
        if (result.error) throw result.error;
        if (cancelled) return;
        setRides(result.data.map((p: { rides: unknown }) => p.rides).filter(Boolean) as Ride[]);
        setError(null);
      } catch {
        if (!cancelled) setError('Could not refresh your rides. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { if (!session) router.replace('/login'); });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [router, retry]);

  const live = rides.filter(r => r.status === 'active');

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <p className="eyebrow-label">Logbook</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-4xl sm:text-5xl">Your <em>rides</em></h1>
        <Link href="/app/trips/new" className="btn btn-primary">Plan a trip</Link>
      </div>
      <p className="mt-3 max-w-xl text-sm text-muted">Every ride and trip you are part of. Open one to see the pack on the map as they ride.</p>

      {error && (
        <div role="alert" className="notice notice-error mt-8 flex flex-wrap items-center gap-3">
          <span>{error}{rides.length > 0 && ' Showing your last loaded rides.'}</span>
          <button className="underline" onClick={() => { setError(null); setLoading(true); setRetry(v => v + 1); }}>Try again</button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-label="Loading your rides" className="mt-10 space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-14 animate-pulse rounded bg-surface" />)}
        </div>
      ) : rides.length === 0 && !error ? (
        <div className="panel mt-10 p-8 sm:p-10">
          <h2 className="display text-2xl">Your first ride is waiting.</h2>
          <p className="mt-3 max-w-lg text-sm text-muted">Plan a trip here, or create a ride and join with an invite code in the phone app. Starting a live ride and sharing your location happen in the app.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/app/trips/new" className="btn btn-primary">Plan a trip</Link>
            <a href={APP_DOWNLOAD_URL} className="btn btn-ghost">Get the app</a>
          </div>
        </div>
      ) : rides.length > 0 && (
        <>
          {live.length > 0 && <p className="mt-8 flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-live" aria-hidden />{live.length === 1 ? '1 ride is live now' : `${live.length} rides are live now`}</p>}
          <div className="panel mt-6 overflow-hidden">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Your rides</caption>
              <thead className="border-b border-line">
                <tr className="eyebrow-label">
                  <th scope="col" className="px-4 py-3 font-normal">Ride</th>
                  <th scope="col" className="hidden px-4 py-3 font-normal md:table-cell">Route</th>
                  <th scope="col" className="hidden px-4 py-3 font-normal sm:table-cell">Code</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rides.map(ride => (
                  <tr key={ride.id} className="relative border-b border-line last:border-0 hover:bg-raise">
                    <td className="px-4 py-3.5">
                      <Link href={'/app/rides/' + ride.id} className="font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent">{ride.name}</Link>
                      <span className="block truncate text-xs text-muted md:hidden">{ride.origin} → {ride.destination}</span>
                    </td>
                    <td className="hidden max-w-xs truncate px-4 py-3.5 text-muted md:table-cell">{ride.origin} → {ride.destination}</td>
                    <td className="hidden px-4 py-3.5 font-mono text-xs tracking-widest text-muted sm:table-cell">{ride.ride_code}</td>
                    <td className="px-4 py-3.5 text-right"><span className={'chip ' + (ride.status === 'active' ? 'chip-live' : ride.status === 'planned' ? 'chip-accent' : '')}>{ride.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
