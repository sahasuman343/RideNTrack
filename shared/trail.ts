import { distanceMeters } from './route';

/** Rider's own breadcrumb trail as [lng, lat] pairs with a running distance. */
export interface RideTrail {
  coords: [number, number][];
  times: number[];
  distanceMeters: number;
}

export interface TrailHistory {
  coordinates: [number, number][];
  distance_meters: number;
  last_timestamp: string | null;
}

export const EMPTY_TRAIL: RideTrail = { coords: [], times: [], distanceMeters: 0 };
export const MAX_TRAIL_POINTS = 2000;
// About 5 m; smaller moves are GPS jitter at a standstill.
const MIN_TRAIL_STEP_DEGREES = 0.00005;

function thin(trail: RideTrail, maxPoints: number): RideTrail {
  const limit = Math.max(2, maxPoints);
  while (trail.coords.length > limit) {
    const last = trail.coords.length - 1;
    const keep = (_: unknown, i: number) => i % 2 === 0 || i === last;
    // Distance is accumulated, so dropping display points never changes it.
    trail = { coords: trail.coords.filter(keep), times: trail.times.filter(keep), distanceMeters: trail.distanceMeters };
  }
  return trail;
}

/** O(1) distance update per fix instead of re-summing the whole trail. */
export function appendTrailPoint(
  trail: RideTrail,
  point: { lat: number; lng: number; timestamp: string },
  maxPoints = MAX_TRAIL_POINTS,
): RideTrail {
  const time = Date.parse(point.timestamp);
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(time)) return trail;
  const n = trail.coords.length;
  const last = trail.coords[n - 1];
  if (last && time <= trail.times[n - 1]) return trail;
  if (last && Math.abs(last[0] - point.lng) < MIN_TRAIL_STEP_DEGREES && Math.abs(last[1] - point.lat) < MIN_TRAIL_STEP_DEGREES) return trail;
  const step = last ? distanceMeters({ lat: last[1], lng: last[0] }, point) : 0;
  return thin({
    coords: [...trail.coords, [point.lng, point.lat]],
    times: [...trail.times, time],
    distanceMeters: trail.distanceMeters + (Number.isFinite(step) ? step : 0),
  }, maxPoints);
}

/**
 * Server history covers the whole ride; live points collected before it
 * arrived are kept only when newer than the last persisted breadcrumb.
 */
export function mergeTrailHistory(history: TrailHistory, live: RideTrail, maxPoints = MAX_TRAIL_POINTS): RideTrail {
  const lastTime = history.last_timestamp ? Date.parse(history.last_timestamp) : Number.NEGATIVE_INFINITY;
  const coords = (Array.isArray(history.coordinates) ? history.coordinates : [])
    .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  let trail = thin({
    coords,
    times: coords.map(() => (Number.isFinite(lastTime) ? lastTime : 0)),
    distanceMeters: Number.isFinite(history.distance_meters) ? history.distance_meters : 0,
  }, maxPoints);
  live.coords.forEach((c, i) => {
    if (live.times[i] > lastTime) trail = appendTrailPoint(trail, { lng: c[0], lat: c[1], timestamp: new Date(live.times[i]).toISOString() }, maxPoints);
  });
  return trail;
}
