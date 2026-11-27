const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const wl = loader()('supabase/functions/_shared/waitlist.ts');
const headers = obj => ({ get: k => obj[k.toLowerCase()] ?? null });

test('client IP comes from the first forwarded entry', () => {
  assert.equal(wl.clientIp(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9');
  assert.equal(wl.clientIp(headers({ 'cf-connecting-ip': '198.51.100.2' })), '198.51.100.2');
  assert.equal(wl.clientIp(headers({})), 'unknown');
});

test('IP hash is salted hex and never the IP', async () => {
  const a = await wl.ipHash('203.0.113.9', 'salt-1');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await wl.ipHash('203.0.113.9', 'salt-2'));
  assert.ok(!a.includes('203'));
});

test('Turnstile: only success true passes; errors and empty tokens fail', async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, body: init.body.toString() }; return new Response(JSON.stringify({ success: true })); };
  assert.equal(await wl.verifyTurnstile('tok', 'sec', '203.0.113.9', ok), true);
  assert.equal(sent.url, wl.TURNSTILE_VERIFY_URL);
  assert.match(sent.body, /secret=sec/);
  assert.match(sent.body, /remoteip=203.0.113.9/);
  assert.equal(await wl.verifyTurnstile('tok', 'sec', null, async () => new Response(JSON.stringify({ success: false }))), false);
  assert.equal(await wl.verifyTurnstile('tok', 'sec', null, async () => { throw new Error('down'); }), false);
  assert.equal(await wl.verifyTurnstile('', 'sec', null, ok), false);
  assert.equal(await wl.verifyTurnstile('tok', '', null, ok), false);
});

test('confirmation email links to /waitlist/confirm with the token', () => {
  const m = wl.confirmationEmail({ to: 'a@example.test', from: 'rideNtrack <hi@ridentrack.app>', siteUrl: 'https://ridentrack.app/', token: 'ab'.repeat(32), places: 10, months: 3 });
  assert.equal(m.link, 'https://ridentrack.app/waitlist/confirm?token=' + 'ab'.repeat(32));
  assert.deepEqual(m.to, ['a@example.test']);
  assert.ok(m.text.includes(m.link) && m.html.includes(m.link));
  assert.match(m.text, /first 10 people to confirm get Pro free for 3 months/);
});
