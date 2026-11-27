import type { RoutePoint, RouteWaypointType } from './route';
import { parseGpx } from './gpx';

type LineString = { type: 'LineString'; coordinates: number[][] };
export type SavedRoute = { geometry: LineString; distance: number; duration: number };

/**
 * Arguments for `save_trip_route`, built the same way as the mobile route
 * editor: first point is the origin, last is the destination, sequences are
 * contiguous, and stops keep their trip day.
 */
export function buildSaveTripRouteArgs(
  rideId: string,
  points: RoutePoint[],
  days: { id: string; day_number: number }[],
  route: SavedRoute,
) {
  const origin = points[0];
  const destination = points[points.length - 1];
  return {
    p_ride_id: rideId,
    p_trip: {
      origin: origin.address || origin.name,
      destination: destination.address || destination.name,
      origin_coords: [origin.longitude, origin.latitude],
      destination_coords: [destination.longitude, destination.latitude],
      route_geometry: { type: 'Feature', geometry: route.geometry, properties: {} },
      estimated_distance_meters: route.distance,
      estimated_duration_seconds: route.duration,
    },
    p_waypoints: points.map((p, sequence) => ({
      id: p.id || null,
      sequence,
      waypoint_type: p.waypoint_type,
      name: p.name.trim(),
      address: p.address || p.name,
      latitude: p.latitude,
      longitude: p.longitude,
      provider_place_id: p.provider_place_id || null,
      notes: p.notes || null,
      is_optional: !!p.is_optional,
      day_number: days.find(d => d.id === p.trip_day_id)?.day_number ?? p.day_number ?? null,
    })),
  };
}

/**
 * Turns a GPX file into route points for the editor. Named waypoints win, then
 * a planned route, then a recorded track. The first point becomes the start,
 * the last the end, and long lists are thinned evenly to fit `maxPoints`.
 */
export function gpxToRoutePoints(xmlText: string, maxPoints: number): { name?: string; points: RoutePoint[]; source: 'waypoints' | 'route' | 'track'; total: number; warnings: string[] } {
  const parsed = parseGpx(xmlText);
  const choice = parsed.waypoints.length >= 2 ? { list: parsed.waypoints, source: 'waypoints' as const, label: 'Waypoint' }
    : parsed.routePoints.length >= 2 ? { list: parsed.routePoints, source: 'route' as const, label: 'Route point' }
    : parsed.trackPoints.length >= 2 ? { list: parsed.trackPoints, source: 'track' as const, label: 'Track point' }
    : null;
  if (!choice) throw new Error('This file has no route in it. A GPX file needs at least two waypoints, route points or track points.');
  const cap = Math.max(2, maxPoints);
  const list = choice.list.length <= cap ? choice.list
    : Array.from({ length: cap }, (_, i) => choice.list[i === cap - 1 ? choice.list.length - 1 : Math.round(i * (choice.list.length - 1) / (cap - 1))]);
  const last = list.length - 1;
  const points = list.map((p, i) => {
    const generic = /^(WPT|RTEPT|TRKPT) \d+$/.test(p.name);
    const type: RouteWaypointType = i === 0 ? 'origin' : i === last ? 'destination'
      : p.waypoint_type === 'origin' || p.waypoint_type === 'destination' ? 'stop' : p.waypoint_type;
    return { ...p, sequence: i, waypoint_type: type, name: generic ? `${choice.label} ${i + 1}` : p.name };
  });
  return { name: parsed.name, points, source: choice.source, total: choice.list.length, warnings: parsed.warnings };
}

/** A safe file name for a trip download. */
export function tripFileName(name: string, ext: string) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return (slug || 'trip') + '.' + ext;
}
