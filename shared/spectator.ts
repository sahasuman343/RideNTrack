/*
 * F2 spectator page wording. The family's whole experience of the product is
 * this page, so it explains itself: who you are following, whether that is
 * live or old, what "no signal" means, and what comes next.
 */
import { riderPresence, type RiderPresenceLabel } from './status';

export interface SpectatorRider { user_id: string; display_name: string; lat: number; lng: number; speed?: number | null; timestamp: string }
export interface SpectatorStop { name: string; latitude: number; longitude: number; sequence?: number; waypoint_type?: string; planned_arrival?: string | null }
export interface SpectatorStay { name: string; latitude: number; longitude: number; check_in?: string | null }

export interface SpectatorView {
  followName: string;
  title: string;
  sentence: string;
  presence: RiderPresenceLabel | null;
  rideState: 'not_started' | 'live' | 'ended';
  nextStop: { name: string; distanceKm: number; etaText: string } | null;
}

const R = 6371;
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const TOURING_SPEED_KMH = 40;

/** The first stop ahead: after the nearest stop, skipping one we are already at. */
export function nextStopFor(pos: { lat: number; lng: number } | null, stops: SpectatorStop[], now: number = Date.now()): SpectatorView['nextStop'] {
  if (!pos) return null;
  const ordered = stops.filter(s => s.waypoint_type !== 'origin').slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  if (!ordered.length) return null;
  const dist = ordered.map(s => km(pos, { lat: s.latitude, lng: s.longitude }));
  let idx = dist.indexOf(Math.min(...dist));
  if (dist[idx] < 0.5 && idx < ordered.length - 1) idx += 1;
  else if (idx < ordered.length - 1 && dist[idx + 1] < dist[idx] + 1) idx += 1;
  const stop = ordered[idx];
  const d = dist[idx];
  if (d < 0.5) return { name: stop.name, distanceKm: 0, etaText: 'arriving now' };
  let etaText: string;
  const planned = stop.planned_arrival ? Date.parse(stop.planned_arrival) : NaN;
  if (Number.isFinite(planned) && planned > now) {
    etaText = `planned around ${new Date(planned).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  } else {
    const mins = Math.round((d / TOURING_SPEED_KMH) * 60 / 5) * 5;
    etaText = mins < 60 ? `about ${Math.max(5, mins)} min away` : `about ${Math.round(mins / 6) / 10} h away`;
  }
  return { name: stop.name, distanceKm: Math.round(d), etaText };
}

export function spectatorView(input: {
  subject: { user_id: string; display_name: string } | null;
  ride: { name: string; status: string; started_at?: string | null };
  participants: SpectatorRider[];
  waypoints: SpectatorStop[];
  stays?: SpectatorStay[];
  now?: number;
}): SpectatorView {
  const now = input.now ?? Date.now();
  const rider = input.subject ? input.participants.find(p => p.user_id === input.subject!.user_id) ?? null : null;
  const followName = input.subject?.display_name ?? input.ride.name;
  const rideState = input.ride.status === 'active' ? 'live' : input.ride.status === 'completed' || input.ride.status === 'archived' ? 'ended' : 'not_started';

  if (rideState === 'not_started') {
    return { followName, title: `${input.subject ? followName + "'s ride" : input.ride.name} has not started`, sentence: 'This page will show the live map once the group sets off.', presence: null, rideState, nextStop: null };
  }
  if (rideState === 'ended') {
    return { followName, title: 'Ride finished', sentence: input.subject ? `${followName}'s ride has ended and live sharing is off.` : 'The ride has ended and live sharing is off.', presence: null, rideState, nextStop: null };
  }

  if (input.subject) {
    const presence = riderPresence(rider?.timestamp, now);
    const pos = rider ? { lat: rider.lat, lng: rider.lng } : null;
    const atStay = pos && input.stays?.find(s => km(pos, { lat: s.latitude, lng: s.longitude }) < 0.5);
    const title = atStay
      ? `${followName} reached ${atStay.name}`
      : presence.state === 'dead_zone' ? `${followName} is out of signal`
      : presence.state === 'unknown' ? `Waiting for ${followName}'s location`
      : `${followName} is riding`;
    const sentence = presence.state === 'dead_zone'
      ? `${presence.sentence} Mountain roads often have no signal; the map updates as soon as the phone reconnects.`
      : presence.sentence;
    return { followName, title, sentence, presence, rideState, nextStop: atStay ? null : nextStopFor(pos, input.waypoints, now) };
  }

  const freshest = input.participants.slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  const presence = riderPresence(freshest?.timestamp, now);
  return {
    followName,
    title: `${input.participants.length} rider${input.participants.length === 1 ? '' : 's'} on the road`,
    sentence: presence.state === 'live' ? 'Live now.' : presence.sentence,
    presence,
    rideState,
    nextStop: nextStopFor(freshest ? { lat: freshest.lat, lng: freshest.lng } : null, input.waypoints, now),
  };
}
