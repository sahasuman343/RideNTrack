const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loader } = require('./loader.cjs');

const rzp = loader()('supabase/functions/_shared/razorpay.ts');
const billing = loader()('supabase/functions/_shared/billing.ts');
const REG = '11111111-1111-4111-8111-111111111111';
const CLUB = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

test('payment link body: exact amount, reference, expiry before the ride', () => {
  const now = Date.parse('2027-06-01T00:00:00Z');
  const body = rzp.paymentLinkRequest({ registrationId: REG, rideId: 'r', rideName: 'Spiti loop', amountPaise: 150000, rideStartIso: '2027-06-02T00:00:00Z', nowMs: now });
  assert.equal(body.amount, 150000);
  assert.equal(body.accept_partial, false);
  assert.equal(body.reference_id, REG);
  assert.equal(body.expire_by, Date.parse('2027-06-02T00:00:00Z') / 1000);
  const later = rzp.paymentLinkRequest({ registrationId: REG, rideId: 'r', rideName: 'x', amountPaise: 100, rideStartIso: '2027-07-01', nowMs: now });
  assert.equal(later.expire_by, (now + 2 * 86400000) / 1000);
});

test('webhook signature is checked against the raw body', async () => {
  const raw = JSON.stringify({ event: 'payment_link.paid' });
  const sig = crypto.createHmac('sha256', 'whsec').update(raw).digest('hex');
  assert.equal(await rzp.verifyRazorpaySignature(raw, sig, 'whsec'), true);
  assert.equal(await rzp.verifyRazorpaySignature(raw + ' ', sig, 'whsec'), false);
  assert.equal(await rzp.verifyRazorpaySignature(raw, sig, ''), false);
  assert.equal(await rzp.verifyRazorpaySignature(raw, null, 'whsec'), false);
});

test('webhook events map to registration changes', () => {
  const paid = rzp.registrationActionFor({ event: 'payment_link.paid', payload: { payment_link: { entity: { reference_id: REG, amount_paid: 150000 } }, payment: { entity: { id: 'pay_1' } } } });
  assert.deepEqual(paid, { kind: 'apply', registrationId: REG, status: 'paid', paymentId: 'pay_1', amountPaise: 150000 });
  assert.equal(rzp.registrationActionFor({ event: 'payment_link.expired', payload: { payment_link: { entity: { reference_id: REG } } } }).status, 'cancelled');
  assert.equal(rzp.registrationActionFor({ event: 'refund.processed', payload: { refund: { entity: { payment_id: 'pay_1', notes: { registration_id: REG } } } } }).status, 'refunded');
  assert.equal(rzp.registrationActionFor({ event: 'payment_link.paid', payload: {} }).kind, 'ignore');
  assert.equal(rzp.registrationActionFor({ event: 'order.paid', payload: { payment_link: { entity: { reference_id: REG } } } }).kind, 'ignore');
});

test('club plan purchases unlock the club named at purchase time', () => {
  const base = { id: 'e1', app_user_id: USER, product_id: billing.PRODUCT_IDS.clubMonthly, expiration_at_ms: Date.now() + 86400000, subscriber_attributes: { pending_club_id: { value: CLUB } } };
  assert.deepEqual({ ...billing.billingActionFor({ ...base, type: 'INITIAL_PURCHASE' }), expiresAt: null }, { kind: 'set_club_plan', userId: USER, clubId: CLUB, active: true, expiresAt: null });
  assert.equal(billing.billingActionFor({ ...base, type: 'EXPIRATION' }).active, false);
  assert.equal(billing.billingActionFor({ ...base, type: 'INITIAL_PURCHASE', subscriber_attributes: {} }).kind, 'ignore');
  // A club plan never changes the buyer's own tier.
  assert.notEqual(billing.billingActionFor({ ...base, type: 'RENEWAL' }).kind, 'set_tier');
});

const shared = loader()('shared/types.ts');

test('money and registration words', () => {
  assert.equal(shared.formatInr(150000), '₹1,500');
  assert.equal(shared.formatInr(150050), '₹1,500.5');
  assert.equal(shared.parseFeeInr('₹ 1,500'), 1500);
  assert.equal(shared.parseFeeInr('12.345'), null);
  assert.equal(shared.parseFeeInr('0'), null);
  const base = { fee_paise: 150000, capacity: 20, note: 'Covers the stay', paid_count: 19, my_status: null };
  assert.deepEqual(shared.riderRegistrationState(base), { action: 'Register · ₹1,500', detail: 'Covers the stay. Paid securely through Razorpay. 1 spot left.', tone: 'none' });
  assert.equal(shared.riderRegistrationState({ ...base, paid_count: 20 }).tone, 'full');
  assert.equal(shared.riderRegistrationState({ ...base, my_status: 'paid', paid_count: 20 }).detail, 'Registered. ₹1,500 paid.');
  assert.equal(shared.riderRegistrationState({ ...base, my_status: 'pending' }).action, 'Finish paying ₹1,500');
  assert.equal(shared.captainRegistrationLine({ ...base, collected_paise: 2850000 }), '19 of 20 paid · ₹28,500 collected');
});

test('F19: store prices win; rupees only as an Indian fallback', () => {
  assert.equal(shared.priceText('pro_monthly', { pro_monthly: '$2.99' }, 'US', '/mo'), '$2.99/mo');
  assert.equal(shared.priceText('pro_monthly', {}, 'IN', '/mo'), '₹199/mo');
  assert.equal(shared.priceText('pro_monthly', {}, null, '/mo'), '₹199/mo');
  assert.equal(shared.priceText('pro_monthly', {}, 'GB', '/mo'), null);
  assert.equal(shared.priceText('club_monthly', {}, 'IN'), null);
  assert.match(shared.proPriceSentence({}, 'DE'), /prices are shown in your store/);
  assert.equal(shared.proPriceSentence({ pro_monthly: '€2.49', expedition_pass: '€1.29' }, 'DE'), 'Pro Tourer €2.49/month, or an Expedition Pass for €1.29 a trip.');
});
