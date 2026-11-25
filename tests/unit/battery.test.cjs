const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const b = loader()('shared/battery.ts');
const ra = loader()('shared/rideAttention.ts');

test('profile follows role and stops', () => {
  assert.equal(b.profileForRole('captain'), 'high');
  assert.equal(b.profileForRole('sweeper'), 'high');
  assert.equal(b.profileForRole('member'), 'balanced');
  assert.equal(b.profileForRole(null), 'balanced');
  assert.equal(b.profileForRole('captain', { stoppedForMs: 4 * 60000 }), 'stopped');
  assert.equal(b.profileForRole('member', { stoppedForMs: 60000 }), 'balanced');
});

test('profile switches are debounced to one a minute', () => {
  assert.equal(b.shouldSwitchProfile(null, 'high', null, 0), true);
  assert.equal(b.shouldSwitchProfile('high', 'high', 0, 999999), false);
  assert.equal(b.shouldSwitchProfile('high', 'stopped', 1000, 30000), false);
  assert.equal(b.shouldSwitchProfile('high', 'stopped', 1000, 61001), true);
});

test('estimate is one sentence and warns when it will not last', () => {
  const member = b.estimateBattery({ role: 'member', hours: 8 });
  assert.match(member.sentence, /^About \d+% over 8 hours\.$/);
  assert.ok(member.usedPercent >= 30 && member.usedPercent <= 60, String(member.usedPercent));
  const lead = b.estimateBattery({ role: 'captain', hours: 8 });
  assert.ok(lead.usedPercent > member.usedPercent);
  const full = b.estimateBattery({ role: 'member', hours: 8, levelPercent: 95 });
  assert.match(full.sentence, /finish near \d+%/);
  const low = b.estimateBattery({ role: 'captain', hours: 10, levelPercent: 40 });
  assert.equal(low.enough, false);
  assert.match(low.sentence, /power bank/);
});

test('low battery attention item', () => {
  const item = ra.lowBatteryAttention(18, 3.2, '2026-12-10T08:00:00Z');
  assert.equal(item.kind, 'low_battery');
  assert.equal(item.id, 'battery:low');
  assert.match(item.body, /3.2 h/);
  assert.equal(ra.lowBatteryAttention(8, 1, '2026-12-10T08:00:00Z').id, 'battery:critical');
});
