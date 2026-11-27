import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Answers about joining rides, battery use, signal, family links, the web app, Free and Pro, and deleting your account.',
};

const FAQ: { group: string; items: { q: string; a: React.ReactNode }[] }[] = [
  {
    group: 'Getting started',
    items: [
      { q: 'Does everyone in the group need the app?', a: <p>Every rider who wants to show up on the live map needs the app on their phone. Family and friends at home don’t: a family link opens in any browser.</p> },
      { q: 'How do riders join a trip?', a: <p>The organiser shares an invite link or a join code from the trip. Riders open it, sign in or create an account, and they are on the trip.</p> },
      { q: 'Does it cost anything to join a ride?', a: <p>No. Joining any ride, the live map, trip chat and every safety tool are free. Pro is for organisers who want longer trips, bigger groups and the planning extras, and it covers everyone on that trip.</p> },
      { q: 'Can I plan on my computer?', a: <p>Yes. <Link href="/login">Sign in on the web</Link> with the same account to plan routes, manage riders, track expenses and watch a ride live. The trip shows up in the app straight away.</p> },
    ],
  },
  {
    group: 'On the ride',
    items: [
      { q: 'Does it give turn by turn directions?', a: <p>No. rideNtrack hands each leg of the route to Google Maps or Apple Maps for directions and keeps tracking the group in the background.</p> },
      { q: 'What happens in a dead zone?', a: <p>Your phone keeps recording where you are and sends it when signal returns. The rest of the group sees your last known position and how old it is.</p> },
      { q: 'Will it drain my battery?', a: <p>Live tracking uses GPS, which always costs battery. rideNtrack checks less often when you are parked and stops on its own at the destination or after 12 hours. On a long day, keep the phone on a charger. On Android, the app asks you to allow it to run in the background so the system doesn’t stop it.</p> },
      { q: 'Can I keep sharing from the website?', a: <p>Only while the page stays open and the screen stays on. Browsers stop sharing location when the phone locks, so use the app on the bike.</p> },
    ],
  },
  {
    group: 'Safety and privacy',
    items: [
      { q: 'What does SOS do?', a: <p>After you hold the button to confirm, everyone on the ride gets an alert with your exact position. The app also prepares a text with a map link to your emergency contact and offers to call 112.</p> },
      { q: 'Who can see my location?', a: <p>Riders on the same ride, and people with a family link the organiser sent. Read <Link href="/privacy-and-location">location and privacy</Link> for the details.</p> },
      { q: 'Can I stop a family link?', a: <p>Yes. The organiser can switch a link off at any time, and every link also expires by itself.</p> },
      { q: 'How do I delete my account?', a: <p>Go to your profile in the app or on the web and choose Delete account. Your data is removed, including trips you organised.</p> },
    ],
  },
  {
    group: 'Free and Pro',
    items: [
      { q: 'What does Pro add?', a: <p>Longer trips, more stops and riders, fuel, daylight and weather planning, expenses and the journal, and GPX import and export. <Link href="/features#plans">Compare Free and Pro</Link>.</p> },
      { q: 'How much is Pro?', a: <p>In-app purchases are not open yet. Prices will be shown in the app, in your local currency, when they are.</p> },
    ],
  },
];

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">FAQ</p>
      <h1 className="display mt-4 text-5xl sm:text-6xl">Questions riders <em>ask.</em></h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">Can’t find yours? <Link href="/support" className="text-accent underline underline-offset-4">Get support</Link>.</p>
      {FAQ.map(g => (
        <section key={g.group} aria-labelledby={'faq-' + g.group.toLowerCase().replaceAll(' ', '-')} className="mt-14">
          <h2 id={'faq-' + g.group.toLowerCase().replaceAll(' ', '-')} className="eyebrow-label">{g.group}</h2>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {g.items.map(item => (
              <details key={item.q} className="faq-item group">
                <summary className="flex items-start justify-between gap-6 py-5 font-display text-xl font-semibold hover:text-accent">
                  {item.q}
                  <span aria-hidden className="faq-sign mt-1 font-mono text-lg text-accent">+</span>
                </summary>
                <div className="pb-6 pr-10 text-muted [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4">{item.a}</div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
