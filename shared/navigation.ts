import type { RoutePoint } from './route';

export type ExternalNavProvider = 'google_maps' | 'apple_maps';

function assertValidNavPoint(point: Pick<RoutePoint, 'latitude' | 'longitude'>, index: number): void {
  if (
    !point ||
    !Number.isFinite(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    !Number.isFinite(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    throw new Error(`Invalid navigation coordinate at index ${index}.`);
  }
}

/**
 * Splits a route into sequential navigation legs so each leg stays within
 * external Maps URL intermediate waypoint limits (default: 8 intermediate stops).
 * Each subsequent leg starts at the previous leg's end point.
 */
export function sliceNavigationLegs(
  points: RoutePoint[],
  maxIntermediateWaypoints = 8,
): RoutePoint[][] {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('At least 2 route points are required to build navigation legs.');
  }
  if (!Number.isInteger(maxIntermediateWaypoints) || maxIntermediateWaypoints < 0) {
    throw new Error('maxIntermediateWaypoints must be a non-negative integer.');
  }

  points.forEach((point, index) => assertValidNavPoint(point, index));

  const maxStep = maxIntermediateWaypoints + 1;
  if (points.length - 1 <= maxStep) {
    return [points.slice()];
  }

  const legs: RoutePoint[][] = [];
  let startIndex = 0;

  while (startIndex < points.length - 1) {
    const endIndex = Math.min(startIndex + maxStep, points.length - 1);
    legs.push(points.slice(startIndex, endIndex + 1));
    startIndex = endIndex;
  }

  return legs;
}

/**
 * Builds an external turn-by-turn navigation URL for Google Maps or Apple Maps
 * for a single navigation leg.
 */
export function buildExternalNavUrl(
  provider: ExternalNavProvider,
  legPoints: RoutePoint[],
  options?: { avoidTolls?: boolean },
): string {
  if (!Array.isArray(legPoints) || legPoints.length < 2) {
    throw new Error('A navigation leg requires at least 2 points.');
  }

  legPoints.forEach((point, index) => assertValidNavPoint(point, index));

  const origin = legPoints[0];
  const destination = legPoints[legPoints.length - 1];
  const intermediates = legPoints.slice(1, -1);

  if (provider === 'google_maps') {
    const params = new URLSearchParams({
      api: '1',
      origin: `${origin.latitude},${origin.longitude}`,
      destination: `${destination.latitude},${destination.longitude}`,
      travelmode: 'driving',
    });

    if (intermediates.length > 0) {
      params.set(
        'waypoints',
        intermediates.map(point => `${point.latitude},${point.longitude}`).join('|'),
      );
    }

    if (options?.avoidTolls) {
      params.set('avoid', 'tolls');
    }

    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  if (provider === 'apple_maps') {
    // Apple Maps URL scheme is most reliable with a single immediate next destination.
    const nextStop = intermediates.length > 0 ? intermediates[0] : destination;
    const params = new URLSearchParams({
      saddr: `${origin.latitude},${origin.longitude}`,
      daddr: `${nextStop.latitude},${nextStop.longitude}`,
      dirflg: 'd',
    });
    return `https://maps.apple.com/?${params.toString()}`;
  }

  throw new Error(`Unsupported navigation provider: ${String(provider)}`);
}
