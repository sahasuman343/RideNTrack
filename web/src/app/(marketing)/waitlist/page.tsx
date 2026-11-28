import type { Metadata } from 'next';
import WaitlistForm from '@/components/waitlist-form';
import { WAITLIST_OFFER } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Join the waitlist',
  description: `Join the rideNtrack waitlist. The first ${WAITLIST_OFFER.places} people get Pro free for ${WAITLIST_OFFER.months} months.`,
};

export default function WaitlistPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">Waitlist</p>
      <h1 className="display mt-4 text-5xl sm:text-6xl">Be first on the <em>road.</em></h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">The rideNtrack app for Android and iPhone is on its way. Join the waitlist and we’ll tell you when it’s ready. The first {WAITLIST_OFFER.places} people on the list get Pro free for {WAITLIST_OFFER.months} months.</p>
      <section aria-labelledby="waitlist-form-h" className="panel glow-panel mt-10 p-6 sm:p-8">
        <h2 id="waitlist-form-h" className="font-display text-2xl font-semibold">Join the waitlist</h2>
        <div className="mt-5"><WaitlistForm headingId="waitlist-form-h" /></div>
      </section>
    </main>
  );
}
