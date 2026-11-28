const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, read } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

const fullProfile = { motorcycle_model: 'Himalayan 450', fuel_tank_capacity_liters: 17, emergency_contact: '+919876543210', phone: '+919811111111', share_ice_with_ride: true };

test('a fully set-up Android rider is ride ready with nothing to fix', () => {
  const items = shared.buildReadiness({
    platform: 'android', profile: fullProfile, familyContactsCount: 1, offlineMaps: 'ready',
    backgroundLocation: true, notifications: true, batteryOptimisationExempt: true,
  });
  const summary = shared.summariseReadiness(items);
  assert.equal(summary.ready, true);
  assert.equal(summary.headline, 'Ride ready');
  assert.equal(summary.next, null);
  assert.equal(summary.done, summary.total);
  assert.ok(items.some(i => i.id === 'battery_optimisation'));
});

test('essential items gate readiness and come first as the next fix', () => {
  const items = shared.buildReadiness({
    platform: 'ios', profile: { ...fullProfile, emergency_contact: '', motorcycle_model: null },
    offlineMaps: 'missing', backgroundLocation: false, notifications: true,
  });
  const summary = shared.summariseReadiness(items);
  assert.equal(summary.ready, false);
  assert.equal(summary.essentialMissing, 3);
  assert.equal(summary.headline, '3 things before you ride');
  assert.equal(summary.next.id, 'emergency_contact');
  assert.ok(summary.missingIds.includes('bike_model'));
  assert.ok(!items.some(i => i.id === 'battery_optimisation'), 'battery optimisation is Android only');
});

test('unknown device state is not reported to the captain as missing', () => {
  const items = shared.buildReadiness({ platform: 'android', profile: fullProfile, offlineMaps: null });
  const summary = shared.summariseReadiness(items);
  assert.ok(!summary.missingIds.includes('background_location'));
  assert.ok(!summary.missingIds.includes('offline_maps'));
  assert.equal(summary.ready, true, 'unknown is not a blocker');
});

test('decision 4 off hides the phone item; family item appears only when offered', () => {
  const noPhone = shared.buildReadiness({ platform: 'ios', profile: {}, collectPhone: false, offerFamilyContacts: false });
  assert.ok(!noPhone.some(i => i.id === 'phone'));
  assert.ok(!noPhone.some(i => i.id === 'family_contacts'));
  const withFamily = shared.buildReadiness({ platform: 'ios', profile: {}, familyContactsCount: 0 });
  assert.equal(withFamily.find(i => i.id === 'family_contacts').status, 'missing');
});

test('ready with suggestions says so, and every item has a short roster label', () => {
  const summary = shared.summariseReadiness(shared.buildReadiness({
    platform: 'web', profile: { emergency_contact: '1', phone: '', motorcycle_model: '', share_ice_with_ride: false }, offlineMaps: 'not_needed', offerFamilyContacts: false,
  }));
  assert.equal(summary.ready, true);
  assert.match(summary.headline, /^Ride ready · 3 suggestions$/);
  for (const id of Object.keys(shared.READINESS_SHORT_LABELS)) assert.ok(shared.READINESS_SHORT_LABELS[id]);
});

test('trip screen shows the Ride ready card and the ride screen no longer nags about battery', () => {
  assert.match(read('mobile/app/trip/[id].tsx'), /<RideReadyCard items=\{readiness\.items\}/);
  assert.doesNotMatch(read('mobile/app/ride/[id].tsx'), /battery-optimisation/);
  assert.match(read('mobile/src/hooks/useRideReadiness.ts'), /report_ride_readiness/);
});
