import type { Metadata } from 'next';
import Link from 'next/link';
import { TIER_LIMITS } from '@ridentrack/shared';

export const metadata: Metadata = {
  title: 'Location and privacy',
  description: 'When rideNtrack shares your location, who can see it, how long it is kept, and how to delete it.',
};

const QA: { q: string; a: React.ReactNode }[] = [
  {
    q: 'When is my location shared?',
    a: <>
      <p>Only during a ride you have joined, after you start sharing on the ride screen. It is not collected between rides.</p>
      <p>Sharing stops when you pause it, sign out, or the ride is marked complete, and on its own after 12 hours. When you reach the final stop, the app stops on its own so it doesn’t keep sending your position on the way into your home street.</p>
    </>,
  },
  {
    q: 'Who can see it?',
    a: <>
      <p>The riders on the same ride. The database checks that you are on the ride before it returns anyone’s position, so other rideNtrack users and the public can’t see it.</p>
      <p>If the organiser sends a family link, people with that link can see the ride’s route and riders’ positions too. They don’t see phone numbers or emergency details.</p>
    </>,
  },
  {
    q: 'How do family links work?',
    a: <>
      <p>An organiser creates a link for a ride and sends it to whoever they choose. It opens in a browser with no account.</p>
      <p>Every link has an end time and stops working after it. The organiser can also switch a link off at any time, and it stops working straight away.</p>
    </>,
  },
  {
    q: 'What happens with no signal?',
    a: <>
      <p>The phone keeps recording your position and stores it on the device, tied to your account. It is sent when the network returns, then removed from the phone’s queue.</p>
      <p>While you are out of coverage, other riders see your last known position and how long ago it was.</p>
    </>,
  },
  {
    q: 'How long is location history kept?',
    a: <>
      <p>The trail recorded on a ride is kept so the group can look back at it. On trips hosted on the Free plan it is deleted after {TIER_LIMITS.free.locationRetentionDays} days. On Pro trips it is kept until the trip or your account is deleted.</p>
    </>,
  },
  {
    q: 'What about my phone number and emergency details?',
    a: <>
      <p>Both are optional. Your emergency contact and blood group are shown only to riders on the same ride, and only if you turn that on in your profile. Sharing your own phone number with the ride is a separate switch.</p>
      <p>If you press SOS, your position goes to everyone on the ride. The text to your emergency contact is prepared on your phone and you send it yourself.</p>
    </>,
  },
  {
    q: 'Does the website track my location?',
    a: <>
      <p>The web app can share your location during a ride only while the page is open and you allow it in the browser. Browsers stop sharing when the screen locks, which is why live sharing is built for the phone app.</p>
      <p>Planning a trip, watching a ride or reading these pages doesn’t use your location.</p>
    </>,
  },
  {
    q: 'What usage data do you collect?',
    a: <>
      <p>The app records simple events such as “ride started” to see which features work. These events never contain your location, contact details, names or anything you type. The database refuses any that do.</p>
    </>,
  },
  {
    q: 'How do I delete my data?',
    a: <>
      <p>Open your profile in the app or on the web and choose Delete account. Your profile, location history and the rest of your data are removed. Trips you organised are deleted along with it, for everyone on them, so hand over leadership first if the group still needs a trip.</p>
    </>,
  },
];

export default function PrivacyLocationPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">Location and privacy</p>
      <h1 className="display mt-4 max-w-3xl text-5xl sm:text-6xl">Your position, on <em>your</em> terms.</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">rideNtrack only works if riders trust it with where they are. This page explains, in plain words, what happens to your location. The <Link href="/privacy" className="text-accent underline underline-offset-4">privacy policy</Link> has the full detail.</p>

      <ul className="mt-12 grid gap-4 sm:grid-cols-3" aria-label="In short">
        <li className="panel p-5"><p className="font-mono text-xs text-accent">ONLY ON A RIDE</p><p className="mt-2">Shared while you ride, never in between.</p></li>
        <li className="panel p-5"><p className="font-mono text-xs text-accent">ONLY YOUR GROUP</p><p className="mt-2">Riders on the same ride, and family links the organiser sends.</p></li>
        <li className="panel p-5"><p className="font-mono text-xs text-accent">YOURS TO DELETE</p><p className="mt-2">Delete your account and your history goes with it.</p></li>
      </ul>

      <div className="mt-16 divide-y divide-line border-y border-line">
        {QA.map(item => (
          <section key={item.q} className="grid gap-3 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-10">
            <h2 className="font-display text-2xl font-semibold">{item.q}</h2>
            <div className="space-y-3 text-muted">{item.a}</div>
          </section>
        ))}
      </div>
    </main>
  );
}
