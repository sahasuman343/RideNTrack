import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import './club.css';

type PublicClub = {
  slug: string;
  name: string;
  city: string | null;
  description: string | null;
  verified: boolean;
  join_policy: 'open' | 'code';
  since: string;
  member_count: number;
  completed_rides: number;
  total_km: number;
  upcoming: Array<{ name: string; start_date: string | null; origin: string; destination: string; distance_km: number }>;
};

async function loadClub(slug: string): Promise<PublicClub | null> {
  const { data, error } = await supabase.rpc('get_public_club', { p_slug: slug });
  if (error || !data) return null;
  return data as PublicClub;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const club = await loadClub((await params).slug);
  if (!club) return { title: 'Club not found · RideNTrack' };
  return {
    title: `${club.name} · RideNTrack`,
    description: club.description ?? `${club.name}${club.city ? ` rides out of ${club.city}` : ''}. ${club.member_count} riders on RideNTrack.`,
  };
}

function rideDate(iso: string | null) {
  if (!iso) return { day: '—', month: 'TBD' };
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return {
    day: d.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'UTC' }),
    month: d.toLocaleDateString('en-IN', { month: 'short', weekday: 'short', timeZone: 'UTC' }),
  };
}

const nf = new Intl.NumberFormat('en-IN');

export default async function ClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await loadClub(slug);
  if (!club) notFound();
  const since = new Date(club.since).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const join = `/register?src=club&club=${encodeURIComponent(club.slug)}`;

  return (
    <main className="club-page">
      <header className="club-top">
        <Link href="/" className="club-wordmark">RideNTrack</Link>
      </header>

      <section className="club-hero">
        <p className="club-eyebrow">{[club.city, `Riding since ${since}`].filter(Boolean).join(' · ')}</p>
        <h1>
          {club.name}
          {club.verified && <span className="club-verified" title="Verified by RideNTrack">Verified</span>}
        </h1>
        {club.description && <p className="club-about">{club.description}</p>}
        <dl className="club-stats">
          <div><dt>Riders</dt><dd>{nf.format(club.member_count)}</dd></div>
          <div><dt>Rides together</dt><dd>{nf.format(club.completed_rides)}</dd></div>
          <div><dt>Kilometres</dt><dd>{nf.format(club.total_km)}</dd></div>
        </dl>
      </section>

      <section className="club-section">
        <h2>Coming up</h2>
        {club.upcoming.length === 0 ? (
          <p className="club-muted">No open rides are listed right now. Members see every club ride in the app.</p>
        ) : (
          <ol className="club-rides">
            {club.upcoming.map((r, i) => {
              const d = rideDate(r.start_date);
              return (
                <li key={`${r.name}-${i}`}>
                  <span className="club-date"><b>{d.day}</b><small>{d.month}</small></span>
                  <span className="club-ride">
                    <strong>{r.name}</strong>
                    <small>{r.origin} → {r.destination}{r.distance_km ? ` · ${nf.format(r.distance_km)} km` : ''}</small>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="club-join">
        <div>
          <h2>Ride with {club.name}</h2>
          <p>
            {club.join_policy === 'code'
              ? 'Members join with a code from a club admin. Get the app, open this page on your phone, and enter the code.'
              : 'Get RideNTrack, open this page on your phone, and tap Join.'}
          </p>
        </div>
        <Link className="club-cta" href={join}>Create your account</Link>
      </section>

      <footer className="club-foot">
        Live group tracking, SOS that works with no signal, and texts home for family.
      </footer>
    </main>
  );
}
