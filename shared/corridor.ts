/*
 * F5 Offline map packs. A route is cut into small boxes along the line
 * (about 10 km of road each, padded a few km either side) so a 470 km day is
 * dozens of small downloads instead of one huge rectangle. Riders never see
 * packs: the trip shows one badge, "Ready offline", or what is missing.
 */

export type LngLat = [number, number];
/** [[west, south], [east, north]] */
export type BBox = [LngLat, LngLat];

export const OFFLINE_MIN_ZOOM = 8;
export const OFFLINE_MAX_ZOOM = 14;
export const OFFLINE_STYLE_URL = 'mapbox://styles/mapbox/outdoors-v12';
export const AUTO_DOWNLOAD_DAYS_BEFORE = 7;
/** Rough average vector tile size for outdoors-v12 at zoom 8-14, from the R3 spike notes. */
export const AVG_TILE_KB = 18;

const EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function kmBetween(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pad(box: BBox, padKm: number): BBox {
  const midLat = (box[0][1] + box[1][1]) / 2;
  const dLat = padKm / 111;
  const dLng = padKm / (111 * Math.max(0.2, Math.cos(toRad(midLat))));
  return [[box[0][0] - dLng, box[0][1] - dLat], [box[1][0] + dLng, box[1][1] + dLat]];
}

/** Boxes along the line, each covering about `segmentKm` of road plus `padKm` either side. */
export function corridorBoxes(coords: LngLat[], options: { segmentKm?: number; padKm?: number } = {}): BBox[] {
  const segmentKm = options.segmentKm ?? 10;
  const padKm = options.padKm ?? 3;
  const pts = coords.filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (pts.length === 0) return [];
  if (pts.length === 1) return [pad([pts[0], pts[0]], padKm)];
  const boxes: BBox[] = [];
  let west = pts[0][0], east = pts[0][0], south = pts[0][1], north = pts[0][1];
  let run = 0;
  const flush = () => { boxes.push(pad([[west, south], [east, north]], padKm)); };
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const d = kmBetween(prev, cur);
    // Long straight segments are split so no single box gets huge.
    const steps = Math.max(1, Math.ceil(d / segmentKm));
    for (let s = 1; s <= steps; s++) {
      const p: LngLat = [prev[0] + ((cur[0] - prev[0]) * s) / steps, prev[1] + ((cur[1] - prev[1]) * s) / steps];
      west = Math.min(west, p[0]); east = Math.max(east, p[0]);
      south = Math.min(south, p[1]); north = Math.max(north, p[1]);
      run += d / steps;
      if (run >= segmentKm) {
        flush();
        west = east = p[0]; south = north = p[1];
        run = 0;
      }
    }
  }
  if (run > 0 || boxes.length === 0) flush();
  return boxes;
}

export function boxContains(box: BBox, p: LngLat): boolean {
  return p[0] >= box[0][0] && p[0] <= box[1][0] && p[1] >= box[0][1] && p[1] <= box[1][1];
}

function lngToTileX(lng: number, z: number) { return Math.floor(((lng + 180) / 360) * 2 ** z); }
function latToTileY(lat: number, z: number) {
  const r = toRad(Math.max(-85, Math.min(85, lat)));
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tilesForBox(box: BBox, minZoom = OFFLINE_MIN_ZOOM, maxZoom = OFFLINE_MAX_ZOOM): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lngToTileX(box[0][0], z), x1 = lngToTileX(box[1][0], z);
    const y0 = latToTileY(box[1][1], z), y1 = latToTileY(box[0][1], z);
    total += (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1);
  }
  return total;
}

export interface OfflinePlan { boxes: BBox[]; tiles: number; estimatedMb: number; routeKm: number }

export function planOfflinePacks(coords: LngLat[], options: { segmentKm?: number; padKm?: number } = {}): OfflinePlan {
  const boxes = corridorBoxes(coords, options);
  const tiles = boxes.reduce((n, b) => n + tilesForBox(b), 0);
  let routeKm = 0;
  for (let i = 1; i < coords.length; i++) routeKm += kmBetween(coords[i - 1], coords[i]);
  return { boxes, tiles, estimatedMb: Math.round((tiles * AVG_TILE_KB) / 1024), routeKm: Math.round(routeKm) };
}

export function shouldAutoDownload(input: { tripStart: string | null | undefined; now?: number; onWifi: boolean; state: OfflineState }): boolean {
  if (!input.onWifi) return false;
  if (input.state === 'ready' || input.state === 'downloading') return false;
  const start = input.tripStart ? Date.parse(input.tripStart) : NaN;
  if (!Number.isFinite(start)) return false;
  const days = (start - (input.now ?? Date.now())) / 86_400_000;
  return days <= AUTO_DOWNLOAD_DAYS_BEFORE && days > -14;
}

export type OfflineState = 'ready' | 'partial' | 'missing' | 'downloading' | 'not_needed';

export interface PackProgress { status: 'complete' | 'active' | 'inactive' | 'error' | 'missing'; percent: number }

export function offlineState(packs: PackProgress[], expected: number): OfflineState {
  if (expected === 0) return 'not_needed';
  if (packs.length === 0) return 'missing';
  if (packs.some(p => p.status === 'active')) return 'downloading';
  const complete = packs.filter(p => p.status === 'complete').length;
  if (complete >= expected) return 'ready';
  return complete > 0 ? 'partial' : 'missing';
}

/** The one badge riders see. */
export function offlineBadge(state: OfflineState, packs: PackProgress[], plan: Pick<OfflinePlan, 'estimatedMb'> | null, onWifi: boolean): { label: string; detail: string; tone: 'ok' | 'pending' | 'warn' } {
  switch (state) {
    case 'ready':
    case 'not_needed':
      return { label: 'Ready offline', detail: 'The map works with no signal on this route.', tone: 'ok' };
    case 'downloading': {
      const pct = packs.length ? Math.round(packs.reduce((s, p) => s + (p.status === 'complete' ? 100 : p.percent), 0) / packs.length) : 0;
      return { label: `Saving map ${pct}%`, detail: 'Keep the app open on Wi-Fi to finish.', tone: 'pending' };
    }
    case 'partial':
      return { label: 'Map partly saved', detail: onWifi ? 'Tap to finish saving the rest of the route.' : 'Finishes on Wi-Fi, or tap to use mobile data.', tone: 'warn' };
    default: {
      const size = plan?.estimatedMb ? ` (about ${plan.estimatedMb} MB)` : '';
      return { label: 'Map not saved offline', detail: onWifi ? `Tap to save the route map${size}.` : `Saves on Wi-Fi in the week before the trip${size}.`, tone: 'warn' };
    }
  }
}
