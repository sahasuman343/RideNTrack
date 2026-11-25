const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

test('codes are normalised and checked against the readable alphabet', () => {
  assert.equal(shared.normaliseReferralCode(' ab3-k9z '), 'AB3K9Z');
  assert.equal(shared.normaliseReferralCode('AB0K9Z'), null); // 0 is not in the alphabet
  assert.equal(shared.normaliseReferralCode('ABC'), null);
  assert.equal(shared.referralCodeFrom('https://ridentrack.app/register?ref=xk7p2m&src=recap'), 'XK7P2M');
  assert.equal(shared.referralCodeFrom('xk7p2m'), 'XK7P2M');
  assert.equal(shared.referralSourceFrom('spectator'), 'spectator');
  assert.equal(shared.referralSourceFrom('evil'), 'typed');
});

test('links and share text', () => {
  assert.equal(shared.referralLink('https://ridentrack.app/', 'XK7P2M', 'recap'), 'https://ridentrack.app/register?ref=XK7P2M&src=recap');
  const msg = shared.referralShareMessage({ rideName: 'Spiti loop', distanceKm: 712.4, link: 'L' });
  assert.equal(msg, 'Just finished Spiti loop (712 km) with RideNTrack. Plan your own ride: L');
  assert.match(shared.referralShareMessage({ link: 'L' }), /^I plan and track/);
  assert.equal(shared.referralCountText(1), '1 rider has joined with your link.');
});

test('sign-up carries a valid code in the account metadata and drops a bad one', async () => {
  const calls = [];
  const client = {
    rpc: async () => ({ data: true, error: null }),
    auth: { signUp: async payload => { calls.push(payload); return { data: { session: null }, error: null }; } },
  };
  await shared.registerAccount(client, { email: 'a@b.c', password: 'secret1', username: 'asha', displayName: 'Asha', referralCode: 'xk7p2m', referralSource: 'spectator' });
  assert.deepEqual(calls[0].options.data, { username: 'asha', display_name: 'Asha', referral_code: 'XK7P2M', referral_source: 'spectator' });
  await shared.registerAccount(client, { email: 'a@b.c', password: 'secret1', username: 'asha', displayName: 'Asha', referralCode: 'nope' });
  assert.deepEqual(calls[1].options.data, { username: 'asha', display_name: 'Asha' });
});
