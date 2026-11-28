const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const { createChunkedStore } = loader()('mobile/src/lib/chunkedStore.ts');

function memoryStore(limit = 2048) {
  const data = new Map();
  return {
    data,
    async getItem(k) { return data.has(k) ? data.get(k) : null; },
    async setItem(k, v) { if (v.length > limit) throw new Error('value too large'); data.set(k, v); },
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

test('long sessions are split under the platform limit and read back whole', async () => {
  const raw = memoryStore(2048);
  const store = createChunkedStore(raw);
  const session = JSON.stringify({ access_token: 'x'.repeat(3000), refresh_token: 'r'.repeat(200) });
  await store.setItem('sb-auth', session);
  assert.ok([...raw.data.values()].every(v => v.length <= 2048));
  assert.equal(await store.getItem('sb-auth'), session);
});

test('shrinking or removing a value clears its old chunks', async () => {
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

test('a missing chunk reads as signed out, not a corrupt session', async () => {
  const raw = memoryStore();
  const store = createChunkedStore(raw, 10);
  await store.setItem('k', 'z'.repeat(30));
  raw.data.delete('k.1');
  assert.equal(await store.getItem('k'), null);
});
