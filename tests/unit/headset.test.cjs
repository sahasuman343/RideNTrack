const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const now = Date.parse('2027-07-04T05:30:00Z');
const base = {
  now, todayIso: '2027-07-04', deviceName: 'Cardo PACKTALK EDGE', allowedDevices: [], sharing: false, lastPromptAt: null,
  rides: [{ id: 'r1', name: 'Sunday dawn ride', status: 'planned', start_date: '2027-07-04' }],
};

test('asks for today\'s ride when a helmet headset connects', () => {
  const p = shared.headsetPromptFor(base);
  assert.equal(p.ride.id, 'r1');
  assert.equal(p.title, 'Riding Sunday dawn ride today?');
  assert.match(p.body, /Nothing is shared until you start/);
});

test('stays quiet for earbuds, no ride today, when sharing, or right after asking', () => {
  assert.equal(shared.headsetPromptFor({ ...base, deviceName: 'Galaxy Buds2' }), null);
  assert.equal(shared.headsetPromptFor({ ...base, rides: [{ ...base.rides[0], start_date: '2027-07-05' }] }), null);
  assert.equal(shared.headsetPromptFor({ ...base, sharing: true }), null);
  assert.equal(shared.headsetPromptFor({ ...base, lastPromptAt: now - 60 * 60 * 1000 }), null);
  assert.ok(shared.headsetPromptFor({ ...base, lastPromptAt: now - 4 * 60 * 60 * 1000 }));
});

test('a chosen device list overrides the name guess; an active ride wins', () => {
  assert.ok(shared.headsetPromptFor({ ...base, deviceName: 'My JBL', allowedDevices: ['my jbl'] }));
  assert.equal(shared.headsetPromptFor({ ...base, allowedDevices: ['Other'] }), null);
  const p = shared.headsetPromptFor({ ...base, rides: [...base.rides, { id: 'r0', name: 'Ghat run', status: 'active', start_date: '2027-07-03' }] });
  assert.equal(p.ride.id, 'r0');
  assert.match(p.title, /is on/);
});
