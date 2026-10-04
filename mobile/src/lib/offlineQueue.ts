import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { BufferedLocation, BufferedAlert } from '@ridentrack/shared';

let database: Promise<SQLite.SQLiteDatabase> | undefined;
const uuid = (hex: string) => hex.slice(0,8) + '-' + hex.slice(8,12) + '-4' + hex.slice(13,16) + '-8' + hex.slice(17,20) + '-' + hex.slice(20);
async function openDatabase() {
  const db = await SQLite.openDatabaseAsync('ridentrack-queue.db');
  await db.execAsync("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT NOT NULL, ride_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS queue_user_kind ON queue(user_id,kind,created_at); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  if (!await db.getFirstAsync("SELECT key FROM metadata WHERE key = 'legacy-migrated'")) {
    const entries = await AsyncStorage.multiGet(['@ridentrack/location_queue', '@ridentrack/alert_queue']);
    await db.withExclusiveTransactionAsync(async txn => {
      for (const [key, raw] of entries) {
        if (!raw) continue;
        for (const item of JSON.parse(raw) as (BufferedLocation | BufferedAlert)[]) {
          const row = await txn.getFirstAsync<{ hex: string }>('SELECT lower(hex(randomblob(16))) AS hex');
          const id = typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) ? item.id : uuid(row!.hex);
          await txn.runAsync('INSERT OR IGNORE INTO queue VALUES (?, ?, ?, ?, ?, ?)', id, key.includes('location') ? 'location' : 'alert', item.user_id, item.ride_id, JSON.stringify({ ...item, id }), 'timestamp' in item ? item.timestamp : item.created_at);
        }
      }
      await txn.runAsync("INSERT OR REPLACE INTO metadata VALUES ('legacy-migrated','1')");
    });
    await AsyncStorage.multiRemove(entries.map(([key]) => key));
  }
  return db;
}
function getDatabase() {
  database ??= openDatabase().catch(error => { database = undefined; throw error; });
  return database;
}
export async function newQueueId() {
  const row = await (await getDatabase()).getFirstAsync<{ hex: string }>('SELECT lower(hex(randomblob(16))) AS hex');
  return uuid(row!.hex);
}
async function enqueue(kind: string, item: BufferedLocation | BufferedAlert) {
  const id = item.id || await newQueueId();
  await (await getDatabase()).runAsync('INSERT OR IGNORE INTO queue VALUES (?, ?, ?, ?, ?, ?)', id, kind, item.user_id, item.ride_id, JSON.stringify({ ...item, id }), 'timestamp' in item ? item.timestamp : item.created_at);
}
export const enqueueLocation = (item: BufferedLocation) => enqueue('location', item);
export const enqueueAlert = (item: BufferedAlert) => enqueue('alert', item);
async function read<T>(kind: string, userId: string, limit: number): Promise<T[]> {
  const rows = await (await getDatabase()).getAllAsync<{ payload: string }>('SELECT payload FROM queue WHERE kind = ? AND user_id = ? ORDER BY created_at LIMIT ?', kind, userId, limit);
  return rows.map(row => JSON.parse(row.payload) as T);
}
export const getQueuedLocations = (userId: string, limit = 100) => read<BufferedLocation>('location', userId, limit);
export const getQueuedAlerts = (userId: string) => read<BufferedAlert>('alert', userId, 100);
export async function clearQueuedItems(userId: string, ids: string[]) {
  if (ids.length) await (await getDatabase()).runAsync('DELETE FROM queue WHERE user_id = ? AND id IN (' + ids.map(() => '?').join(',') + ')', userId, ...ids);
}
export async function getQueueCounts(userId: string) {
  const rows = await (await getDatabase()).getAllAsync<{ kind: string; count: number }>('SELECT kind, count(*) AS count FROM queue WHERE user_id = ? GROUP BY kind', userId);
  return { locations: rows.find(r => r.kind === 'location')?.count || 0, alerts: rows.find(r => r.kind === 'alert')?.count || 0 };
}
