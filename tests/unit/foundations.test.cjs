const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, read } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

const T0 = Date.parse('2027-01-10T06:00:00Z');
const iso = ms => new Date(ms).toISOString();

test('attention queue shows one item at a time, highest priority first', () => {
  const items = [
    { id: 'info', kind: 'info', title: 'GPS restored', createdAt: iso(T0) },
    { id: 'fuel', kind: 'fuel', title: 'Last fuel', createdAt: iso(T0) },
    { id: 'sos', kind: 'incoming_sos', title: 'Asha needs help', createdAt: iso(T0 - 60_000) },
    { id: 'regroup', kind: 'regroup', title: 'Near regroup', createdAt: iso(T0) },
  ];
  const view = shared.selectAttention(items, { now: T0 });
  assert.equal(view.current.id, 'sos');
  assert.equal(view.waiting, 3);
  assert.equal(view.tone, 'danger');
  assert.equal(view.haptic, 'sos');
  assert.deepEqual(shared.rankAttention(items, { now: T0 }).map(i => i.id), ['sos', 'regroup', 'fuel', 'info']);
});

test('crash countdown outranks everything and takes the whole screen', () => {
  const view = shared.selectAttention([
    { id: 'sos', kind: 'incoming_sos', title: 'x', createdAt: iso(T0) },
    { id: 'crash', kind: 'crash_countdown', title: 'Possible crash', createdAt: iso(T0), sticky: true, countdownSeconds: 45 },
  ], { now: T0 });
  assert.equal(view.current.id, 'crash');
  assert.equal(view.fullScreen, true);
});

test('dismissed and expired items drop out, sticky items cannot be dismissed', () => {
  const items = [
    { id: 'a', kind: 'info', title: 'a', createdAt: iso(T0) },
    { id: 'b', kind: 'check_in', title: 'b', createdAt: iso(T0), sticky: true },
    { id: 'c', kind: 'fuel', title: 'c', createdAt: iso(T0), expiresAt: iso(T0 - 1) },
  ];
  const ranked = shared.rankAttention(items, { now: T0, dismissedIds: ['a', 'b'] });
  assert.deepEqual(ranked.map(i => i.id), ['b']);
});

test('the first SOS stays on screen; other kinds show the newest first', () => {
  const ranked = shared.rankAttention([
    { id: 'sos-new', kind: 'incoming_sos', title: 'x', createdAt: iso(T0) },
    { id: 'sos-old', kind: 'incoming_sos', title: 'x', createdAt: iso(T0 - 120_000) },
    { id: 'info-old', kind: 'info', title: 'x', createdAt: iso(T0 - 120_000) },
    { id: 'info-new', kind: 'info', title: 'x', createdAt: iso(T0) },
  ], { now: T0 });
  assert.deepEqual(ranked.map(i => i.id), ['sos-old', 'sos-new', 'info-new', 'info-old']);
});

test('haptics fire once per new top item and only tick when a lower item takes over', () => {
  const sos = { id: 'sos', kind: 'incoming_sos', title: 'x', createdAt: iso(T0) };
  const fuel = { id: 'fuel', kind: 'fuel', title: 'x', createdAt: iso(T0) };
  assert.equal(shared.hapticForTransition(null, sos), 'sos');
  assert.equal(shared.hapticForTransition(sos, sos), 'none');
  assert.equal(shared.hapticForTransition(sos, fuel), 'tick');
  assert.equal(shared.hapticForTransition(fuel, sos), 'sos');
  assert.equal(shared.hapticForTransition(fuel, null), 'none');
});

test('every attention kind has a priority, tone and haptic pattern', () => {
  for (const kind of Object.keys(shared.ATTENTION_PRIORITY)) {
    assert.ok(shared.ATTENTION_TONE[kind], kind);
    assert.ok(shared.ATTENTION_HAPTIC[kind], kind);
  }
});

test('ride alerts become attention items with plain words and the right actions', () => {
  const alerts = [
    { id: 'a1', ride_id: 'r', user_id: 'u2', display_name: 'Asha', type: 'emergency', lat: 32.2, lng: 77.1, location_recorded_at: iso(T0 - 4 * 60_000), created_at: iso(T0 - 60_000) },
    { id: 'a2', ride_id: 'r', user_id: 'u3', display_name: 'Ravi', type: 'announcement', message: 'Chai stop in 5 km', lat: 1, lng: 1, created_at: iso(T0 - 30_000) },
    { id: 'a3', ride_id: 'r', user_id: 'me', display_name: 'Me', type: 'fuel', lat: 1, lng: 1, created_at: iso(T0) },
    { id: 'a4', ride_id: 'r', user_id: 'u4', display_name: 'Old', type: 'fuel', lat: 1, lng: 1, created_at: iso(T0 - 6 * 60_000) },
  ];
  const items = shared.attentionFromAlerts(alerts, { myUserId: 'me', now: T0 });
  assert.equal(items.length, 2, 'own alerts and alerts older than five minutes are skipped');
  const sos = items.find(i => i.id === 'alert:a1');
  assert.equal(sos.kind, 'incoming_sos');
  assert.equal(sos.title, 'Asha needs help');
  assert.match(sos.body, /last known fix, 3 min before/);
  assert.deepEqual(sos.actions.map(a => a.id), ['escalate', 'directions', 'focus']);
  const ann = items.find(i => i.id === 'alert:a2');
  assert.equal(ann.title, 'Chai stop in 5 km');
  assert.deepEqual(ann.actions.map(a => a.id), ['ack']);
  assert.equal(shared.attentionFromAlerts(alerts, { myUserId: 'me', now: T0, acknowledgedIds: ['a2'] }).length, 1, 'acknowledged announcements leave the queue');
});

test('stationary check-in is sticky, counts down and offers a text only when possible', () => {
  const withSms = shared.checkInAttention(87.4, true, iso(T0));
  assert.equal(withSms.sticky, true);
  assert.equal(withSms.countdownSeconds, 87);
  assert.deepEqual(withSms.actions.map(a => a.id), ['ok', 'sms']);
  assert.deepEqual(shared.checkInAttention(10, false, iso(T0)).actions.map(a => a.id), ['ok']);
});

test('one delivery vocabulary: Sent, Sent by SMS, Waiting for signal, Failed', () => {
  assert.equal(shared.DELIVERY_LABELS.sent, 'Sent');
  assert.equal(shared.DELIVERY_LABELS.sent_by_sms, 'Sent by SMS');
  assert.equal(shared.DELIVERY_LABELS.waiting_for_signal, 'Waiting for signal');
  assert.equal(shared.DELIVERY_LABELS.failed, 'Failed');
  assert.equal(shared.deliveryLabel('waiting_for_signal', 'Pack'), 'Pack: Waiting for signal');
  assert.equal(shared.combineDelivery(['failed', 'sent_by_sms']), 'sent_by_sms');
  assert.equal(shared.combineDelivery(['waiting_for_signal', 'sent']), 'sent');
  assert.equal(shared.combineDelivery(['failed']), 'failed');
  assert.equal(shared.combineDelivery([]), 'waiting_for_signal');
});

test('rider presence never shows old data as live', () => {
  assert.equal(shared.riderPresence(iso(T0 - 30_000), T0).label, 'Live');
  assert.equal(shared.riderPresence(iso(T0 - 4 * 60_000), T0).label, '4 min ago');
  const dz = shared.riderPresence(iso(T0 - 25 * 60_000), T0);
  assert.equal(dz.label, 'In dead zone');
  assert.match(dz.sentence, /Last seen 25 min ago/);
  assert.match(shared.riderPresence(iso(T0 - 4 * 60_000), T0, { knownDeadZone: true }).sentence, /known no-signal stretch/);
  assert.equal(shared.riderPresence(null, T0).state, 'unknown');
  assert.match(shared.riderPresence(iso(T0 - 130 * 60_000), T0).sentence, /2 hr 10 min ago/);
});

test('analytics props never carry location, contact details or free text', () => {
  const clean = shared.sanitizeEventProps({
    step: 'roll_call', count: 7, ok: true,
    lat: 32.24, lng: 77.19, user_lat: 1, phone: '9876543210', message: 'hi', display_name: 'Asha',
    sneaky: 32.243912, contact: '+919876543210', email_hint: 'a@b.c', nested: { a: 1 },
    long: 'x'.repeat(200),
  });
  assert.deepEqual(Object.keys(clean).sort(), ['count', 'long', 'ok', 'step']);
  assert.equal(clean.long.length, 64);
  assert.equal(shared.isAnalyticsEvent('ride_started'), true);
  assert.equal(shared.isAnalyticsEvent('made_up'), false);
});

test('feature flags: remote wins over defaults, overrides win over remote, unknown keys ignored', () => {
  const flags = shared.resolveFlags(
    [{ key: 'crash_detection_beta', enabled: true }, { key: 'not_a_flag', enabled: true }, { key: 'voice_notes', enabled: 'yes' }],
    shared.parseFlagOverrides('server_sms=1, voice_notes=0, nope=1'),
  );
  assert.equal(flags.crash_detection_beta, true);
  assert.equal(flags.server_sms, true);
  assert.equal(flags.voice_notes, false);
  assert.equal(flags.not_a_flag, undefined);
  assert.equal(shared.resolveFlags(null).free_safety_features, true, 'decision 3 default: safety stays free');
  assert.equal(shared.resolveFlags(null).store_billing, false, 'billing waits for store accounts');
  const b = shared.rolloutBucket('crash_detection_beta', 'user-1');
  assert.ok(b >= 0 && b < 100);
  assert.equal(b, shared.rolloutBucket('crash_detection_beta', 'user-1'));
});

test('ride screen is split: no banner bypasses the attention bar and the HUD is throttled', () => {
  const screen = read('mobile/app/ride/[id].tsx');
  assert.ok(screen.split('\n').length < 1700, 'ride screen stays split into hooks and components');
  for (const legacy of ['floatingAlertBanner', 'regroupBanner', 'deviationWarning', 'arrivalToast', 's.warning,']) {
    assert.ok(!screen.includes(legacy), `${legacy} must be an attention item, not a banner`);
  }
  assert.match(screen, /useThrottledValue\(position, 1000\)/);
  assert.match(read('mobile/src/components/ride/RideMap.tsx'), /const RidersLayer = memo/);
  assert.match(read('mobile/src/components/ride/RideHud.tsx'), /export const RideHud = memo/);
});
