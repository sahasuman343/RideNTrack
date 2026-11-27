import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Get the app',
  description: 'Get rideNtrack for Android and iPhone to share your location with the group, send alerts and use SOS on the ride.',
};

const STORES = [
  { name: 'Google Play', device: 'Android', url: PLAY_STORE_URL },
  { name: 'App Store', device: 'iPhone', url: APP_STORE_URL },
];

const NEEDS = [
  { t: 'Location, always', d: 'So the group keeps seeing you while Google Maps or Apple Maps is on screen, or the phone is in your pocket.' },
  { t: 'Notifications', d: 'For fuel, regroup and SOS alerts from the pack.' },
  { t: 'Microphone, if you want it', d: 'Only for hold-to-talk voice notes.' },
];

export default function DownloadPage() {
  const live = STORES.filter(s => s.url);
  return (
    <main className="mx-auto max-w-4xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">Get the app</p>
      <h1 className="display mt-4 text-5xl sm:text-6xl">The ride happens on your <em>phone.</em></h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">Sharing your location with the pack, alerts, SOS, trip chat and voice notes run in the rideNtrack app for Android and iPhone. Use the same account you use on the web.</p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {STORES.map(s => (
          <div key={s.name} className="panel flex flex-col p-6">
            <p className="eyebrow-label">{s.device}</p>
            <h2 className="mt-2 font-display text-2xl font-semibold">{s.name}</h2>
            {s.url ? (
              <a href={s.url} className="btn btn-primary mt-6 self-start" rel="noopener">Get it on {s.name}</a>
            ) : (
              <p className="mt-3 text-sm text-muted">Not listed yet. The link will appear here when the app is published.</p>
            )}
          </div>
        ))}
      </div>
      {live.length === 0 && (
        <p className="notice mt-4">Until then you can <Link href="/register" className="text-accent underline underline-offset-4">create an account</Link> and plan trips on the web.</p>
      )}

      <section aria-labelledby="perm-h" className="mt-16">
        <h2 id="perm-h" className="font-display text-2xl font-semibold">What the app asks for, and why</h2>
        <dl className="mt-6 divide-y divide-line border-y border-line">
          {NEEDS.map(n => (
            <div key={n.t} className="grid gap-1 py-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
              <dt className="font-semibold">{n.t}</dt>
              <dd className="text-muted">{n.d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-muted">Location is used only during a ride you are on. <Link href="/privacy-and-location" className="text-accent underline underline-offset-4">How location is handled</Link>.</p>
      </section>
    </main>
  );
}
