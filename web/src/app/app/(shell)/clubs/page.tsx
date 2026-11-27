'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { clubRoleLabel, type MyClub } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { useRequiredSession } from '@/lib/planner';
import { useFlags } from '@/lib/flags';
import { clubDate } from '@/lib/clubs';

export default function ClubsPage() {
  const session = useRequiredSession();
  const flags = useFlags(session?.user.id);
  const [clubs, setClubs] = useState<MyClub[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void supabase.rpc('get_my_clubs').then(({ data, error: e }) => {
      if (cancelled) return;
      if (e || !Array.isArray(data)) { setError(true); return; }
      setClubs(data as MyClub[]); setError(false);
    });
    return () => { cancelled = true; };
  }, [session, retry]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-12">
      <p className="eyebrow-label">Clubs</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-4xl sm:text-5xl">Your <em>clubs</em></h1>
        {flags.clubs && <Link href="/app/clubs/new" className="btn btn-primary">Start a club</Link>}
      </div>
      <p className="mt-3 max-w-xl text-sm text-muted">The crews you ride with regularly: a roster, the next rides and the rides you have done together.</p>

      {!flags.clubs ? (
        <p className="notice mt-8">Clubs are not available on your account yet.</p>
      ) : error ? (
        <div role="alert" className="notice notice-error mt-8">Could not load your clubs. Check your connection. <button className="underline" onClick={() => { setError(false); setRetry(v => v + 1); }}>Try again</button></div>
      ) : clubs === null ? (
        <div role="status" aria-label="Loading your clubs" className="mt-8 grid gap-3 sm:grid-cols-2">
          {[0, 1].map(i => <div key={i} className="h-32 animate-pulse rounded bg-surface" />)}
        </div>
      ) : clubs.length === 0 ? (
        <div className="panel mt-8 p-8 sm:p-10">
          <h2 className="display text-2xl">No clubs yet.</h2>
          <p className="mt-3 max-w-lg text-sm text-muted">Open a club link a friend sent you to join it, or start one for the people you ride with every weekend.</p>
          <Link href="/app/clubs/new" className="btn btn-primary mt-6">Start a club</Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {clubs.map(c => (
            <li key={c.id}>
              <Link href={`/app/clubs/${c.slug}`} className="panel block h-full p-5 transition-colors hover:border-line2">
                <p className="eyebrow-label">{[c.city, `${c.member_count} rider${c.member_count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
                <h2 className="mt-2 flex flex-wrap items-center gap-2 font-display text-xl font-semibold">{c.name}{c.verified && <span className="chip chip-live">Verified</span>}{c.role !== 'member' && <span className="chip chip-accent">{clubRoleLabel(c.role)}</span>}</h2>
                <p className="mt-3 text-sm text-muted">{c.next_ride ? <>Next: <span className="text-fg">{c.next_ride.name}</span> · {clubDate(c.next_ride.start_date)}</> : 'Nothing planned yet'}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
