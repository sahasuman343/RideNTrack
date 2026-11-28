/**
 * expo-secure-store can reject values over about 2 KB on some Android devices,
 * and a Supabase session is close to that. This wraps a key-value store so a
 * long value is split across numbered keys with a small marker under the main
 * key. Short values are stored as before, so existing sessions keep working.
 *
 * Each write of a long value uses a new generation (key.<gen>.0, key.<gen>.1,
 * ...) and switches the marker only after every chunk is saved, so an
 * interrupted write leaves the previous value readable instead of a mix of
 * both. Chunks are sized in UTF-8 bytes, which is what the platform limits.
 * Operations on one key run one at a time, so a read never sees a generation
 * that a concurrent write is replacing, and two writes never interleave.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const MARKER = '__chunked__:';
/** Bytes per chunk: under SecureStore's ~2048-byte limit, with room for the platform's own overhead. */
export const DEFAULT_CHUNK_BYTES = 1800;

interface Marker {
  generation: number;
  count: number;
}

const chunkKey = (key: string, generation: number, index: number) => `${key}.${generation}.${index}`;

function parseMarker(value: string | null): Marker | null {
  if (!value?.startsWith(MARKER)) return null;
  const [generation, count] = value.slice(MARKER.length).split(':').map(Number);
  if (!Number.isInteger(generation) || generation < 0 || !Number.isInteger(count) || count <= 0) return null;
  return { generation, count };
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Splits on code point boundaries so no chunk exceeds maxBytes once UTF-8 encoded. */
export function splitByUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of value) {
    const size = utf8Length(char.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes && current) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function createChunkedStore(store: KeyValueStore, chunkBytes = DEFAULT_CHUNK_BYTES): KeyValueStore {
  const queues = new Map<string, Promise<unknown>>();
  /** Runs fn after every earlier operation on the same key has settled. */
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(key, tail);
    void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return run;
  }

  async function removeGeneration(key: string, marker: Marker | null) {
    if (!marker) return;
    for (let i = 0; i < marker.count; i++) {
      await store.removeItem(chunkKey(key, marker.generation, i)).catch(() => {});
    }
  }

  async function read(key: string): Promise<string | null> {
    const head = await store.getItem(key);
    const marker = parseMarker(head);
    if (!marker) return head;
    const parts: string[] = [];
    for (let i = 0; i < marker.count; i++) {
      const part = await store.getItem(chunkKey(key, marker.generation, i));
      // A missing chunk means the value is damaged: treat it as signed out.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  }

  async function write(key: string, value: string): Promise<void> {
    // If the current marker can't be read, stop: guessing a generation could
    // overwrite the chunks of the session that is still in use.
    const previous = parseMarker(await store.getItem(key));
    const chunks = splitByUtf8Bytes(value, chunkBytes);
    if (chunks.length <= 1 && !value.startsWith(MARKER)) {
      await store.setItem(key, value);
      await removeGeneration(key, previous);
      return;
    }
    const generation = previous ? (previous.generation + 1) % 1000 : 0;
    const staged = { generation, count: 0 };
    try {
      for (let i = 0; i < chunks.length; i++) {
        await store.setItem(chunkKey(key, generation, i), chunks[i]);
        staged.count = i + 1;
      }
      // Only now does the new value become visible; the old one stays intact until here.
      await store.setItem(key, `${MARKER}${generation}:${chunks.length}`);
    } catch (err) {
      // Leave no fragments of the failed write behind (they'd survive sign-out).
      await removeGeneration(key, staged.count > 0 ? staged : null);
      throw err;
    }
    await removeGeneration(key, previous);
  }

  async function remove(key: string): Promise<void> {
    const marker = parseMarker(await store.getItem(key).catch(() => null));
    await store.removeItem(key);
    await removeGeneration(key, marker);
  }

  return {
    getItem: key => serial(key, () => read(key)),
    setItem: (key, value) => serial(key, () => write(key, value)),
    removeItem: key => serial(key, () => remove(key)),
  };
}
