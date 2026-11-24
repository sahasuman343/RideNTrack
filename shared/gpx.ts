import { MAX_TRIP_ROUTE_POINTS, type RoutePoint, type RouteWaypointType } from './route';

/**
 * GPX (GPS Exchange Format 1.1) Exporter & Importer for Motorcycle Touring
 * Generates and parses standard GPX 1.1 XML for routes, waypoints, and recorded GPS trails.
 */

export interface GpxWaypoint {
  name: string;
  latitude: number;
  longitude: number;
  waypoint_type?: string | null;
  notes?: string | null;
  elevation?: number | null;
}

export interface GpxExportOptions {
  tripName: string;
  description?: string | null;
  waypoints?: GpxWaypoint[];
  routeCoordinates?: [number, number][]; // [longitude, latitude]
  trailCoordinates?: [number, number][]; // [longitude, latitude]
  recordedAt?: string | null;
}

function escapeXml(unsafe: string | null | undefined): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportTripToGpx(options: GpxExportOptions): string {
  const tripName = escapeXml(options.tripName || 'RideNTrack Tour');
  const description = escapeXml(options.description || 'Motorcycle touring route exported from RideNTrack.');
  const timeStr = options.recordedAt || new Date().toISOString();

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="RideNTrack Touring Companion" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${tripName}</name>`,
    `    <desc>${description}</desc>`,
    `    <time>${timeStr}</time>`,
    '  </metadata>',
  ];

  // 1. Waypoints (<wpt>)
  if (Array.isArray(options.waypoints) && options.waypoints.length > 0) {
    for (const wpt of options.waypoints) {
      if (
        typeof wpt.latitude !== 'number' ||
        typeof wpt.longitude !== 'number' ||
        !Number.isFinite(wpt.latitude) ||
        !Number.isFinite(wpt.longitude)
      ) {
        continue;
      }
      lines.push(`  <wpt lat="${wpt.latitude.toFixed(6)}" lon="${wpt.longitude.toFixed(6)}">`);
      lines.push(`    <name>${escapeXml(wpt.name || 'Waypoint')}</name>`);
      if (wpt.notes) {
        lines.push(`    <desc>${escapeXml(wpt.notes)}</desc>`);
      }
      if (wpt.waypoint_type) {
        lines.push(`    <type>${escapeXml(wpt.waypoint_type)}</type>`);
      }
      lines.push('  </wpt>');
    }
  }

  // 2. Planned Route (<rte>)
  if (Array.isArray(options.routeCoordinates) && options.routeCoordinates.length >= 2) {
    lines.push('  <rte>');
    lines.push(`    <name>${tripName} - Planned Route</name>`);
    for (const coord of options.routeCoordinates) {
      if (
        !Array.isArray(coord) ||
        coord.length < 2 ||
        !Number.isFinite(coord[0]) ||
        !Number.isFinite(coord[1])
      ) {
        continue;
      }
      const lon = coord[0];
      const lat = coord[1];
      lines.push(`    <rtept lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`);
    }
    lines.push('  </rte>');
  }

  // 3. Recorded GPS Trail (<trk>)
  if (Array.isArray(options.trailCoordinates) && options.trailCoordinates.length >= 2) {
    lines.push('  <trk>');
    lines.push(`    <name>${tripName} - Recorded GPS Trail</name>`);
    lines.push('    <trkseg>');
    for (const coord of options.trailCoordinates) {
      if (
        !Array.isArray(coord) ||
        coord.length < 2 ||
        !Number.isFinite(coord[0]) ||
        !Number.isFinite(coord[1])
      ) {
        continue;
      }
      const lon = coord[0];
      const lat = coord[1];
      lines.push(`      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`);
    }
    lines.push('    </trkseg>');
    lines.push('  </trk>');
  }

  lines.push('</gpx>');
  return lines.join('\n');
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function extractTagText(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? unescapeXml(match[1].trim()) : undefined;
}

function downsamplePoints(points: RoutePoint[], maxPoints: number): RoutePoint[] {
  if (points.length <= maxPoints) return points;
  const result: RoutePoint[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = i === maxPoints - 1 ? points.length - 1 : Math.round(i * step);
    result.push({ ...points[idx], sequence: i });
  }
  return result;
}

const VALID_WAYPOINT_TYPES = new Set<RouteWaypointType>([
  'origin',
  'meetup',
  'stop',
  'fuel',
  'food',
  'rest',
  'sightseeing',
  'destination',
  'repair',
  'accommodation',
]);

const STRICT_DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function parsePointTags(
  xml: string,
  tagName: 'wpt' | 'rtept' | 'trkpt',
  warnings: string[],
): RoutePoint[] {
  const regex = new RegExp(`<${tagName}\\s+([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`, 'gi');
  const points: RoutePoint[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const latMatch = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i);
    const lonMatch = attrs.match(/\blon\s*=\s*["']([^"']+)["']/i);
    const latStr = latMatch?.[1]?.trim() ?? '';
    const lonStr = lonMatch?.[1]?.trim() ?? '';
    const lat = STRICT_DECIMAL_RE.test(latStr) ? Number(latStr) : Number.NaN;
    const lon = STRICT_DECIMAL_RE.test(lonStr) ? Number(lonStr) : Number.NaN;

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      warnings.push(`Skipped malformed <${tagName}> with invalid coordinates.`);
      continue;
    }

    const rawName = extractTagText(inner, 'name');
    const rawDesc = extractTagText(inner, 'desc');
    const rawType = extractTagText(inner, 'type')?.toLowerCase() as RouteWaypointType | undefined;
    const waypointType: RouteWaypointType = rawType && VALID_WAYPOINT_TYPES.has(rawType) ? rawType : 'stop';

    points.push({
      sequence: points.length,
      waypoint_type: waypointType,
      name: rawName || `${tagName.toUpperCase()} ${points.length + 1}`,
      notes: rawDesc || null,
      latitude: lat,
      longitude: lon,
    });
  }

  return points;
}

export function parseGpx(xml: string): {
  name?: string;
  waypoints: RoutePoint[];
  routePoints: RoutePoint[];
  trackPoints: RoutePoint[];
  warnings: string[];
} {
  if (typeof xml !== 'string' || !xml.trim()) {
    return { waypoints: [], routePoints: [], trackPoints: [], warnings: ['Empty GPX input.'] };
  }

  const warnings: string[] = [];
  const cleanXml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const metadataBlock = cleanXml.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i)?.[1] || '';
  const name = extractTagText(metadataBlock, 'name') || extractTagText(cleanXml, 'name');

  let waypoints = parsePointTags(cleanXml, 'wpt', warnings);
  let routePoints = parsePointTags(cleanXml, 'rtept', warnings);
  let trackPoints = parsePointTags(cleanXml, 'trkpt', warnings);

  if (waypoints.length > MAX_TRIP_ROUTE_POINTS) {
    warnings.push(`Downsampled ${waypoints.length} waypoints to ${MAX_TRIP_ROUTE_POINTS}.`);
    waypoints = downsamplePoints(waypoints, MAX_TRIP_ROUTE_POINTS);
  }
  if (routePoints.length > MAX_TRIP_ROUTE_POINTS) {
    warnings.push(`Downsampled ${routePoints.length} route points to ${MAX_TRIP_ROUTE_POINTS}.`);
    routePoints = downsamplePoints(routePoints, MAX_TRIP_ROUTE_POINTS);
  }
  if (trackPoints.length > MAX_TRIP_ROUTE_POINTS) {
    warnings.push(`Downsampled ${trackPoints.length} track points to ${MAX_TRIP_ROUTE_POINTS}.`);
    trackPoints = downsamplePoints(trackPoints, MAX_TRIP_ROUTE_POINTS);
  }

  return { name, waypoints, routePoints, trackPoints, warnings };
}
