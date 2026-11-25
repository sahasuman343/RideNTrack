const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const NOW = Date.parse('2026-12-10T08:00:00Z');

test('family phone numbers normalise like the server', () => {
  assert.equal(shared.normaliseFamilyPhone('98765 43210'), '+919876543210');
  assert.equal(shared.normaliseFamilyPhone('+44 7700 900123'), '+447700900123');
  assert.equal(shared.normaliseFamilyPhone('12345'), null);
  assert.equal(shared.formatPhoneForDisplay('+919876543210'), '+91 98765 43210');
});

test('family summary uses the shared status words', () => {
  const contacts = [{ id: '1', name: 'Amma', phone: '+919876543210', relation: null, paused: false }];
  assert.equal(shared.familyUpdateSummary([], []).tone, 'none');
  assert.match(shared.familyUpdateSummary([], contacts).detail, /Amma will get a text/);
  const sent = shared.familyUpdateSummary([{ template: 'family_ride_started', status: 'sent', recipient_label: 'Amma', created_at: '2026-12-10T07:00:00Z' }], contacts);
  assert.equal(sent.headline, 'Ride started: Sent by SMS');
  const failed = shared.familyUpdateSummary([{ template: 'family_reached_stay', status: 'failed', recipient_label: 'Amma', created_at: '2026-12-10T07:00:00Z' }], contacts);
  assert.equal(failed.tone, 'failed');
  assert.equal(shared.familyUpdateSummary([], [{ ...contacts[0], paused: true }]).headline, 'Family updates paused');
});

test('spectator page explains live, dead zone and next stop', () => {
  const base = {
    subject: { user_id: 'u1', display_name: 'Asha' },
    ride: { name: 'Leh run', status: 'active' },
    waypoints: [
      { name: 'Start', latitude: 32.0, longitude: 77.0, sequence: 0, waypoint_type: 'origin' },
      { name: 'Keylong', latitude: 32.5, longitude: 77.0, sequence: 1 },
      { name: 'Sarchu', latitude: 33.0, longitude: 77.0, sequence: 2 },
    ],
    stays: [{ name: 'Sarchu camp', latitude: 33.0, longitude: 77.0 }],
    now: NOW,
  };
  const live = shared.spectatorView({ ...base, participants: [{ user_id: 'u1', display_name: 'Asha', lat: 32.2, lng: 77.0, timestamp: new Date(NOW - 30000).toISOString() }] });
  assert.equal(live.title, 'Asha is riding');
  assert.equal(live.nextStop.name, 'Keylong');
  assert.match(live.nextStop.etaText, /min away/);
  const dark = shared.spectatorView({ ...base, participants: [{ user_id: 'u1', display_name: 'Asha', lat: 32.2, lng: 77.0, timestamp: new Date(NOW - 25 * 60000).toISOString() }] });
  assert.equal(dark.presence.state, 'dead_zone');
  assert.match(dark.sentence, /no signal/);
  const stay = shared.spectatorView({ ...base, participants: [{ user_id: 'u1', display_name: 'Asha', lat: 33.0005, lng: 77.0, timestamp: new Date(NOW - 30000).toISOString() }] });
  assert.equal(stay.title, 'Asha reached Sarchu camp');
  assert.equal(shared.spectatorView({ ...base, ride: { name: 'x', status: 'planned' }, participants: [] }).rideState, 'not_started');
});
