import type { Metadata } from 'next';
import Link from 'next/link';
import { TIER_LIMITS } from '@ridentrack/shared';
import { LOCATION_PURGE_SCHEDULED } from '@/lib/site';
import LegalHeader, { ContactLine, Operator } from '@/components/legal-header';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What personal data rideNtrack collects, why, who it is shared with, how long it is kept and how to delete it.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 sm:px-8 sm:pt-20">
      <article className="prose-page">
        <LegalHeader eyebrow="Legal" title="Privacy policy" />

        <p>This policy covers the rideNtrack app for Android and iPhone and the website at ridentrack.app, run by <Operator />. For a short, plain-language version about location, see <Link href="/privacy-and-location">location and privacy</Link>.</p>

        <h2>What we collect</h2>
        <h3>Your account</h3>
        <ul>
          <li>Your email address and password (stored as a secure hash by our sign-in provider).</li>
          <li>The name other riders see, and optionally a profile photo link.</li>
          <li>Optionally: your phone number, emergency contact number, blood group, and your motorcycle’s make, model, tank size, mileage and reserve.</li>
        </ul>
        <h3>Trips and rides</h3>
        <ul>
          <li>Trips you plan or join: routes, stops, dates, stays, checklists and who is on them.</li>
          <li>What you add to a trip: chat messages, voice notes, alerts, expenses, journal entries and photos, and saved places.</li>
        </ul>
        <h3>Location</h3>
        <ul>
          <li>Your position, speed and time, only during a ride you have joined and only while you are sharing. Sharing stops when you pause it, sign out, the ride ends, you reach the destination, or after 12 hours.</li>
          <li>Without signal, positions are stored on your phone and sent when the network returns.</li>
        </ul>
        <h3>Device and usage</h3>
        <ul>
          <li>A push notification token, so we can send ride alerts to your phone.</li>
          <li>Simple usage events, such as a ride being started, with the app version and platform. These never include your location, contact details, names or text you type.</li>
        </ul>

        <h2>Why we use it</h2>
        <ul>
          <li>To run the service you asked for: planning trips, showing the group on a map, sending alerts and messages, splitting expenses and keeping your history.</li>
          <li>For safety features you choose to use, such as SOS and sharing emergency details with your ride.</li>
          <li>To keep the service working and secure, and to understand which features are used so we can improve them.</li>
        </ul>
        <p>We do not sell your personal data, and we do not use your location for advertising.</p>

        <h2>Who can see it</h2>
        <ul>
          <li><strong>Riders on the same trip</strong> see your display name, your role, and during a ride your position and trail. They see your phone number, emergency contact and blood group only if you turn those on.</li>
          <li><strong>People with a family link</strong> the organiser sends can see that ride’s route and riders’ positions, but not contact details. Links expire and can be switched off.</li>
          <li><strong>Club members</strong> see the club roster and its rides. A club’s public page shows its name, city, description and upcoming rides.</li>
          <li><strong>Public trips.</strong> If an organiser publishes a trip as a community route, its route and stops can be seen and copied by others, without riders’ details.</li>
        </ul>

        <h2>Service providers</h2>
        <p>We use these companies to run rideNtrack. They process data on our behalf and only for that purpose.</p>
        <ul>
          <li><strong>Supabase</strong>: database, sign-in and file storage.</li>
          <li><strong>Mapbox</strong>: maps, place search and road routes. It receives the places you search for and the map area you view.</li>
          <li><strong>Open-Meteo</strong>: current weather. It receives the coordinates of the trip’s start or end, not who you are.</li>
          <li><strong>Expo</strong>: delivers push notifications to your phone.</li>
          <li><strong>Vercel</strong>: hosts this website.</li>
        </ul>
        <p>Some features are not switched on yet. When they are, they will use: Google Play and the App Store, through RevenueCat, for in-app purchases; Razorpay for paying club ride registration fees; an SMS provider for texts sent by the server; and an analytics provider that receives the same usage events described above. We will update this policy when any of them goes live.</p>

        <h2>How long we keep it</h2>
        <ul>
          {LOCATION_PURGE_SCHEDULED
            ? <li>Location history from trips on the Free plan is deleted after {TIER_LIMITS.free.locationRetentionDays} days. On Pro trips it is kept until the trip or your account is deleted.</li>
            : <li>Location history is kept until the trip or your account is deleted.</li>}
          <li>Everything else is kept while your account exists, or until the trip it belongs to is deleted.</li>
          <li>When you delete your account, your data is deleted, including trips you organised. Backups are overwritten on their normal cycle.</li>
        </ul>

        <h2>Your choices and rights</h2>
        <ul>
          <li>See and edit your profile at any time in the app or on the web.</li>
          <li>Turn emergency detail and phone sharing on or off in your profile.</li>
          <li>Pause location sharing during a ride, or turn off location permission in your phone’s settings.</li>
          <li>Delete your account from your profile. This cannot be undone.</li>
          <li>Ask us for a copy of your data, or to correct it, by writing to <ContactLine />.</li>
        </ul>

        <h2>Security</h2>
        <p>Data is sent over encrypted connections. Access is checked by the database itself, so the app and website can only read what your account is allowed to see. No system is perfectly secure, and we will tell affected riders if a breach puts their data at risk.</p>

        <h2>Children</h2>
        <p>rideNtrack is meant for adult riders and is not intended for children under 18.</p>

        <h2>Changes</h2>
        <p>If we change this policy in a way that matters, we will say so in the app before the change takes effect.</p>

        <h2>Contact</h2>
        <p>Questions about privacy: <ContactLine />.</p>
      </article>
    </main>
  );
}
