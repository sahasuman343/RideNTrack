const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const billing = loader()('supabase/functions/_shared/billing.ts');
const USER = '11111111-2222-4333-8444-555555555555';
const RIDE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = Date.parse('2026-12-01T00:00:00Z');
const ev = over => ({ id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: USER, product_id: 'ridentrack_pro_monthly', expiration_at_ms: NOW + 86400000, ...over });

test('pro purchase and renewal set the tier with expiry', () => {
  const a = billing.billingActionFor(ev({}), NOW);
  assert.equal(a.kind, 'set_tier');
  assert.equal(a.tier, 'pro_tourer');
  assert.equal(a.expiresAt, new Date(NOW + 86400000).toISOString());
  assert.equal(billing.billingActionFor(ev({ type: 'RENEWAL', product_id: 'other', entitlement_ids: ['pro_tourer'] }), NOW).tier, 'pro_tourer');
});

test('cancellation keeps access, expiration and refund end it', () => {
  assert.equal(billing.billingActionFor(ev({ type: 'CANCELLATION' }), NOW).kind, 'ignore');
  assert.equal(billing.billingActionFor(ev({ type: 'EXPIRATION' }), NOW).tier, 'free');
  assert.equal(billing.billingActionFor(ev({ type: 'REFUND' }), NOW).tier, 'free');
  assert.equal(billing.billingActionFor(ev({ type: 'RENEWAL', expiration_at_ms: NOW - 1000 }), NOW).tier, 'free', 'late event already expired');
});

test('anonymous users and unknown products are ignored', () => {
  assert.equal(billing.billingActionFor(ev({ app_user_id: '$RCAnonymousID:abc' }), NOW).kind, 'ignore');
  assert.equal(billing.billingActionFor(ev({ product_id: 'mystery' }), NOW).kind, 'ignore');
});

test('expedition pass needs a ride and a transaction', () => {
  const base = { product_id: 'ridentrack_expedition_pass', type: 'NON_RENEWING_PURCHASE', transaction_id: 'GPA.1' };
  assert.equal(billing.billingActionFor(ev(base), NOW).reason, 'pass_without_ride');
  const grant = billing.billingActionFor(ev({ ...base, subscriber_attributes: { pending_pass_ride_id: { value: RIDE } } }), NOW);
  assert.deepEqual(grant, { kind: 'grant_pass', userId: USER, rideId: RIDE, transactionId: 'GPA.1' });
  assert.equal(billing.billingActionFor(ev({ ...base, type: 'REFUND' }), NOW).kind, 'revoke_pass');
  assert.equal(billing.billingActionFor(ev({ ...base, transaction_id: null }), NOW).reason, 'missing_transaction');
});
