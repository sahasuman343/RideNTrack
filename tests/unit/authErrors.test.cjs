const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

test('wrong password points at the password field and offers a retry', () => {
  const p = shared.authProblem({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'sign_in');
  assert.equal(p.title, "That didn't match");
  assert.equal(p.field, 'password');
  assert.equal(p.next, 'retry');
  assert.equal(p.kind, 'error');
});

test('unconfirmed email offers to resend the link, matched by code or message', () => {
  assert.equal(shared.authProblem({ code: 'email_not_confirmed' }, 'sign_in').next, 'resend_confirmation');
  assert.equal(shared.authProblem({ message: 'Email not confirmed' }, 'sign_in').next, 'resend_confirmation');
});

test('an existing account on sign up sends the rider to sign in', () => {
  for (const code of ['user_already_exists', 'email_exists']) {
    const p = shared.authProblem({ code }, 'sign_up');
    assert.equal(p.next, 'go_sign_in');
    assert.equal(p.field, 'email');
  }
});

test('username taken, rate limits, offline and bad keys get their own words', () => {
  assert.equal(shared.authProblem(new shared.UsernameUnavailableError(), 'sign_up').field, 'username');
  assert.equal(shared.authProblem({ status: 429, message: 'x' }, 'sign_in').kind, 'wait');
  assert.equal(shared.authProblem({ message: 'Network request failed' }, 'sign_in').kind, 'offline');
  assert.equal(shared.authProblem({ message: 'Invalid API key' }, 'sign_in').kind, 'setup');
});

test('unknown errors fall back to a mode-specific title with the original message', () => {
  const p = shared.authProblem({ message: 'Database is sleeping' }, 'sign_up');
  assert.equal(p.title, 'Could not create your account');
  assert.equal(p.message, 'Database is sleeping');
  assert.equal(shared.authProblem(null, 'sign_in').title, 'Could not sign you in');
});

test('field checks run before anything is sent', () => {
  assert.deepEqual(shared.validateSignIn({ email: 'a@b.co', password: 'x' }), {});
  assert.ok(shared.validateSignIn({ email: 'a@b', password: '' }).email);
  const e = shared.validateSignUp({ email: '', password: '123', username: 'a b', displayName: ' ' });
  assert.deepEqual(Object.keys(e).sort(), ['displayName', 'email', 'password', 'username']);
  assert.deepEqual(shared.validateSignUp({ email: 'asha@example.test', password: 'long-enough', username: 'asha.rides', displayName: 'Asha' }), {});
});

test('sign up with an already registered email (hidden by Supabase) throws user_already_exists', async () => {
  const client = {
    rpc: async () => ({ data: true, error: null }),
    auth: { signUp: async () => ({ data: { user: { id: 'u1', identities: [] }, session: null }, error: null }) },
  };
  await assert.rejects(
    shared.registerAccount(client, { email: 'asha@example.test', password: ['a', 'b', 'c', 'd', 'e', 'f'].join(''), username: 'asha', displayName: 'Asha' }),
    (err) => err.code === 'user_already_exists',
  );
});
