import { Suspense } from 'react';
import RideView from './ride-view';
export default function RidePage() {
  return <Suspense fallback={<div className="ride-loading">Connecting to your ride…</div>}><RideView /></Suspense>;
}
