const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

/*
 * Synthetic traces at 25 Hz. Each phase is [seconds, g, gyroDps, speedKmh].
 * Real recorded rides from the sensor recorder replace these during the beta;
 * the shapes here are the cases the detector must get right from day one.
 */
function trace(phases, start = 1_000_000) {
  const out = [];
  let t = start;
  for (const [seconds, g, gyro, speed] of phases) {
    const n = Math.round(seconds * 25);
    for (let i = 0; i < n; i++) {
      // Small road vibration so "still" is never perfectly flat.
      const wobble = (i % 2 ? 0.03 : -0.03) * (speed && speed > 5 ? 3 : 1);
      out.push({ t, g: g + wobble, gyroDps: gyro, speedKmh: speed });
      t += 40;
    }
  }
  return out;
}

function run(samples, thresholds) {
  const detector = shared.createCrashDetector(thresholds);
  const events = [];
  for (const s of samples) events.push(...detector.push(s));
  return events;
}

test('crash at speed, then lying still: one candidate', () => {
  const events = run(trace([
    [6, 1, 10, 55],        // riding
    [0.12, 7.5, 420, 55],  // impact and tumble
    [1.5, 1.8, 120, 12],   // sliding
    [14, 1, 2, 0],         // on the ground
  ]));
  const candidates = events.filter(e => e.type === 'candidate');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].confidence, 'high');
  assert.ok(candidates[0].speedBeforeKmh >= 50);
  assert.ok(candidates[0].peakG >= 7);
});

test('GPS speed lags after the crash: still a candidate', () => {
  const events = run(trace([
    [6, 1, 10, 60],
    [0.1, 6, 350, 60],
    [4, 1, 3, 35],   // phone still, GPS still reporting the old speed
    [10, 1, 2, 0],
  ]));
  assert.equal(events.filter(e => e.type === 'candidate').length, 1);
});

test('speed breaker at 40 km/h: spike but the rider keeps going', () => {
  const events = run(trace([
    [6, 1, 10, 40],
    [0.08, 5.2, 80, 38],
    [14, 1, 10, 36],
  ]));
  assert.equal(events.filter(e => e.type === 'candidate').length, 0);
  // The recorder still keeps it: this is exactly the data the beta needs.
  assert.equal(events.filter(e => e.type === 'hard_event').length, 1);
});

test('phone dropped while parked: no speed before, no candidate', () => {
  const events = run(trace([
    [6, 1, 0, 0],
    [0.08, 9, 600, 0],
    [14, 1, 0, 0],
  ]));
  assert.equal(events.filter(e => e.type === 'candidate').length, 0);
});

test('no GPS speed at all stays quiet', () => {
  const events = run(trace([
    [6, 1, 10, null],
    [0.1, 8, 400, null],
    [14, 1, 0, null],
  ]));
  assert.equal(events.filter(e => e.type === 'candidate').length, 0);
});

test('hard stop then the phone is picked up and handled: not still, no candidate', () => {
  const samples = trace([
    [6, 1, 10, 45],
    [0.1, 5, 60, 30],
    [1, 1.3, 20, 3],
  ]);
  // Rider grabs the phone: g swings for the whole still window.
  let t = samples[samples.length - 1].t + 40;
  for (let i = 0; i < 25 * 14; i++, t += 40) samples.push({ t, g: i % 6 < 3 ? 0.4 : 1.9, gyroDps: 150, speedKmh: 0 });
  assert.equal(run(samples).filter(e => e.type === 'candidate').length, 0);
});

test('remote thresholds override only valid numbers', () => {
  const t = shared.crashThresholdsFrom({ impactG: 6, stillSeconds: -1, minSpeedBeforeKmh: 'fast', unknown: 3 });
  assert.equal(t.impactG, 6);
  assert.equal(t.stillSeconds, shared.CRASH_THRESHOLDS.stillSeconds);
  assert.equal(t.minSpeedBeforeKmh, shared.CRASH_THRESHOLDS.minSpeedBeforeKmh);
  assert.equal('unknown' in t, false);
  // A higher impact threshold turns the speed-breaker-sized spike into nothing.
  const events = run(trace([[6, 1, 10, 55], [0.12, 5, 100, 55], [1.5, 1.5, 50, 10], [14, 1, 2, 0]]), t);
  assert.equal(events.filter(e => e.type === 'candidate').length, 0);
});

test('recorded windows are capped, ordered and keep the peak', () => {
  const samples = trace([[20, 1, 5, 40]]);
  samples[250].g = 6.6;
  const small = shared.downsample(samples, 100);
  assert.equal(small.length, 100);
  assert.ok(small.some(s => s.g === 6.6));
  for (let i = 1; i < small.length; i++) assert.ok(small[i].t >= small[i - 1].t);
});

test('countdown item: full screen, sticky, tap anywhere is "I\'m OK"', () => {
  const item = shared.crashCountdownAttention(44.2, '2026-11-25T10:00:00.000Z');
  assert.equal(item.kind, 'crash_countdown');
  assert.equal(item.sticky, true);
  assert.equal(item.countdownSeconds, 45);
  assert.equal(item.actions[0].id, 'crash_ok');
  const view = shared.selectAttention([
    item,
    { id: 'alert:x', kind: 'incoming_sos', title: 'Ravi needs help', createdAt: '2026-11-25T09:59:00.000Z' },
  ], { now: Date.parse('2026-11-25T10:00:01.000Z'), dismissedIds: ['crash:countdown'] });
  assert.equal(view.current.id, 'crash:countdown');
  assert.equal(view.fullScreen, true);
});

test('haptics build up and the prompt repeats three times', () => {
  assert.equal(shared.crashHapticStrength(40), 'light');
  assert.equal(shared.crashHapticStrength(20), 'medium');
  assert.equal(shared.crashHapticStrength(5), 'heavy');
  const spoken = [];
  for (let s = 45; s > 0; s--) if (shared.shouldSpeakCrashPrompt(s)) spoken.push(s);
  assert.deepEqual(spoken, [45, 30, 15]);
});

test('pack sees "possible crash" until the rider cancels; family-facing detection is an SOS', () => {
  const base = { ride_id: 'r', lat: null, lng: null, display_name: 'Asha', user_id: 'u2' };
  const now = Date.parse('2026-11-25T10:01:00.000Z');
  const possible = { ...base, id: 'a1', type: 'possible_crash', message: shared.POSSIBLE_CRASH_MESSAGE, created_at: '2026-11-25T10:00:00.000Z' };
  let items = shared.attentionFromAlerts([possible], { myUserId: 'u1', now });
  assert.equal(items.length, 1);
  assert.match(items[0].title, /Asha: possible crash/);
  assert.equal(shared.attentionPriority(items[0]) < shared.ATTENTION_PRIORITY.incoming_sos, true);

  const cancelled = { ...base, id: 'a2', type: 'crash_cancelled', message: "I'm OK", created_at: '2026-11-25T10:00:20.000Z' };
  items = shared.attentionFromAlerts([possible, cancelled], { myUserId: 'u1', now });
  assert.deepEqual(items.map(i => i.title), ['Asha is OK']);

  const detected = { ...base, id: 'a3', type: 'crash_detected', message: null, created_at: '2026-11-25T10:00:45.000Z' };
  items = shared.attentionFromAlerts([possible, detected], { myUserId: 'u1', now });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'incoming_sos');
  assert.match(items[0].body, /No answer to the crash check/);
  assert.ok(items[0].actions.some(a => a.id === 'escalate'));
});

test('telemetry rows round values and drop nothing the table checks', () => {
  const row = shared.crashTelemetryRow('hard_event', {
    peakG: 5.23456, peakGyroDps: 301.7, speedBeforeKmh: 41.26, speedAfterKmh: null,
    samples: trace([[1, 1, 5, 40]]),
  }, { rideId: 'r1', platform: 'android', detector: 'foreground' });
  assert.equal(row.peak_g, 5.23);
  assert.equal(row.peak_gyro_dps, 302);
  assert.equal(row.speed_before_kmh, 41.3);
  assert.equal(row.samples.length, 25);
  assert.ok(row.samples.length <= 300);
});
