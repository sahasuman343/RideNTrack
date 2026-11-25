const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const outbound = loader()('supabase/functions/_shared/outbound.ts');

test('phone numbers normalise to E.164 without guessing', () => {
  assert.equal(outbound.normalisePhone('98765 43210'), '+919876543210');
  assert.equal(outbound.normalisePhone('09876543210'), '+919876543210');
  assert.equal(outbound.normalisePhone('919876543210'), '+919876543210');
  assert.equal(outbound.normalisePhone('+44 7700 900123'), '+447700900123');
  assert.equal(outbound.normalisePhone('0044 7700 900123'), '+447700900123');
  assert.equal(outbound.normalisePhone('12345'), null);
  assert.equal(outbound.normalisePhone('5876543210'), null, 'Indian mobiles start 6-9');
  assert.equal(outbound.normalisePhone(''), null);
});

test('templates render fixed DLT text with clipped variables', () => {
  const text = outbound.renderTemplate('sos_alert', { rider: 'Asha', ride: 'Manali to Leh', maps: 'https://maps.google.com/?q=32.1,77.2' });
  assert.equal(text, 'EMERGENCY: Asha on Manali to Leh needs help. Location: https://maps.google.com/?q=32.1,77.2 - RideNTrack');
  const vars = outbound.templateVars('family_ride_started', { rider: 'A very long rider name that goes on and on', ride: 'x', link: 'https://ridentrack.app/track/abc' });
  assert.equal(vars[0].length, 30);
  assert.ok(vars[0].endsWith('…'));
  for (const [name, spec] of Object.entries(outbound.TEMPLATES)) {
    const placeholders = spec.text.match(/\{#[a-z]+#\}/g) || [];
    assert.equal(placeholders.length, spec.vars.length, `${name} placeholders match vars`);
    assert.match(spec.dltEnv, /^DLT_TEMPLATE_[A-Z_]+$/);
  }
});

test('MSG91 adapter sends the DLT flow with VARn variables and reports failures', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ type: 'success', request_id: 'req-1' }) };
  };
  const env = { SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', DLT_TEMPLATE_SOS_ALERT: 'tmpl-1' };
  const provider = outbound.providerFromEnv(env);
  assert.equal(provider.name, 'msg91');
  const req = outbound.buildSendRequest('sos_alert', '+919876543210', { rider: 'Asha', ride: 'Spiti', maps: 'm' }, env);
  const result = await provider.send(req, fakeFetch);
  assert.deepEqual(result, { ok: true, providerId: 'req-1' });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.template_id, 'tmpl-1');
  assert.deepEqual(sent.recipients[0], { mobiles: '919876543210', VAR1: 'Asha', VAR2: 'Spiti', VAR3: 'm' });
  assert.equal(calls[0].init.headers.authkey, 'k');

  const failing = async () => ({ ok: false, status: 503, json: async () => ({ type: 'error', message: 'busy' }) });
  const failed = await provider.send(req, failing);
  assert.equal(failed.ok, false);
  assert.equal(failed.retryable, true);

  const noTemplate = outbound.buildSendRequest('crash_alert', '+919876543210', {}, env);
  assert.equal((await provider.send(noTemplate, fakeFetch)).reason, 'dlt_template_missing');
  assert.equal((await outbound.providerFromEnv({ SMS_PROVIDER: 'msg91' }).send(req, fakeFetch)).reason, 'provider_not_configured');
});

test('provider defaults to a dry run that never contacts anyone', async () => {
  const provider = outbound.providerFromEnv({});
  assert.equal(provider.name, 'dry_run');
  let called = false;
  const result = await provider.send({}, async () => { called = true; });
  assert.equal(called, false);
  assert.equal(result.ok, false);
});

test('Gupshup adapter posts the DLT template id and parses success', async () => {
  let body = '';
  const provider = outbound.providerFromEnv({ SMS_PROVIDER: 'gupshup', GUPSHUP_USER_ID: 'u', GUPSHUP_PASSWORD: 'p', DLT_TEMPLATE_SOS_ALERT: 't' });
  const req = outbound.buildSendRequest('sos_alert', '+919876543210', { rider: 'A', ride: 'B', maps: 'C' }, { DLT_TEMPLATE_SOS_ALERT: 't' });
  const result = await provider.send(req, async (_url, init) => { body = init.body; return { ok: true, status: 200, text: async () => 'success | 919876543210 | 123456' }; });
  assert.equal(result.ok, true);
  assert.equal(result.providerId, '123456');
  assert.match(body, /dltTemplateId=t/);
});
