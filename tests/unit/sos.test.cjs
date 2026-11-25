const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

test('recipients: contact, sweep, captain; deduped; never yourself', () => {
  const list = shared.mergeSosRecipients([
    { name: 'Ravi', phone: '98765 00001', role: 'captain' },
    { name: 'Emergency contact', phone: '+91 90000 11111', role: 'emergency_contact' },
    { name: 'Sam', phone: '98765 00003', role: 'sweeper' },
    { name: 'Dup', phone: '+919876500001', role: 'co-captain' },
    { name: 'Me', phone: '98765 99999', role: 'captain' },
    { name: 'Bad', phone: '123', role: 'captain' },
  ], '+91 98765 99999');
  assert.deepEqual(list.map(r => r.role), ['emergency_contact', 'sweep', 'captain']);
  assert.equal(list[2].phone, '+919876500001');
});

test('one composer for several people, per platform', () => {
  assert.equal(shared.smsComposerUrl(['+911', '+912'], 'Help me', 'android'), 'sms:+911;+912?body=Help%20me');
  assert.equal(shared.smsComposerUrl(['+911', '+912'], 'Help', 'ios'), 'sms:+911,+912&body=Help');
});

test('SOS steps use the shared status words', () => {
  const recipients = [{ name: 'Amma', phone: '+911', role: 'emergency_contact' }, { name: 'Sam', phone: '+912', role: 'sweep' }];
  assert.equal(shared.sosPrimaryLabel({ online: false, recipients: 3 }), 'No signal: tap Send to text 3 people');
  assert.equal(shared.sosPrimaryLabel({ online: true, recipients: 3 }), 'Send SOS');
  const offline = shared.sosSteps({ pack: 'queued', composer: 'opened', server: 'off', recipients });
  assert.deepEqual(offline.map(s => s.status), ['Waiting for signal', 'Tap Send in Messages']);
  const online = shared.sosSteps({ pack: 'sent', composer: 'opened', server: 'sent', recipients });
  assert.deepEqual(online.map(s => s.status), ['Sent', 'Sent by SMS', 'Tap Send in Messages']);
  assert.match(online[1].label, /Amma, Sam/);
});

test('emergency SMS still goes with no GPS fix', () => {
  const text = shared.formatEmergencySms({ riderName: 'Asha', rideName: 'Leh', latitude: null, longitude: null });
  assert.match(text, /no GPS fix yet/);
  const old = shared.formatEmergencySms({ riderName: 'Asha', rideName: 'Leh', latitude: 32.1, longitude: 77.2, locationAgeMinutes: 12 });
  assert.match(old, /Last known GPS location \(12 min ago\)/);
});
