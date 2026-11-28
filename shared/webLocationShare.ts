/**
 * Foreground location sharing from the web app: which browser fixes are worth
 * sending, and the row shape bulk_insert_location_updates expects (the same
 * shape the phone app's sync queue sends).
 */
export interface BrowserFix {
  lat: number;
  lng: number;
  /** metres */
  accuracy: number | null;
  /** m/s, null when the browser does not know */
  speed: number | null;
  /** degrees, null when standing still or unknown */
  heading: number | null;
  /** ms since epoch */
  timestamp: number;
}

export const WEB_SHARE_MIN_INTERVAL_MS = 10_000;
export const WEB_SHARE_MIN_MOVE_M = 25;
export const WEB_SHARE_MAX_ACCURACY_M = 100;
// Under isStale's 30 s cutoff, so a parked rider never flickers to "last known".
export const WEB_SHARE_HEARTBEAT_MS = 20_000;

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Keep a fix when it is accurate enough and either the rider moved, enough time
 * passed, or a heartbeat is due so the group does not see them as stale.
 */
export function shouldSendFix(previous: BrowserFix | null, next: BrowserFix): boolean {
  if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng) || Math.abs(next.lat) > 90 || Math.abs(next.lng) > 180) return false;
  if (next.accuracy != null && next.accuracy > WEB_SHARE_MAX_ACCURACY_M) return false;
  if (!previous) return true;
  const elapsed = next.timestamp - previous.timestamp;
  if (elapsed < WEB_SHARE_MIN_INTERVAL_MS) return false;
  return elapsed >= WEB_SHARE_HEARTBEAT_MS || metresBetween(previous, next) >= WEB_SHARE_MIN_MOVE_M;
}

export function locationRowFor(fix: BrowserFix, rideId: string, userId: string, clientId: string) {
  const finite = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    client_id: clientId,
    ride_id: rideId,
    user_id: userId,
    lat: fix.lat,
    lng: fix.lng,
    speed: Math.max(0, finite(fix.speed)),
    heading: ((finite(fix.heading) % 360) + 360) % 360,
    timestamp: new Date(fix.timestamp).toISOString(),
  };
}
