/**
 * expo-secure-store can reject values over about 2 KB on some Android devices,
 * and a Supabase session is close to that. This wraps a key-value store so a
 * long value is split across numbered keys (key.0, key.1, ...) with a small
 * marker under the main key. Short values are stored as before, so existing
 * sessions keep working.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const MARKER = '__chunked__:';
/** Under SecureStore's ~2048-byte limit, leaving room for the platform's own overhead. */
export const DEFAULT_CHUNK_SIZE = 1800;

const chunkKey = (key: string, index: number) => `${key}.${index}`;

function chunkCount(marker: string | null): number {
  if (!marker?.startsWith(MARKER)) return 0;
  const n = Number(marker.slice(MARKER.length));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function createChunkedStore(store: KeyValueStore, chunkSize = DEFAULT_CHUNK_SIZE): KeyValueStore {
  async function removeChunks(key: string, from: number, to: number) {
    for (let i = from; i < to; i++) await store.removeItem(chunkKey(key, i)).catch(() => {});
  }

  return {
    async getItem(key) {
      const head = await store.getItem(key);
      const count = chunkCount(head);
      if (count === 0) return head;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await store.getItem(chunkKey(key, i));
        // A missing chunk means a half-written value: treat it as signed out.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const previous = chunkCount(await store.getItem(key).catch(() => null));
      if (value.length <= chunkSize && !value.startsWith(MARKER)) {
        await store.setItem(key, value);
        await removeChunks(key, 0, previous);
        return;
      }
      const count = Math.ceil(value.length / chunkSize);
      // Chunks first, marker last, so a reader never sees a marker without its chunks.
      for (let i = 0; i < count; i++) {
        await store.setItem(chunkKey(key, i), value.slice(i * chunkSize, (i + 1) * chunkSize));
      }
      await store.setItem(key, `${MARKER}${count}`);
      await removeChunks(key, count, previous);
    },

    async removeItem(key) {
      const count = chunkCount(await store.getItem(key).catch(() => null));
      await store.removeItem(key);
      await removeChunks(key, 0, count);
    },
  };
}
