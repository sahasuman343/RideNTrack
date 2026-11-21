/**
 * GPX (GPS Exchange Format 1.1) Exporter for Motorcycle Touring
 * Generates standard GPX 1.1 XML for routes, waypoints, and recorded GPS trails.
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
