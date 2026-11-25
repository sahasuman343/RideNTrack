const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const cf = loader()('shared/captainFlow.ts');
const NOW = Date.parse('2026-12-10T05:00:00Z');
const meet = { lat: 12, lng: 77 };

test('phase follows ride status, briefing and debrief', () => {
  assert.equal(cf.captainPhase({ rideStatus: 'planned', briefingVersion: null, debriefSaved: false }), 'briefing');
  assert.equal(cf.captainPhase({ rideStatus: 'planned', briefingVersion: 2, debriefSaved: false }), 'roll_call');
  assert.equal(cf.captainPhase({ rideStatus: 'active', briefingVersion: null, debriefSaved: false }), 'riding');
  assert.equal(cf.captainPhase({ rideStatus: 'completed', briefingVersion: 1, debriefSaved: false }), 'debrief');
  assert.equal(cf.captainPhase({ rideStatus: 'completed', briefingVersion: 1, debriefSaved: true }), 'done');
});

test('auto check-in needs a fresh, accurate fix within 200 m', () => {
  const fix = (dLat, ageMs, accuracy = 10) => ({ lat: 12 + dLat, lng: 77, timestamp: NOW - ageMs, accuracy });
  assert.equal(cf.qualifiesForAutoCheckIn(fix(0.001, 1000), meet, NOW), true, '~110 m');
  assert.equal(cf.qualifiesForAutoCheckIn(fix(0.002, 1000), meet, NOW), false, '~220 m');
  assert.equal(cf.qualifiesForAutoCheckIn(fix(0.0005, 6 * 60000), meet, NOW), false, 'stale');
  assert.equal(cf.qualifiesForAutoCheckIn(fix(0.0005, 1000, 250), meet, NOW), false, 'inaccurate');
  assert.equal(cf.qualifiesForAutoCheckIn(fix(0, 1000), null, NOW), false);
});

test('roll call summary and start gate', () => {
  const riders = [
    { userId: 'cap', name: 'Cap', attendance: 'confirmed' },
    { userId: 'a', name: 'Asha', attendance: 'checked_in', checkedInBy: 'location' },
    { userId: 'b', name: 'Bala', attendance: 'confirmed' },
    { userId: 'c', name: 'Chet', attendance: 'absent' },
  ];
  const sum = cf.summariseRollCall(riders, 'cap');
  assert.equal(sum.waiting.length, 1);
  assert.equal(sum.byLocation, 1);
  assert.equal(sum.headline, '2 of 3 here · waiting for 1');
  const gate = cf.canStartRide(sum);
  assert.equal(gate.needsOverride, true);
  assert.match(gate.reason, /Bala/);
  const all = cf.summariseRollCall(riders.map(r => r.userId === 'b' ? { ...r, attendance: 'checked_in' } : r), 'cap');
  assert.equal(cf.canStartRide(all).ok, true);
  assert.equal(all.headline, 'All 3 here');
});

test('missing at regroup skips absent riders', () => {
  const riders = [
    { userId: 'a', name: 'Asha', attendance: 'checked_in' },
    { userId: 'b', name: 'Bala', attendance: 'checked_in' },
    { userId: 'c', name: 'Chet', attendance: 'absent' },
  ];
  assert.deepEqual(cf.missingAtRegroup(riders, ['a']).map(r => r.userId), ['b']);
  assert.equal(cf.allThroughSentence('Chai stop', []), 'All through at Chai stop. Everyone accounted for.');
  assert.equal(cf.allThroughSentence('Chai stop', [{ name: 'Bala' }]), 'Sweep passed Chai stop. Not seen: Bala.');
});

test('briefing and debrief are generated from trip data', () => {
  const b = cf.buildBriefing({ rideName: 'Nandi dawn', meetupName: 'Hebbal flyover', startTime: '5:30 AM', lead: 'Ravi', sweep: null, regroupPoints: [{ name: 'Chai stop' }], handSignals: [], distanceKm: 61.4 });
  assert.deepEqual(b.lines.map(l => l.label), ['Meet', 'Lead', 'Sweep', 'Distance', 'Regroups']);
  assert.equal(b.signals.length, cf.DEFAULT_HAND_SIGNALS.length);
  assert.equal(b.lines[3].value, '61 km');
  const d = cf.buildDebrief({ rideName: 'Nandi dawn', distanceKm: 120, durationMinutes: 185, riders: 6, alerts: [{ type: 'fuel' }, { type: 'fuel' }, { type: 'announcement' }], fuelSpendInr: 2400, regroupsMissing: [{ point: 'Chai stop', names: ['Bala'] }], startOverrideReason: 'Late riders will catch up' });
  assert.equal(d.summary, '120 km · 3 h 5 min · 6 riders. Everyone home safe?');
  assert.deepEqual(d.facts, ['Alerts: 2 fuel.', 'Fuel logged: ₹2,400.', 'Not seen at Chai stop: Bala.', 'Started before roll call finished: Late riders will catch up.']);
});

test('no client code changes rides.status directly', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '../..');
  const files = ['mobile/app/ride/[id].tsx', 'mobile/app/trip/[id].tsx'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /from\('rides'\)\.update\(\{\s*status/, f);
  }
  const ride = fs.readFileSync(path.join(root, 'mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(ride, /captainFlow\.startRide/);
  assert.match(ride, /captainFlow\.endRide/);
});
