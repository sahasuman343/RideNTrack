const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const hook = loader()('supabase/functions/_shared/authSms.ts');

function fakeClient({ available = true, otpError = null, verifyError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: available, error: null }; },
    auth: {
      signInWithOtp: async (payload) => { calls.push(['otp', payload]); return { error: otpError }; },
      verifyOtp: async (payload) => { calls.push(['verify', payload]); return { data: { session: verifyError ? null : { access_token: 't' } }, error: verifyError }; },
    },
  };
}

test('typed numbers normalise to E.164, Indian 10-digit by default', () => {
  assert.equal(shared.normaliseLoginPhone('98765 43210'), '+919876543210');
  assert.equal(shared.normaliseLoginPhone('+91 98765-43210'), '+919876543210');
  assert.equal(shared.normaliseLoginPhone('12345'), null);
  assert.equal(shared.phoneProblem(''), 'Enter your mobile number.');
  assert.match(shared.phoneProblem('5876543210'), /10-digit/);
  assert.equal(shared.phoneProblem('9876543210'), null);
  assert.equal(shared.formatLoginPhone('919876543210'), '+91 98765 43210');
  assert.ok(shared.samePhone('+919876543210', '919876543210'));
});

test('codes keep digits only and need all six', () => {
  assert.equal(shared.cleanOtp(' 123-456 '), '123456');
  assert.equal(shared.cleanOtp('1234567890'), '123456');
  assert.match(shared.otpProblem('123'), /6 digits/);
  assert.equal(shared.otpProblem('123456'), null);
});

test('sign-in never creates an account for an unknown number', async () => {
  const client = fakeClient();
  assert.equal(await shared.sendSignInCode(client, '9876543210'), '+919876543210');
  assert.deepEqual(client.calls[0], ['otp', { phone: '+919876543210', options: { shouldCreateUser: false } }]);
  await assert.rejects(shared.sendSignInCode(client, '123'), e => e.code === 'phone_invalid');
});

test('phone sign-up checks the username and sends it as metadata with the referral', async () => {
  const client = fakeClient();
  await shared.sendSignUpCode(client, { phone: '9876543210', username: ' asha ', displayName: 'Asha', referralCode: 'abcdef', referralSource: 'recap' });
  assert.deepEqual(client.calls[0], ['rpc', 'is_username_available', { requested_username: 'asha' }]);
  assert.deepEqual(client.calls[1][1].options, {
    shouldCreateUser: true,
    data: { username: 'asha', display_name: 'Asha', referral_code: 'ABCDEF', referral_source: 'recap' },
  });
  await assert.rejects(
    shared.sendSignUpCode(fakeClient({ available: false }), { phone: '9876543210', username: 'asha', displayName: 'Asha' }),
    e => e instanceof shared.UsernameUnavailableError,
  );
});

test('verify sends a clean code and keeps Supabase error codes', async () => {
  const client = fakeClient();
  await shared.verifyPhoneCode(client, '+919876543210', '12 34 56');
  assert.deepEqual(client.calls[0], ['verify', { phone: '+919876543210', token: '123456', type: 'sms' }]);
  await assert.rejects(
    shared.verifyPhoneCode(fakeClient({ verifyError: { message: 'Token has expired or is invalid', code: 'otp_expired', status: 403 } }), '+919876543210', '123456'),
    e => e.code === 'otp_expired',
  );
  await assert.rejects(shared.verifyPhoneCode(client, '+919876543210', '12'), e => e.code === 'otp_incomplete');
});

test('phone problems get plain words and point at the right field', () => {
  const unknown = shared.authProblem({ code: 'otp_disabled', message: 'Signups not allowed for otp' }, 'sign_in');
  assert.equal(unknown.title, 'No account with this number');
  assert.equal(unknown.next, 'go_register');
  assert.equal(shared.authProblem({ code: 'otp_expired' }, 'sign_in').field, 'code');
  assert.equal(shared.authProblem({ code: 'phone_exists' }, 'sign_in').field, 'phone');
  assert.equal(shared.authProblem({ code: 'over_sms_send_rate_limit' }, 'sign_in').kind, 'wait');
  assert.equal(shared.authProblem({ message: hook.capReasonResponse('phone_daily_cap').message }, 'sign_in').kind, 'wait');
  assert.equal(shared.authProblem({ message: hook.capReasonResponse('global_daily_cap').message }, 'sign_in').kind, 'setup');
  assert.equal(shared.authProblem({ message: hook.capReasonResponse('disabled').message }, 'sign_in').kind, 'setup');
  assert.equal(shared.authProblem({ message: hook.capReasonResponse('send_failed').message }, 'sign_in').kind, 'setup');
  assert.match(shared.authProblem({ message: hook.capReasonResponse('country_not_allowed').message }, 'sign_in').message, /\+91/);
  // Email problems are unchanged.
  assert.equal(shared.authProblem({ message: 'User already registered' }, 'sign_up').field, 'email');
  assert.equal(shared.authProblem({ code: 'invalid_credentials' }, 'sign_in').field, 'password');
});

test('the SMS hook texts the new number on a phone change, never logs the code', () => {
  assert.equal(hook.hookRecipient({ user: { phone: '919876543210' }, sms: { otp: '123456' } }), '+919876543210');
  assert.equal(hook.hookRecipient({ user: { phone: '919876543210', phone_change: '919000000001' }, sms: { otp: '1', sms_type: 'phone_change' } }), '+919000000001');
  assert.equal(hook.hookRecipient({ user: { phone_change: '919000000001' }, sms: {} }), '+919000000001');
  assert.equal(hook.hookRecipient({ user: {} }), null);
  assert.equal(hook.hookOtp({ sms: { otp: '123456' } }), '123456');
  assert.equal(hook.hookOtp({ sms: { otp: 'abc' } }), null);
  const req = hook.buildAuthOtpRequest('+919876543210', '654321', { DLT_TEMPLATE_AUTH_OTP: 'flow-1' });
  assert.equal(req.text, '654321 is your RideNTrack sign-in code. Do not share it with anyone. - RideNTrack');
  assert.deepEqual(req.vars, ['654321']);
  assert.equal(req.dltTemplateId, 'flow-1');
});

test('sign-in codes use the same MSG91 flow API as server SMS', async () => {
  const outbound = loader()('supabase/functions/_shared/outbound.ts');
  let sent;
  const provider = outbound.msg91Provider({ MSG91_AUTH_KEY: 'k' });
  const result = await provider.send(hook.buildAuthOtpRequest('+919876543210', '654321', { DLT_TEMPLATE_AUTH_OTP: 'flow-1' }), async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ type: 'success', request_id: 'r1' }) };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.body, { template_id: 'flow-1', short_url: '0', recipients: [{ mobiles: '919876543210', VAR1: '654321' }] });
});
