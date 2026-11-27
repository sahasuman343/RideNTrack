import type { Metadata } from 'next';
import Link from 'next/link';
import { SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Help with rideNtrack: location sharing, joining trips, family links, your account and how to contact us.',
};

const FIXES: { t: string; steps: string[] }[] = [
  {
    t: 'The group can’t see me on the map',
    steps: [
      'Check that sharing is on in the ride screen. It stops on its own at the destination and after 12 hours.',
      'Allow location “Always” (iPhone) or “Allow all the time” (Android) for rideNtrack.',
      'On Android, let rideNtrack ignore battery optimisation when the app asks, so the system doesn’t pause it.',
      'If you have no signal, your position is saved and sent when you are back in coverage.',
    ],
  },
  {
    t: 'I can’t join a trip',
    steps: [
      'Ask the organiser for a fresh invite link or code. Invites can expire.',
      'Make sure you are signed in to the account the invite was sent to.',
      'Trips on the Free plan take up to 6 riders. The organiser can upgrade the trip for more.',
    ],
  },
  {
    t: 'A family link doesn’t open',
    steps: [
      'Links expire, and the organiser can switch them off. Ask for a new one.',
      'Open it in an up-to-date browser. No account is needed.',
    ],
  },
  {
    t: 'I’m not getting alerts',
    steps: [
      'Allow notifications for rideNtrack in your phone’s settings.',
      'Check that Do Not Disturb or focus modes aren’t silencing the app during the ride.',
    ],
  },
];

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">Support</p>
      <h1 className="display mt-4 text-5xl sm:text-6xl">Get back on the <em>road.</em></h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">Quick fixes for the common problems. The <Link href="/faq" className="text-accent underline underline-offset-4">FAQ</Link> answers general questions.</p>

      <p role="note" className="notice mt-8 max-w-2xl"><strong className="text-danger">In an emergency, call 112.</strong> Support can’t help in real time during a ride.</p>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {FIXES.map(f => (
          <section key={f.t} className="panel p-6">
            <h2 className="font-display text-xl font-semibold">{f.t}</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted marker:font-mono marker:text-accent">
              {f.steps.map(s => <li key={s}>{s}</li>)}
            </ol>
          </section>
        ))}
      </div>

      <section aria-labelledby="account-h" className="mt-16 grid gap-8 md:grid-cols-2">
        <div>
          <h2 id="account-h" className="font-display text-2xl font-semibold">Your account</h2>
          <ul className="mt-4 space-y-2 text-muted">
            <li>Edit your profile, bike and emergency details in Profile, in the app or <Link href="/app/profile" className="text-accent underline underline-offset-4">on the web</Link>.</li>
            <li>Delete your account from the bottom of your profile. It removes your data and the trips you organised, and can’t be undone.</li>
          </ul>
        </div>
        <div>
          <h2 className="font-display text-2xl font-semibold">Contact us</h2>
          {SUPPORT_EMAIL ? (
            <>
              <p className="mt-4 text-muted">Write to us and include your phone model, the app version and what happened. Don’t send your password.</p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary mt-5">{SUPPORT_EMAIL}</a>
            </>
          ) : (
            <p className="mt-4 text-muted">A support email address will be listed here soon. Until then, ask your trip’s organiser, or check the FAQ.</p>
          )}
        </div>
      </section>
    </main>
  );
}
