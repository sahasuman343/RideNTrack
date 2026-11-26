import Link from 'next/link';

// Interim home page for the foundation step. The full marketing site, with the
// route line that draws as you scroll, is Phase 4.
const LOG = [
  { n: '01', title: 'Plan on the big screen', body: 'Pick a start, an end and the stops between. rideNtrack works out the road route, the distance and the time in the saddle, and the trip shows up in the app on every rider’s phone.' },
  { n: '02', title: 'Ride as one pack', body: 'During a live ride everyone sees the group on one map. Call a regroup, a fuel stop or a break, and send quick messages without stopping to type.' },
  { n: '03', title: 'Let home follow along', body: 'Share a family link and the people at home can see where you are and how fresh the position is, with no account needed.' },
];

export default function Home() {
  return (
    <main>
      <section className="relative mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-8 sm:pt-20">
        <p className="eyebrow-label">Group motorcycle rides</p>
        <h1 className="display mt-4 max-w-4xl text-5xl sm:text-7xl lg:text-8xl">Plan the road. Ride it <em>together.</em></h1>
        <p className="mt-6 max-w-xl text-lg text-muted">rideNtrack keeps a riding group on one route and one map, from the first planning chat to the last kilometre home.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className="btn btn-primary px-5 py-3">Create a free account</Link>
          <Link href="/login" className="btn btn-ghost px-5 py-3">Sign in to plan a trip</Link>
        </div>
        <svg aria-hidden viewBox="0 0 1200 220" className="mt-16 w-full" preserveAspectRatio="none">
          <path d="M0 170 C 160 170, 220 60, 380 80 S 600 190, 760 130 S 980 30, 1200 60" fill="none" stroke="#232327" strokeWidth="10" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d="M0 170 C 160 170, 220 60, 380 80 S 600 190, 760 130 S 980 30, 1200 60" fill="none" stroke="#ff8a2a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="380" cy="80" r="7" fill="#edebe6" stroke="#060607" strokeWidth="3" />
          <circle cx="760" cy="130" r="7" fill="#ff8a2a" stroke="#060607" strokeWidth="3" />
        </svg>
      </section>

      <section aria-labelledby="log-heading" className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 id="log-heading" className="eyebrow-label">What it does</h2>
        <ol className="mt-6 divide-y divide-line border-y border-line">
          {LOG.map(item => (
            <li key={item.n} className="grid gap-3 py-8 sm:grid-cols-[80px_minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-8">
              <span className="font-mono text-sm text-accent">{item.n}</span>
              <h3 className="font-display text-2xl font-semibold">{item.title}</h3>
              <p className="text-muted">{item.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-2xl text-sm text-muted">Live location sharing runs in the phone app, because browsers stop sharing location when the screen locks. On the web you can plan trips and watch a ride live.</p>
      </section>
    </main>
  );
}
