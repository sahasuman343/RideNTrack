export type RouteWaypointType = 'origin' | 'meetup' | 'stop' | 'fuel' | 'food' | 'rest' | 'sightseeing' | 'destination' | 'repair' | 'accommodation';

export const WAYPOINT_META: Record<RouteWaypointType, { label: string; icon: string; short: string; description: string }> = {
  origin: { label: 'Start Point', icon: '🟢', short: 'START', description: 'Journey origin' },
  destination: { label: 'Finish Point', icon: '🏁', short: 'FINISH', description: 'Final destination' },
  stop: { label: 'Stop', icon: '🛑', short: 'STOP', description: 'General planned waypoint' },
  fuel: { label: 'Fuel Stop', icon: '⛽', short: 'FUEL', description: 'Petrol / gas station' },
  food: { label: 'Food & Meals', icon: '🍽️', short: 'FOOD', description: 'Breakfast, lunch, or dinner stop' },
  rest: { label: 'Rest Break', icon: '☕', short: 'REST', description: 'Chai / coffee & stretch break' },
  sightseeing: { label: 'Scenic View', icon: '📸', short: 'VIEW', description: 'Attraction or scenic viewpoint' },
  meetup: { label: 'Meetup Point', icon: '📍', short: 'MEET', description: 'Rider regrouping location' },
  repair: { label: 'Repair & Service', icon: '🔧', short: 'REPAIR', description: 'Motorcycle mechanic / puncture shop' },
  accommodation: { label: 'Stay / Hotel', icon: '🏨', short: 'STAY', description: 'Overnight stay or campsite' },
};

export const EDITABLE_WAYPOINT_TYPES: RouteWaypointType[] = ['stop', 'fuel', 'food', 'rest', 'sightseeing', 'repair', 'accommodation', 'meetup'];

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
  trip_stage_id?: string | null;
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

export function insertRouteStop(
  points: RoutePoint[],
  stop: Omit<RoutePoint, 'sequence'>,
  targetIndex?: number,
): RoutePoint[] {
  if (points.length >= 25) {
    throw new Error('Mapbox driving directions support up to 25 points, including origin and destination.');
  }
  if (!stop.name || !stop.name.trim()) {
    throw new Error('A route stop must have a valid name.');
  }
  if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude) || Math.abs(stop.latitude) > 90 || Math.abs(stop.longitude) > 180) {
    throw new Error('A route stop must have valid geographic coordinates.');
  }
  const destinationIndex = points.length - 1;
  const insertAt = targetIndex !== undefined
    ? Math.max(1, Math.min(destinationIndex, targetIndex))
    : destinationIndex;

  const newPoint: RoutePoint = {
    ...stop,
    name: stop.name.trim(),
    sequence: insertAt,
  };

  const nextPoints = [
    ...points.slice(0, insertAt),
    newPoint,
    ...points.slice(insertAt),
  ];

  return nextPoints.map((point, index) => ({ ...point, sequence: index }));
}

export function removeRouteStop(points: RoutePoint[], index: number): RoutePoint[] {
  if (index <= 0 || index >= points.length - 1) {
    throw new Error('Origin and destination cannot be removed.');
  }
  return points.filter((_, i) => i !== index).map((point, i) => ({ ...point, sequence: i }));
}

export function moveRouteStop(points: RoutePoint[], fromIndex: number, toIndex: number): RoutePoint[] {
  const lastIndex = points.length - 1;
  if (fromIndex <= 0 || fromIndex >= lastIndex || toIndex <= 0 || toIndex >= lastIndex) {
    throw new Error('Only intermediate route stops can be reordered.');
  }
  if (fromIndex === toIndex) return points;

  const next = [...points];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  return next.map((point, index) => ({ ...point, sequence: index }));
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

export function distanceMeters(a: { lat: number; lng: number } | null | undefined, b: { lat: number; lng: number } | null | undefined): number {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    return Number.POSITIVE_INFINITY;
  }
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function distanceToRouteMeters(point: { lat: number; lng: number } | null | undefined, coordinates: number[][] | null | undefined): number {
  if (!point || !Array.isArray(coordinates) || coordinates.length < 2) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return Number.POSITIVE_INFINITY;
  const cosLat = Math.cos(point.lat * Math.PI / 180);
  const scaleX = 111320 * cosLat;
  const scaleY = 110540;
  let nearest = Number.POSITIVE_INFINITY;

  const first = coordinates[0];
  if (!Array.isArray(first) || !Number.isFinite(first[0]) || !Number.isFinite(first[1])) return Number.POSITIVE_INFINITY;
  let ax = (first[0] - point.lng) * scaleX;
  let ay = (first[1] - point.lat) * scaleY;

  for (let i = 1; i < coordinates.length; i++) {
    const next = coordinates[i];
    if (!Array.isArray(next) || !Number.isFinite(next[0]) || !Number.isFinite(next[1])) continue;
    const bx = (next[0] - point.lng) * scaleX;
    const by = (next[1] - point.lat) * scaleY;
    const dx = bx - ax, dy = by - ay;
    const denom = dx * dx + dy * dy;
    const t = denom === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denom));
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (dist < nearest) nearest = dist;
    ax = bx;
    ay = by;
  }
  return nearest;
}

export interface PackRiderInput {
  user_id: string;
  display_name?: string;
  lat: number;
  lng: number;
  speed?: number | null;
  timestamp?: string;
}

export interface PackRiderProgress {
  userId: string;
  displayName: string;
  lat: number;
  lng: number;
  routeDistanceMeters: number;
  gapToAheadMeters: number;
  gapToLeaderMeters: number;
  distanceToRouteMeters: number;
  isLeader: boolean;
  isTail: boolean;
  isSeparated: boolean;
  order: number;
}

export function calculateDistanceAlongPolyline(
  point: { lat: number; lng: number } | null | undefined,
  coordinates: number[][] | null | undefined
): { distanceAlongRouteMeters: number; distanceToRouteMeters: number } {
  if (!point || !Array.isArray(coordinates) || coordinates.length < 2) {
    return { distanceAlongRouteMeters: 0, distanceToRouteMeters: Number.POSITIVE_INFINITY };
  }
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { distanceAlongRouteMeters: 0, distanceToRouteMeters: Number.POSITIVE_INFINITY };
  }

  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const scaleX = 111320 * cosLat;
  const scaleY = 110540;

  let nearestDist = Number.POSITIVE_INFINITY;
  let bestDistanceAlong = 0;
  let cumulativeDistance = 0;

  const first = coordinates[0];
  if (!Array.isArray(first) || !Number.isFinite(first[0]) || !Number.isFinite(first[1])) {
    return { distanceAlongRouteMeters: 0, distanceToRouteMeters: Number.POSITIVE_INFINITY };
  }

  let ax = (first[0] - point.lng) * scaleX;
  let ay = (first[1] - point.lat) * scaleY;

  for (let i = 1; i < coordinates.length; i++) {
    const next = coordinates[i];
    if (!Array.isArray(next) || !Number.isFinite(next[0]) || !Number.isFinite(next[1])) continue;

    const bx = (next[0] - point.lng) * scaleX;
    const by = (next[1] - point.lat) * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const segmentLen = Math.hypot(dx, dy);

    const denom = dx * dx + dy * dy;
    const t = denom === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denom));
    const dist = Math.hypot(ax + t * dx, ay + t * dy);

    if (dist < nearestDist) {
      nearestDist = dist;
      bestDistanceAlong = cumulativeDistance + t * segmentLen;
    }

    cumulativeDistance += segmentLen;
    ax = bx;
    ay = by;
  }

  return {
    distanceAlongRouteMeters: Math.round(bestDistanceAlong),
    distanceToRouteMeters: Math.round(nearestDist),
  };
}

export function calculatePackFormation(
  riders: PackRiderInput[] | null | undefined,
  coordinates: number[][] | null | undefined,
  separationThresholdMeters = 1000
): PackRiderProgress[] {
  if (!Array.isArray(riders) || riders.length === 0 || !Array.isArray(coordinates) || coordinates.length < 2) {
    return [];
  }

  const validRiders = riders.filter(
    r => r && typeof r.lat === 'number' && typeof r.lng === 'number' && Number.isFinite(r.lat) && Number.isFinite(r.lng)
  );
  if (validRiders.length === 0) return [];

  const progresses = validRiders.map(r => {
    const res = calculateDistanceAlongPolyline(r, coordinates);
    return {
      userId: r.user_id,
      displayName: r.display_name || 'Rider',
      lat: r.lat,
      lng: r.lng,
      routeDistanceMeters: res.distanceAlongRouteMeters,
      distanceToRouteMeters: res.distanceToRouteMeters,
    };
  });

  progresses.sort((a, b) => b.routeDistanceMeters - a.routeDistanceMeters);

  const leaderDistance = progresses[0].routeDistanceMeters;

  return progresses.map((p, idx) => {
    const isLeader = idx === 0;
    const isTail = idx === progresses.length - 1 && progresses.length > 1;
    const ahead = isLeader ? null : progresses[idx - 1];
    const gapToAheadMeters = ahead ? Math.max(0, ahead.routeDistanceMeters - p.routeDistanceMeters) : 0;
    const gapToLeaderMeters = Math.max(0, leaderDistance - p.routeDistanceMeters);
    const isSeparated = !isLeader && gapToAheadMeters > separationThresholdMeters;

    return {
      userId: p.userId,
      displayName: p.displayName,
      lat: p.lat,
      lng: p.lng,
      routeDistanceMeters: p.routeDistanceMeters,
      gapToAheadMeters,
      gapToLeaderMeters,
      distanceToRouteMeters: p.distanceToRouteMeters,
      isLeader,
      isTail,
      isSeparated,
      order: idx + 1,
    };
  });
}
