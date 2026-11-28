const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const GB = 1024 ** 3;

test('3 GB Android phones get the low tier, iPhones and bigger phones do not', () => {
  assert.equal(shared.deviceTier({ totalMemory: 2.8 * GB, platform: 'android' }), 'low');
  assert.equal(shared.deviceTier({ totalMemory: 3.6 * GB, platform: 'android' }), 'standard');
  assert.equal(shared.deviceTier({ totalMemory: null, yearClass: 2015, platform: 'android' }), 'low');
  assert.equal(shared.deviceTier({ totalMemory: 2 * GB, platform: 'ios' }), 'standard');
  assert.equal(shared.deviceTier({}), 'standard');
});

test('low tier keeps fewer trail points and updates the HUD less often', () => {
  const low = shared.performanceProfile({ totalMemory: 2.8 * GB, platform: 'android' });
  const std = shared.performanceProfile({ totalMemory: 8 * GB, platform: 'android' });
  assert.ok(low.trailMaxPoints < std.trailMaxPoints);
  assert.ok(low.hudIntervalMs > std.hudIntervalMs);
  assert.equal(shared.performanceProfile({ totalMemory: 8 * GB }, { tier: 'low' }).tier, 'low');
  assert.equal(shared.performanceProfile({ totalMemory: 2 * GB, platform: 'android' }, { tier: 'bogus' }).tier, 'low');
});

test('a capped trail keeps the whole distance', () => {
  let trail = shared.EMPTY_TRAIL;
  const start = Date.parse('2026-05-01T06:00:00Z');
  for (let i = 0; i < 1500; i++) {
    trail = shared.appendTrailPoint(trail, { lat: 12 + i * 0.001, lng: 77, timestamp: new Date(start + i * 5000).toISOString() }, 600);
  }
  assert.ok(trail.coords.length <= 600);
  assert.ok(Math.abs(trail.distanceMeters - 1499 * 111.2) < 1500, `distance ${trail.distanceMeters}`);
  assert.deepEqual(trail.coords[trail.coords.length - 1], [77, 12 + 1499 * 0.001]);
});

test('frame rate and stutter from frame times', () => {
  const smooth = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
  assert.equal(shared.framesPerSecond(smooth), 60);
  assert.equal(shared.jankShare(smooth), 0);
  const choppy = [0, 16, 32, 100, 116, 200];
  assert.ok(shared.jankShare(choppy) > 0.3);
  assert.equal(shared.framesPerSecond([5]), null);
  assert.equal(shared.withinBudget({ fps: 58 }), true);
  assert.equal(shared.withinBudget({ fps: 42 }), false);
  assert.equal(shared.withinBudget({ fps: 58, jsHeapMb: 400 }), false);
});
