import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Get the app' };

export default function DownloadPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-8 sm:pt-20">
      <p className="eyebrow-label">Get the app</p>
      <h1 className="display mt-4 text-5xl sm:text-6xl">The ride happens on your <em>phone.</em></h1>
      <p className="mt-6 text-lg text-muted">Starting a live ride, sharing your location with the pack, alerts and payments all run in the rideNtrack app for Android and iPhone.</p>
      <div className="panel mt-10 p-6">
        <h2 className="font-display text-xl font-semibold">Store links are not live yet</h2>
        <p className="mt-2 text-sm text-muted">They will be listed here as soon as the app is published. Until then you can create an account and plan trips on the web.</p>
        <Link href="/register" className="btn btn-primary mt-5">Create an account</Link>
      </div>
    </main>
  );
}
