import type { Metadata } from 'next';
import Link from 'next/link';
import { TIER_LIMITS } from '@ridentrack/shared';
import { LOCATION_PURGE_SCHEDULED } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Trip planning, a live group map, pack alerts, SOS, family links, shared expenses and GPX for motorcycle groups.',
};

type Group = { id: string; title: string; intro: string; items: { name: string; text: string; pro?: boolean; app?: boolean }[] };

const GROUPS: Group[] = [
  {
    id: 'planning', title: 'Planning', intro: 'Build the trip once and every rider gets the same plan.',
    items: [
      { name: 'Route and stops', text: 'Search for places, add stops by kind (fuel, food, chai, viewpoint, mechanic, meetup, stay) and reorder them. The road route, distance and riding time update as you edit.' },
      { name: 'Multi-day trips', text: 'Split a tour into dated days with an overnight stay for each.', pro: true },
      { name: 'Fuel plan for the pack', text: 'Uses each rider’s tank size, mileage and reserve to find the group’s shortest range and suggest where to fill up.', pro: true },
      { name: 'Daylight and weather', text: 'Warns when a day is likely to end after sunset, with extra time allowed for ghats and mountain roads, and shows the current weather at the start and the end.', pro: true },
      { name: 'GPX import', text: 'Start a trip from a GPX file of a route you already have.', pro: true },
      { name: 'Gear checklist', text: 'A pre-ride checklist each rider ticks off, and shared kit like the puncture kit or tow strap that someone claims.' },
      { name: 'Copy a trip', text: 'Reuse a past trip with new dates, or copy a route another group has made public.' },
    ],
  },
  {
    id: 'riding', title: 'On the ride', intro: 'Everything here runs in the phone app, because it needs the phone’s location.',
    items: [
      { name: 'Live group map', text: 'The planned route, each rider’s trail and live position, speed, distance covered and distance to the next stop.', app: true },
      { name: 'Pack roles and gaps', text: 'Captain, co-captain, marshal, sweeper and member. The app shows the order along the route and alerts when a rider falls too far behind (1 km unless the leader changes it) or leaves the route.', app: true },
      { name: 'One-tap alerts', text: 'Fuel stop, break, hazard, regroup, breakdown and captain announcements, with sound and vibration, and a record of who saw them.', app: true },
      { name: 'Regroup points', text: 'Set a place to wait for each other and see who has arrived.', app: true },
      { name: 'Trip chat and voice notes', text: 'Pinned details like the hotel address, quick replies such as “Fuel needed”, and hold-to-talk voice notes.', app: true },
      { name: 'Hand off to your maps app', text: 'Open the next leg in Google Maps or Apple Maps for turn by turn directions while rideNtrack keeps tracking in the background.', app: true },
      { name: 'Dead-zone recording', text: 'Positions are stored on the phone without signal and sent when it returns. Riders out of coverage show as “last seen”.', app: true },
    ],
  },
  {
    id: 'safety', title: 'Safety', intro: 'Joining a ride and every safety tool stay free.',
    items: [
      { name: 'SOS', text: 'Hold to confirm. Sends your exact position to everyone on the ride, prepares a text with a map link to your emergency contact, and can dial 112.', app: true },
      { name: 'Emergency details, opt in', text: 'Choose whether your blood group and emergency contact are shown to riders on the same ride. Nobody else sees them.' },
      { name: 'Unexpected stop check-in', text: 'If you stop for a long time away from the planned stops, the app asks if you are fine before telling the leader and sweep.', app: true },
      { name: 'Family links', text: 'A browser link for the people at home to watch the ride live, with no account. Links expire, and the organiser can switch them off.' },
    ],
  },
  {
    id: 'after', title: 'After the ride', intro: 'The trip doesn’t end at the last fuel stop.',
    items: [
      { name: 'Shared expenses', text: 'Log fuel, food and stays with equal or custom splits. rideNtrack works out the fewest payments to settle up.', pro: true },
      { name: 'Ride journal', text: 'Notes, odometer readings and photos for each day, and a recap card to share.', pro: true },
      { name: 'Your riding stats', text: 'Lifetime distance, trips and time in the saddle on your profile.' },
      { name: 'GPX export', text: 'Take the planned route and your recorded track to a GPS unit or another app.', pro: true },
    ],
  },
  {
    id: 'clubs', title: 'Clubs', intro: 'For groups that ride together often.',
    items: [
      { name: 'Club page', text: 'A public page with the club’s next rides, and a join code or open joining.' },
      { name: 'Regular rides', text: 'Set up a weekly, fortnightly or monthly ride and plan each one from the club in one step.' },
      { name: 'Roles', text: 'Owners and admins manage the roster and invite new riders.' },
    ],
  },
];

const free = TIER_LIMITS.free, pro = TIER_LIMITS.pro_tourer;

export default function FeaturesPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">Features</p>
      <h1 className="display mt-4 max-w-3xl text-5xl sm:text-6xl">Built for the group, not just the <em>rider.</em></h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">Navigation apps get one person from A to B. rideNtrack keeps a whole pack on the same plan, on the same map, and in touch, then helps sort out the money afterwards.</p>

      <nav aria-label="Feature groups" className="mt-10 flex flex-wrap gap-2">
        {GROUPS.map(g => <a key={g.id} href={'#' + g.id} className="chip px-3 py-2 text-[11px] hover:text-fg">{g.title}</a>)}
        <a href="#plans" className="chip px-3 py-2 text-[11px] hover:text-fg">Free and Pro</a>
      </nav>

      {GROUPS.map(g => (
        <section key={g.id} id={g.id} aria-labelledby={g.id + '-h'} className="mt-16 scroll-mt-6">
          <div className="grid gap-2 border-b border-line pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-8">
            <h2 id={g.id + '-h'} className="font-display text-3xl font-semibold">{g.title}</h2>
            <p className="text-muted md:pt-2">{g.intro}</p>
          </div>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {g.items.map(item => (
              <div key={item.name} className="border-b border-line py-5">
                <dt className="flex flex-wrap items-center gap-2 font-semibold">
                  {item.name}
                  {item.pro && <span className="chip chip-accent">Pro</span>}
                  {item.app && <span className="chip">App</span>}
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-muted">{item.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section id="plans" aria-labelledby="plans-h" className="mt-20 scroll-mt-6">
        <h2 id="plans-h" className="font-display text-3xl font-semibold">Free and Pro</h2>
        <p className="mt-3 max-w-2xl text-muted">Pro is bought by the organiser and unlocks the trip for everyone on it. Riders never need Pro to join. In-app purchases are not open yet; prices will show in the app when they are.</p>
        <div className="mt-8">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Limits for trips hosted on the Free and Pro plans</caption>
            <thead>
              <tr className="border-b border-line2 text-muted">
                <th scope="col" className="py-3 pr-4 font-normal">For each trip you host</th>
                <th scope="col" className="py-3 pr-4 font-semibold text-fg">Free</th>
                <th scope="col" className="py-3 font-semibold text-accent">Pro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Row label="Days" a={String(free.maxTripDays)} b={pro.maxTripDays == null ? 'No limit' : String(pro.maxTripDays)} />
              <Row label="Route points, counting start and end" a={String(free.maxWaypointsPerTrip)} b={String(pro.maxWaypointsPerTrip)} />
              <Row label="Riders" a={String(free.maxParticipantsPerRide)} b={String(pro.maxParticipantsPerRide)} />
              <Row label="Trips going at once" a={String(free.maxActiveTrips)} b={String(pro.maxActiveTrips)} />
              {LOCATION_PURGE_SCHEDULED && <Row label="Location history kept" a={`${free.locationRetentionDays} days`} b={pro.locationRetentionDays == null ? 'Kept' : `${pro.locationRetentionDays} days`} />}
              <Row label="Fuel, daylight and weather planning" a="No" b="Yes" />
              <Row label="Expenses and journal" a="No" b="Yes" />
              <Row label="GPX import and export" a="No" b="Yes" />
              <Row label="Joining rides, live map, chat, SOS" a="Yes" b="Yes" />
            </tbody>
          </table>
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/register" className="btn btn-primary px-5 py-3">Create a free account</Link>
          <Link href="/privacy-and-location" className="btn btn-ghost px-5 py-3">How location is handled</Link>
        </div>
      </section>
    </main>
  );
}

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr>
      <th scope="row" className="py-3 pr-4 font-normal text-muted">{label}</th>
      <td className="whitespace-nowrap py-3 pr-4 font-mono">{a}</td>
      <td className="whitespace-nowrap py-3 font-mono">{b}</td>
    </tr>
  );
}
