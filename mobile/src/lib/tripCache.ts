import * as SQLite from 'expo-sqlite';
import type { Ride, TripWaypoint, TripStage, TripDay, TripStay } from '@ridentrack/shared';

let database: Promise<SQLite.SQLiteDatabase> | undefined;

export interface CachedTripData {
  trip: Ride;
  waypoints: TripWaypoint[];
  stages: TripStage[];
  days: TripDay[];
  stays: TripStay[];
  cachedAt: string;
}

function makeKey(rideId: string, userId?: string | null): string {
  return userId ? `${userId}#${rideId}` : rideId;
}

async function openDatabase() {
  const db = await SQLite.openDatabaseAsync('ridentrack-queue.db');
  await db.execAsync(
    'PRAGMA journal_mode = WAL;' +
    'CREATE TABLE IF NOT EXISTS trip_cache (' +
    '  id TEXT PRIMARY KEY,' +
    '  user_id TEXT,' +
    '  ride_id TEXT,' +
    '  payload TEXT NOT NULL,' +
    '  updated_at TEXT NOT NULL' +
    ');' +
    // F5: which offline map packs belong to which trip, and for which route.
    'CREATE TABLE IF NOT EXISTS offline_packs (' +
    '  name TEXT PRIMARY KEY,' +
    '  ride_id TEXT NOT NULL,' +
    '  route_hash TEXT NOT NULL,' +
    '  box_index INTEGER NOT NULL,' +
    '  status TEXT NOT NULL,' +
    '  percent REAL NOT NULL DEFAULT 0,' +
    '  bytes INTEGER NOT NULL DEFAULT 0,' +
    '  updated_at TEXT NOT NULL' +
    ');' +
    'CREATE INDEX IF NOT EXISTS idx_offline_packs_ride ON offline_packs (ride_id);'
  );
  return db;
}

function getDatabase() {
  database ??= openDatabase().catch(err => {
    database = undefined;
    throw err;
  });
  return database;
}

export async function saveCachedTrip(
  rideId: string,
  data: Omit<CachedTripData, 'cachedAt'>,
  userId?: string | null
): Promise<void> {
  if (!rideId) return;
  try {
    const db = await getDatabase();
    const payload: CachedTripData = {
      ...data,
      cachedAt: new Date().toISOString(),
    };
    const key = makeKey(rideId, userId);
    await db.runAsync(
      'INSERT OR REPLACE INTO trip_cache (id, user_id, ride_id, payload, updated_at) VALUES (?, ?, ?, ?, ?)',
      key,
      userId || null,
      rideId,
      JSON.stringify(payload),
      payload.cachedAt
    );
  } catch (err) {
    console.warn('Could not cache trip to offline storage:', err);
  }
}

export async function getCachedTrip(rideId: string, userId?: string | null): Promise<CachedTripData | null> {
  if (!rideId) return null;
  try {
    const db = await getDatabase();
    const key = makeKey(rideId, userId);
    const row = await db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM trip_cache WHERE id = ?',
      key
    );
    if (!row?.payload) return null;
    return JSON.parse(row.payload) as CachedTripData;
  } catch (err) {
    console.warn('Could not read cached trip from offline storage:', err);
    return null;
  }
}

export async function clearCachedTrip(rideId: string, userId?: string | null): Promise<void> {
  if (!rideId) return;
  try {
    const db = await getDatabase();
    const key = makeKey(rideId, userId);
    await db.runAsync('DELETE FROM trip_cache WHERE id = ?', key);
  } catch {
    /* ignore cache clear failure */
  }
}

export async function clearAllCachedTripsForUser(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM trip_cache WHERE user_id = ? OR id LIKE ?', userId, `${userId}#%`);
  } catch {
    /* ignore */
  }
}

export async function clearAllCachedTrips(): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM trip_cache');
  } catch {
    /* ignore */
  }
}

export interface OfflinePackRow {
  name: string;
  ride_id: string;
  route_hash: string;
  box_index: number;
  status: 'complete' | 'active' | 'inactive' | 'error';
  percent: number;
  bytes: number;
}

export async function saveOfflinePackRow(row: OfflinePackRow): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO offline_packs (name, ride_id, route_hash, box_index, status, percent, bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      row.name, row.ride_id, row.route_hash, row.box_index, row.status, row.percent, row.bytes, new Date().toISOString(),
    );
  } catch { /* the pack itself still exists in Mapbox's store */ }
}

export async function getOfflinePackRows(rideId: string): Promise<OfflinePackRow[]> {
  try {
    const db = await getDatabase();
    return await db.getAllAsync<OfflinePackRow>('SELECT name, ride_id, route_hash, box_index, status, percent, bytes FROM offline_packs WHERE ride_id = ? ORDER BY box_index', rideId);
  } catch {
    return [];
  }
}

export async function deleteOfflinePackRows(rideId: string): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM offline_packs WHERE ride_id = ?', rideId);
  } catch { /* ignore */ }
}

/** F5: keep the ride's route on the phone so the live map works with no signal. */
export async function saveCachedRoute(rideId: string, userId: string | null | undefined, geometry: Ride['route_geometry']): Promise<void> {
  if (!geometry) return;
  const cached = await getCachedTrip(rideId, userId);
  if (cached) {
    await saveCachedTrip(rideId, { ...cached, trip: { ...cached.trip, route_geometry: geometry } }, userId);
  }
}
