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

async function openDatabase() {
  const db = await SQLite.openDatabaseAsync('ridentrack-queue.db');
  await db.execAsync(
    'PRAGMA journal_mode = WAL;' +
    'CREATE TABLE IF NOT EXISTS trip_cache (' +
    '  id TEXT PRIMARY KEY,' +
    '  payload TEXT NOT NULL,' +
    '  updated_at TEXT NOT NULL' +
    ');'
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

export async function saveCachedTrip(rideId: string, data: Omit<CachedTripData, 'cachedAt'>): Promise<void> {
  if (!rideId) return;
  try {
    const db = await getDatabase();
    const payload: CachedTripData = {
      ...data,
      cachedAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT OR REPLACE INTO trip_cache (id, payload, updated_at) VALUES (?, ?, ?)',
      rideId,
      JSON.stringify(payload),
      payload.cachedAt
    );
  } catch (err) {
    console.warn('Could not cache trip to offline storage:', err);
  }
}

export async function getCachedTrip(rideId: string): Promise<CachedTripData | null> {
  if (!rideId) return null;
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM trip_cache WHERE id = ?',
      rideId
    );
    if (!row?.payload) return null;
    return JSON.parse(row.payload) as CachedTripData;
  } catch (err) {
    console.warn('Could not read cached trip from offline storage:', err);
    return null;
  }
}

export async function clearCachedTrip(rideId: string): Promise<void> {
  if (!rideId) return;
  try {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM trip_cache WHERE id = ?', rideId);
  } catch {
    /* ignore cache clear failure */
  }
}
