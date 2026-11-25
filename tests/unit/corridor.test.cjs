const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const c = loader()('shared/corridor.ts');

// Roughly Manali -> Keylong -> Sarchu, with a long straight leg.
const route = [[77.18, 32.24], [77.25, 32.37], [77.03, 32.57], [77.2, 32.8], [77.4, 32.9]];

test('corridor boxes cover every route point and stay small', () => {
  const boxes = c.corridorBoxes(route);
  assert.ok(boxes.length >= 6, `expected many small boxes, got ${boxes.length}`);
  for (const p of route) assert.ok(boxes.some(b => c.boxContains(b, p)), `point ${p} uncovered`);
  // Points along each leg (not just vertices) are covered too.
  for (let i = 1; i < route.length; i++) {
    for (let t = 0; t <= 1; t += 0.1) {
      const p = [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t];
      assert.ok(boxes.some(b => c.boxContains(b, p)), `mid-leg point ${p} uncovered`);
    }
  }
  for (const b of boxes) {
    assert.ok(c.kmBetween(b[0], b[1]) < 25, 'box diagonal stays under 25 km');
  }
});

test('plan estimates tiles and size', () => {
  const plan = c.planOfflinePacks(route);
  assert.ok(plan.routeKm > 70 && plan.routeKm < 120, String(plan.routeKm));
  assert.ok(plan.tiles > 100);
  assert.ok(plan.estimatedMb > 0);
  assert.deepEqual(c.corridorBoxes([]), []);
  assert.equal(c.corridorBoxes([[77, 32]]).length, 1);
});

test('auto download only on Wi-Fi within a week of the trip', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(c.shouldAutoDownload({ tripStart: '2026-12-05', now, onWifi: true, state: 'missing' }), true);
  assert.equal(c.shouldAutoDownload({ tripStart: '2026-12-05', now, onWifi: false, state: 'missing' }), false);
  assert.equal(c.shouldAutoDownload({ tripStart: '2026-12-20', now, onWifi: true, state: 'missing' }), false);
  assert.equal(c.shouldAutoDownload({ tripStart: '2026-12-05', now, onWifi: true, state: 'ready' }), false);
});

test('one badge for riders', () => {
  assert.equal(c.offlineState([], 4), 'missing');
  assert.equal(c.offlineState([{ status: 'complete', percent: 100 }, { status: 'active', percent: 40 }], 2), 'downloading');
  assert.equal(c.offlineState([{ status: 'complete', percent: 100 }], 2), 'partial');
  assert.equal(c.offlineState([{ status: 'complete', percent: 100 }, { status: 'complete', percent: 100 }], 2), 'ready');
  assert.equal(c.offlineBadge('ready', [], null, true).label, 'Ready offline');
  assert.equal(c.offlineBadge('downloading', [{ status: 'complete', percent: 100 }, { status: 'active', percent: 50 }], null, true).label, 'Saving map 75%');
  assert.match(c.offlineBadge('missing', [], { estimatedMb: 120 }, false).detail, /Wi-Fi.*120 MB/);
});
