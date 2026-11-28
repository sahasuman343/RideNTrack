import {
  OFFLINE_MAX_ZOOM,
  OFFLINE_MIN_ZOOM,
  OFFLINE_STYLE_URL,
  planOfflinePacks,
  type LngLat,
  type OfflinePlan,
} from '@ridentrack/shared';
import { deleteOfflinePackRows, getOfflinePackRows, saveOfflinePackRow, type OfflinePackRow } from '../lib/tripCache';

/*
 * F5 pack manager. Cuts the route into corridor boxes (shared/corridor.ts),
 * downloads one Mapbox offline pack per box, and records them in SQLite next
 * to trip_cache. Pack names are rnt:<rideId>:<routeHash>:<index>, so a changed
 * route downloads fresh packs and the old ones are removed.
 */

type MapboxModule = typeof import('@rnmapbox/maps').default;
let Mapbox: MapboxModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Mapbox = require('@rnmapbox/maps').default;
} catch {
  Mapbox = null;
}

export const offlineMapsAvailable = Boolean(Mapbox?.offlineManager);

/** Mapbox's default device cap; the R3 spike raises it within the plan's terms. */
const TILE_COUNT_LIMIT = 30_000;
let limitSet = false;

export function routeHash(coords: LngLat[]): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(coords.length / 200));
  for (let i = 0; i < coords.length; i += step) {
    const v = `${coords[i][0].toFixed(3)},${coords[i][1].toFixed(3)};`;
    for (let j = 0; j < v.length; j++) { h ^= v.charCodeAt(j); h = Math.imul(h, 16777619); }
  }
  return (h >>> 0).toString(36);
}

const STATE: Record<number, OfflinePackRow['status']> = { 0: 'inactive', 1: 'active', 2: 'complete' };

export interface TripPackState { plan: OfflinePlan; hash: string; rows: OfflinePackRow[] }

export async function getTripPackState(rideId: string, coords: LngLat[]): Promise<TripPackState> {
  const plan = planOfflinePacks(coords);
  const hash = routeHash(coords);
  const rows = (await getOfflinePackRows(rideId)).filter(r => r.route_hash === hash);
  if (Mapbox?.offlineManager && rows.length) {
    // Refresh from Mapbox's own store; it survives app restarts.
    await Promise.all(rows.map(async row => {
      try {
        const pack = await Mapbox!.offlineManager.getPack(row.name);
        if (!pack) { row.status = 'error'; row.percent = 0; return; }
        const st = await pack.status();
        row.status = STATE[st.state] ?? 'inactive';
        row.percent = st.percentage;
        row.bytes = st.completedResourceSize;
      } catch { /* keep the stored row */ }
    }));
  }
  return { plan, hash, rows };
}

/** Starts (or resumes) every missing pack for this route. Progress arrives via onProgress. */
export async function downloadTripPacks(rideId: string, coords: LngLat[], onProgress: () => void): Promise<void> {
  if (!Mapbox?.offlineManager) throw new Error('Offline maps need the RideNTrack app build, not Expo Go.');
  const manager = Mapbox.offlineManager;
  if (!limitSet) { manager.setTileCountLimit(TILE_COUNT_LIMIT); limitSet = true; }
  const { plan, hash, rows } = await getTripPackState(rideId, coords);

  // Remove packs for an older version of this route.
  const stale = (await getOfflinePackRows(rideId)).filter(r => r.route_hash !== hash);
  for (const row of stale) await manager.deletePack(row.name).catch(() => {});
  if (stale.length) {
    await deleteOfflinePackRows(rideId);
    for (const row of rows) await saveOfflinePackRow(row);
  }

  for (let i = 0; i < plan.boxes.length; i++) {
    const name = `rnt:${rideId}:${hash}:${i}`;
    const existing = rows.find(r => r.name === name);
    if (existing?.status === 'complete') continue;
    const pack = await manager.getPack(name).catch(() => undefined);
    if (pack) { await pack.resume().catch(() => {}); continue; }
    const [[west, south], [east, north]] = plan.boxes[i];
    await saveOfflinePackRow({ name, ride_id: rideId, route_hash: hash, box_index: i, status: 'active', percent: 0, bytes: 0 });
    await manager.createPack(
      { name, styleURL: OFFLINE_STYLE_URL, bounds: [[east, north], [west, south]], minZoom: OFFLINE_MIN_ZOOM, maxZoom: OFFLINE_MAX_ZOOM, metadata: { rideId, box: i } },
      (_pack, status) => {
        void saveOfflinePackRow({
          name, ride_id: rideId, route_hash: hash, box_index: i,
          status: STATE[status.state] ?? 'active', percent: status.percentage, bytes: status.completedResourceSize,
        }).then(onProgress);
      },
      () => {
        void saveOfflinePackRow({ name, ride_id: rideId, route_hash: hash, box_index: i, status: 'error', percent: 0, bytes: 0 }).then(onProgress);
      },
    );
  }
}

export async function deleteTripPacks(rideId: string): Promise<void> {
  const rows = await getOfflinePackRows(rideId);
  for (const row of rows) await Mapbox?.offlineManager.deletePack(row.name).catch(() => {});
  await deleteOfflinePackRows(rideId);
}
