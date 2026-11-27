import Link from 'next/link';
import RouteJourney, { type JourneyStop } from '@/components/route-journey';
import HeroScene from '@/components/hero-scene';

const STOPS: JourneyStop[] = [
  {
    id: 'plan', marker: '01', title: 'Plan it on the big screen', tags: ['Route', 'Days', 'Fuel plan', 'Sunset check'],
    body: <>
      <p>Pick a start, an end and the stops between: fuel, food, chai breaks, viewpoints, mechanics, meetup points and the night’s stay. rideNtrack works out the road route, the distance and the hours in the saddle, day by day.</p>
      <p>It checks the plan against the smallest tank in the group, so the fuel stops fit the bike with the shortest range, and warns you when a day is likely to finish after sunset.</p>
    </>,
  },
  {
    id: 'ride', marker: '02', title: 'Ride as one pack', tags: ['Live map', 'Lead and sweep', 'Gap alerts', 'Maps handoff'],
    body: <>
      <p>On the day, everyone sees the group on one map with the planned route and each rider’s trail. The leader and the sweep are marked, and the app flags it when the pack stretches out or someone leaves the route.</p>
      <p>Call a regroup, a fuel stop or a break with one tap. For turn by turn directions, rideNtrack hands each leg to Google Maps or Apple Maps and keeps tracking behind it.</p>
    </>,
  },
  {
    id: 'deadzone', marker: '03', title: 'Keep going through dead zones', tags: ['Offline queue', 'Last seen'],
    body: <>
      <p>Mountain passes lose signal. The phone keeps recording your position and sends it once the network is back, so the trail has no gaps.</p>
      <p>Riders out of coverage show as “last seen” with the time, instead of vanishing from the map.</p>
    </>,
  },
  {
    id: 'safety', marker: '04', title: 'Help is one long press away', tags: ['SOS', '112', 'Opt-in ICE details'],
    body: <>
      <p>Hold the SOS button to send your exact position to everyone on the ride. The app prepares a text to your emergency contact with a map link and can dial 112.</p>
      <p>Your blood group and emergency contact are shared only if you turn that on, and only with riders on the same ride.</p>
    </>,
  },
  {
    id: 'home', marker: '05', title: 'Let home follow along', tags: ['No account', 'Expires', 'Revocable'],
    body: <>
      <p>Send a family link and the people at home can watch the ride on a map in their browser, with no account and no app. They see where the group is and how recent each position is, not anyone’s phone number.</p>
      <p>Links expire on their own, and the organiser can switch one off at any time.</p>
    </>,
  },
  {
    id: 'after', marker: '06', title: 'Settle up and remember it', tags: ['Expenses', 'Journal', 'GPX'],
    body: <>
      <p>Log fuel, food and stays as you go, split equally or your own way. At the end, rideNtrack works out the fewest payments that square everyone up.</p>
      <p>Keep a ride journal, see your lifetime kilometres, and export the route and your recorded track as GPX.</p>
    </>,
  },
];

export default function Home() {
  return (
    <main>
      <section className="relative mx-auto grid max-w-6xl items-center gap-4 px-4 pb-6 pt-8 sm:px-8 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-0 lg:pt-10">
        <div className="relative z-10">
          <p className="eyebrow-label flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_10px_2px_rgba(111,211,160,.6)]" />Group motorcycle rides</p>
          <h1 className="display mt-4 text-5xl sm:text-7xl">Plan the road. Ride it <em>together.</em></h1>
          <p className="mt-6 max-w-xl text-lg text-muted">rideNtrack keeps a riding group on one route and one map, from the first planning chat to the last kilometre home.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="btn btn-primary px-5 py-3">Create a free account</Link>
            <Link href="/features" className="btn btn-ghost px-5 py-3">See what it does</Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Kinds of stop you can plan">
            {['Fuel', 'Chai', 'Viewpoint', 'Mechanic', 'Regroup', 'Stay'].map(t => <li key={t} className="chip">{t}</li>)}
          </ul>
        </div>
        <HeroScene />
      </section>

      <section aria-labelledby="journey-heading" className="mx-auto max-w-6xl px-4 pt-10 sm:px-8">
        <h2 id="journey-heading" className="eyebrow-label mb-10 md:text-center">One trip, start to finish</h2>
        <RouteJourney stops={STOPS} label="How a trip works in rideNtrack" />
      </section>

      <section aria-labelledby="where-heading" className="mx-auto mt-20 max-w-6xl px-4 sm:px-8">
        <h2 id="where-heading" className="font-display text-3xl font-semibold sm:text-4xl">Phone on the bike, laptop at home</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="panel lift p-6">
            <p className="eyebrow-label">The app</p>
            <h3 className="mt-2 font-display text-xl font-semibold">For the ride itself</h3>
            <p className="mt-3 text-muted">Live location sharing, alerts, SOS, trip chat and voice notes run in the rideNtrack app for Android and iPhone. A phone can keep sharing with the screen locked; a browser can’t.</p>
            <Link href="/download" className="mt-5 inline-block text-sm text-accent underline underline-offset-4">Get the app</Link>
          </div>
          <div className="panel lift p-6">
            <p className="eyebrow-label">The web</p>
            <h3 className="mt-2 font-display text-xl font-semibold">For planning and watching</h3>
            <p className="mt-3 text-muted">Sign in with the same account to plan routes on a big map, manage riders, track expenses and the journal, run a club, and watch a live ride.</p>
            <Link href="/login" className="mt-5 inline-block text-sm text-accent underline underline-offset-4">Sign in on the web</Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-heading" className="mx-auto mt-20 max-w-6xl px-4 sm:px-8">
        <div className="panel glow-panel flex flex-col items-start gap-6 p-8 sm:p-10 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="cta-heading" className="display text-3xl sm:text-4xl">Joining a ride is <em>free.</em></h2>
            <p className="mt-3 max-w-lg text-muted">So are the live map and every safety tool. Organisers planning bigger trips will be able to upgrade in the app.</p>
          </div>
          <Link href="/register" className="btn btn-primary shrink-0 px-5 py-3">Create a free account</Link>
        </div>
      </section>
    </main>
  );
}
