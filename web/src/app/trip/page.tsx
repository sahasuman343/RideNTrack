import { Suspense } from 'react';
import TripView from './trip-view';

export default function TripPage() {
  return <Suspense fallback={<p className="p-10 text-[#718084]">Loading trip…</p>}><TripView /></Suspense>;
}
