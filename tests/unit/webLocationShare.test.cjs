const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');
const share = loader()('shared/webLocationShare.ts');

const fix = (over = {}) => ({ lat: 12.97, lng: 77.59, accuracy: 10, speed: 5, heading: 90, timestamp: 1_000_000, ...over });

test('first good fix is sent; inaccurate or impossible fixes never are', () => {
  assert.equal(share.shouldSendFix(null, fix()), true);
  assert.equal(share.shouldSendFix(null, fix({ accuracy: 250 })), false);
  assert.equal(share.shouldSendFix(null, fix({ lat: 95 })), false);
  assert.equal(share.shouldSendFix(null, fix({ lng: NaN })), false);
});

test('throttles to movement or a heartbeat', () => {
  const a = fix();
  assert.equal(share.shouldSendFix(a, fix({ timestamp: a.timestamp + 5_000, lat: 12.98 })), false, 'too soon, even if moved');
  assert.equal(share.shouldSendFix(a, fix({ timestamp: a.timestamp + 15_000 })), false, 'parked and no heartbeat due');
  assert.equal(share.shouldSendFix(a, fix({ timestamp: a.timestamp + 15_000, lat: 12.9705 })), true, 'moved ~55 m');
  assert.equal(share.shouldSendFix(a, fix({ timestamp: a.timestamp + 21_000 })), true, 'heartbeat keeps a parked rider fresh');
});

test('heartbeat is due before a rider counts as stale', () => {
  assert.ok(share.WEB_SHARE_HEARTBEAT_MS < 30_000);
});

test('row matches what bulk_insert_location_updates accepts', () => {
  const row = share.locationRowFor(fix({ speed: null, heading: -90 }), 'ride', 'user', 'client');
  assert.deepEqual(row, { client_id: 'client', ride_id: 'ride', user_id: 'user', lat: 12.97, lng: 77.59, speed: 0, heading: 270, timestamp: new Date(1_000_000).toISOString() });
});
