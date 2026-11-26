import type { RoutePoint } from './route';

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

const xml = (value: string) => value.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
const coord = (n: number) => (Math.round(n * 1e6) / 1e6).toString();

/**
 * A GPX 1.1 file for navigation apps and GPS units: every route point as a
 * waypoint, plus the road line as a track when one has been calculated.
 */
export function tripRouteToGpx(trip: { name: string }, points: (Pick<RoutePoint, 'name' | 'latitude' | 'longitude'> & { waypoint_type: string })[], geometry?: LineString | null): string {
  const name = xml(trip.name.trim() || 'rideNtrack trip');
  const wpts = points.map(p => `  <wpt lat="${coord(p.latitude)}" lon="${coord(p.longitude)}"><name>${xml(p.name)}</name><type>${xml(p.waypoint_type)}</type></wpt>`);
  const line = geometry?.coordinates?.filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1])) ?? [];
  const track = line.length >= 2
    ? [`  <trk><name>${name}</name><trkseg>`, ...line.map(c => `    <trkpt lat="${coord(c[1])}" lon="${coord(c[0])}"/>`), '  </trkseg></trk>']
    : [];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="rideNtrack" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${name}</name></metadata>`,
    ...wpts,
    ...track,
    '</gpx>',
    '',
  ].join('\n');
}

/** A safe file name for a trip download. */
export function tripFileName(name: string, ext: string) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return (slug || 'trip') + '.' + ext;
}
