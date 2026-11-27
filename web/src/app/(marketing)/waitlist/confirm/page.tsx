import type { Metadata } from 'next';
import ConfirmWaitlist from './confirm-view';

export const metadata: Metadata = {
  title: 'Confirm your waitlist place',
  robots: { index: false, follow: false },
};

export default function ConfirmWaitlistPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">Waitlist</p>
      <h1 className="display mt-4 text-5xl sm:text-6xl">Confirm your <em>place.</em></h1>
      <section className="panel glow-panel mt-10 p-6 sm:p-8">
        <ConfirmWaitlist />
      </section>
    </main>
  );
}
