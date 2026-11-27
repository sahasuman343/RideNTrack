import type { Metadata } from 'next';
import Link from 'next/link';
import LegalHeader, { ContactLine, Operator } from '@/components/legal-header';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The terms for using the rideNtrack app and website.',
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 sm:px-8 sm:pt-20">
      <article className="prose-page">
        <LegalHeader eyebrow="Legal" title="Terms of use" />

        <p>These terms apply when you use the rideNtrack app or the website at ridentrack.app, which are run by <Operator />. By creating an account you agree to them. Our <Link href="/privacy">privacy policy</Link> explains how we handle your data.</p>

        <h2>Ride safely: rideNtrack is a companion, not a guarantee</h2>
        <ul>
          <li><strong>Never use your phone while riding.</strong> Set things up before you set off, mount the phone securely, and stop somewhere safe to use it.</li>
          <li>Routes, distances, riding times, fuel ranges, sunset warnings and weather are estimates. Roads, fuel stations and conditions change. Use your own judgement and follow local law and road signs.</li>
          <li>Live positions depend on GPS, mobile signal, battery and your phone’s settings. Positions can be late or missing, and alerts can be delayed or not arrive.</li>
          <li><strong>SOS does not contact emergency services by itself.</strong> It alerts riders on the same ride and helps you call 112 or text your emergency contact. In an emergency, call 112 directly if you can.</li>
          <li>Each rider is responsible for their own riding, licence, insurance, motorcycle and safety gear. Organisers are not responsible for other riders because they use rideNtrack.</li>
        </ul>

        <h2>Your account</h2>
        <ul>
          <li>You must be 18 or over and give accurate details.</li>
          <li>Keep your password private. You are responsible for what happens on your account.</li>
          <li>You can delete your account at any time from your profile.</li>
        </ul>

        <h2>What you share</h2>
        <ul>
          <li>You keep ownership of what you add, such as trips, messages, photos and journal entries. You let us store and show it to the people you share it with, so the service works.</li>
          <li>Only share a family link with people you trust to see the ride’s live positions, and only invite riders who agree to be tracked on that ride.</li>
          <li>Don’t post anything illegal, abusive or that you have no right to share, and don’t share another person’s phone number or details without their permission.</li>
        </ul>

        <h2>Fair use</h2>
        <p>Don’t try to access other riders’ data, break or overload the service, or use it to follow or watch someone who hasn’t agreed. We may suspend accounts that do.</p>

        <h2>Free and Pro</h2>
        <ul>
          <li>Joining rides and the safety features are free. Some planning features and higher limits need Pro, bought by the trip’s organiser.</li>
          <li>Purchases, when they open, are made through Google Play or the App Store and follow their billing and refund rules. Prices are shown in the app before you buy.</li>
          <li>Club ride registration fees, where a club charges them, are paid to the club. The club is responsible for the ride it organises.</li>
        </ul>

        <h2>Changes and availability</h2>
        <p>We are improving rideNtrack all the time, so features may change. We try to keep it running but can’t promise it will always be available or error free. If we change these terms in a way that matters, we will tell you in the app before the change takes effect.</p>

        <h2>Liability</h2>
        <p>rideNtrack is provided as it is. To the extent the law allows, <Operator /> is not liable for loss or injury arising from riding, from relying on estimates, positions or alerts in the app, or from the service being unavailable. Nothing in these terms limits rights you have under law that cannot be excluded.</p>

        <h2>Contact</h2>
        <p>Questions about these terms: <ContactLine />.</p>
      </article>
    </main>
  );
}
