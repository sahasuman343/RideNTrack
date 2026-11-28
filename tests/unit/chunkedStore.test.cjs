const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const { createChunkedStore, splitByUtf8Bytes } = loader()('mobile/src/lib/chunkedStore.ts');
const bytes = s => Buffer.byteLength(s, 'utf8');

function memoryStore(limitBytes = 2048) {
  const data = new Map();
  let failAfter = Infinity;
  return {
    data,
    failAfterWrites(n) { failAfter = n; },
    async getItem(k) { return data.has(k) ? data.get(k) : null; },
    async setItem(k, v) {
      if (failAfter-- <= 0) throw new Error('interrupted');
      if (bytes(v) > limitBytes) throw new Error('value too large');
      data.set(k, v);
    },
    async removeItem(k) { data.delete(k); },
  };
}

test('short values are stored as-is under the key', async () => {
  const raw = memoryStore();
  const store = createChunkedStore(raw, 100);
  await store.setItem('sb-auth', 'short');
  assert.equal(raw.data.get('sb-auth'), 'short');
  assert.equal(await store.getItem('sb-auth'), 'short');
});

test('long sessions are split under the platform byte limit and read back whole', async () => {
  const raw = memoryStore(2048);
  const store = createChunkedStore(raw);
  const session = JSON.stringify({ access_token: 'x'.repeat(3000), user: { name: 'आशा राइडर 🏍️'.repeat(60) } });
  await store.setItem('sb-auth', session);
  assert.ok([...raw.data.values()].every(v => bytes(v) <= 2048));
  assert.equal(await store.getItem('sb-auth'), session);
});

test('chunks are measured in UTF-8 bytes and never split a character', () => {
  const value = 'अ'.repeat(10) + '🏍️'.repeat(5);
  const parts = splitByUtf8Bytes(value, 10);
  assert.ok(parts.every(p => bytes(p) <= 10));
  assert.equal(parts.join(''), value);
});

test('rewriting or removing a value clears the old chunks', async () => {
  const raw = memoryStore();
  const store = createChunkedStore(raw, 10);
  await store.setItem('k', 'a'.repeat(35));
  assert.equal(raw.data.size, 5);
  await store.setItem('k', 'b'.repeat(15));
  assert.equal(raw.data.size, 3);
  assert.equal(await store.getItem('k'), 'b'.repeat(15));
  await store.setItem('k', 'tiny');
  assert.deepEqual([...raw.data.keys()], ['k']);
  await store.setItem('k', 'c'.repeat(25));
  await store.removeItem('k');
  assert.equal(raw.data.size, 0);
  assert.equal(await store.getItem('k'), null);
});

test('an interrupted rewrite keeps the previous session readable', async () => {
  const raw = memoryStore();
  const store = createChunkedStore(raw, 10);
  const old = 'o'.repeat(30);
  await store.setItem('k', old);
  raw.failAfterWrites(2);
  await assert.rejects(store.setItem('k', 'n'.repeat(30)));
  assert.equal(await store.getItem('k'), old);
});

test('a missing chunk reads as signed out, not a corrupt session', async () => {
  const raw = memoryStore();
  const store = createChunkedStore(raw, 10);
  await store.setItem('k', 'z'.repeat(30));
  raw.data.delete('k.0.1');
  assert.equal(await store.getItem('k'), null);
});

test('a failed rewrite leaves no staged chunks behind', async () => {
  const raw = memoryStore();
  const store = createChunkedStore(raw, 10);
  await store.setItem('k', 'o'.repeat(30));
  const before = new Set(raw.data.keys());
  raw.failAfterWrites(2);
  await assert.rejects(store.setItem('k', 'n'.repeat(30)));
  assert.deepEqual(new Set(raw.data.keys()), before);
});

test('a marker that cannot be read stops the write', async () => {
  const raw = memoryStore();
  const store = createChunkedStore(raw, 10);
  await store.setItem('k', 'o'.repeat(30));
  const getItem = raw.getItem;
  raw.getItem = async k => { if (k === 'k') throw new Error('keystore busy'); return getItem(k); };
  await assert.rejects(store.setItem('k', 'n'.repeat(30)));
  raw.getItem = getItem;
  assert.equal(await store.getItem('k'), 'o'.repeat(30));
});

test('overlapping reads and writes on one key never see a mixed or missing value', async () => {
  const raw = memoryStore();
  // Slow storage, so operations would interleave without serialisation.
  const slow = {
    getItem: async k => { await new Promise(r => setTimeout(r, 1)); return raw.getItem(k); },
    setItem: async (k, v) => { await new Promise(r => setTimeout(r, 1)); return raw.setItem(k, v); },
    removeItem: async k => { await new Promise(r => setTimeout(r, 1)); return raw.removeItem(k); },
  };
  const store = createChunkedStore(slow, 10);
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  await store.setItem('k', a);
  const results = await Promise.all([store.setItem('k', b), store.getItem('k'), store.setItem('k', a), store.getItem('k')]);
  assert.equal(results[1], b);
  assert.equal(results[3], a);
  assert.equal(await store.getItem('k'), a);
});
