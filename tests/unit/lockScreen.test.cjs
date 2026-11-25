const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

test('card shows blood group, ICE and the captain, in that order', () => {
  const card = shared.lockScreenCard({
    riderName: 'Asha Rao', bloodGroup: 'o+', emergencyContact: '+91 98765 43210', captain: { name: 'Ravi Kumar', phone: '+919876500001' },
  });
  assert.equal(card.title, 'In an emergency: Asha Rao');
  assert.equal(card.body, 'Blood O+ · ICE +91 98765 43210 · Ride captain Ravi +919876500001');
});

test('nothing to show means no card, and long text stays short', () => {
  assert.equal(shared.lockScreenCard({ riderName: 'Asha' }), null);
  const long = shared.lockScreenCard({ riderName: 'Asha', emergencyContact: '9'.repeat(200) });
  assert.ok(long.body.length <= shared.LOCK_SCREEN_BODY_MAX);
  assert.ok(long.body.endsWith('…'));
});

test('without the card the notification is the usual live-ride one', () => {
  assert.equal(shared.liveRideNotification(3).body, 'Live pack: 3 riders active');
  assert.equal(shared.liveRideNotification(0).body, 'Your group can see your position.');
  const bg = fs.readFileSync('mobile/src/services/backgroundLocation.ts', 'utf8');
  assert.match(bg, /params\.lockScreenCard \?\? liveRideNotification/);
  // Off by default and stored per phone.
  const setting = fs.readFileSync('mobile/src/services/lockScreenCard.ts', 'utf8');
  assert.match(setting, /=== '1'/);
});
