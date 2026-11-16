export type RouteWaypointType = 'origin' | 'meetup' | 'stop' | 'fuel' | 'food' | 'rest' | 'sightseeing' | 'destination';

export type RoutePoint = {
  id?: string | null;
  sequence: number;
  waypoint_type: RouteWaypointType;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  provider_place_id?: string | null;
  notes?: string | null;
  is_optional?: boolean;
  trip_day_id?: string | null;
  day_number?: number | null;
};

export type DirectionsRoute = {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distance: number;
  duration: number;
};

export function validateRoutePoints(points: RoutePoint[]): string | null {
  if (!Array.isArray(points) || points.length < 2) return 'A route needs an origin and a destination.';
  if (points.length > 25) return 'Mapbox driving directions support at most 25 route points, including origin and destination.';
  if (points[0].waypoint_type !== 'origin') return 'The first point must be the origin.';
  if (points[points.length - 1].waypoint_type !== 'destination') return 'The last point must be the destination.';
  const ids = points.map(point => point.id).filter((id): id is string => Boolean(id));
  if (new Set(ids).size !== ids.length) return 'A waypoint cannot appear more than once.';
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point.sequence !== index) return 'Route point order must be contiguous.';
    if (!point.name?.trim()) return 'Every route point needs a name.';
    if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90
      || !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
      return 'A route point has invalid coordinates.';
    }
    if (index > 0 && index < points.length - 1
      && (point.waypoint_type === 'origin' || point.waypoint_type === 'destination')) {
      return 'Only the first and last points can be origin or destination.';
    }
  }
  return null;
}

export function routeCoordinates(points: RoutePoint[]): [number, number][] {
  return points.map(point => [point.longitude, point.latitude]);
}

export function parseDirectionsRoute(payload: unknown): DirectionsRoute {
  const root = payload as { routes?: Array<{ geometry?: { type?: string; coordinates?: unknown }; distance?: unknown; duration?: unknown }> } | null;
  const route = root?.routes?.[0];
  const geometry = route?.geometry;
  const coordinates = geometry?.coordinates;
  if (geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('The routing service did not return a valid route. Try adjusting your stops.');
  }
  const normalized: [number, number][] = coordinates.map((pair: any) => {
    if (!Array.isArray(pair) || pair.length < 2 || !Number.isFinite(Number(pair[0])) || !Number.isFinite(Number(pair[1]))
      || Number(pair[0]) < -180 || Number(pair[0]) > 180 || Number(pair[1]) < -90 || Number(pair[1]) > 90) {
      throw new Error('The routing service returned invalid route coordinates.');
    }
    return [Number(pair[0]), Number(pair[1])];
  });
  const distance = Number(route?.distance), duration = Number(route?.duration);
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('The routing service returned invalid distance or duration estimates.');
  }
  return { geometry: { type: 'LineString', coordinates: normalized }, distance: Math.round(distance), duration: Math.round(duration) };
}

export function formatRouteDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) return '—';
  return meters >= 10000 ? (meters / 1000).toFixed(0) + ' km' : (meters / 1000).toFixed(1) + ' km';
}

export function formatRouteDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60;
  return hours ? hours + ' hr ' + (minutes ? minutes + ' min' : '') : minutes + ' min';
}
