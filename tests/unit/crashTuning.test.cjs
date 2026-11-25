const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

const bumps = Array.from({ length: 40 }, (_, i) => ({ kind: 'hard_event', peak_g: 2.6 + (i % 10) * 0.25, speed_before_kmh: 40 }));
const potholeSpikes = [{ kind: 'false_alarm', peak_g: 4.8, speed_before_kmh: 35 }, { kind: 'false_alarm', peak_g: 5.2, speed_before_kmh: 12 }];
const crashes = [{ kind: 'confirmed', peak_g: 8.1, speed_before_kmh: 45 }, { kind: 'help_requested', peak_g: 6.3, speed_before_kmh: 28 }];
const rows = [...bumps, ...potholeSpikes, ...crashes, { kind: 'candidate', peak_g: 9, speed_before_kmh: 50 }];

test('evaluation counts false alarms, caught and missed crashes, ignoring candidate rows', () => {
  const e = shared.evaluateThresholds(rows, 1000, { impactG: 4.5, minSpeedBeforeKmh: 15 });
  assert.equal(e.caught, 2);
  assert.equal(e.missed, 0);
  // 8 bumps at 4.6 to 4.85 g and the 4.8 g pothole; the 5.2 g one was too slow.
  assert.equal(e.falseAlarms, 9);
  assert.equal(e.falseAlarmsPer1000h, 9);
});

test('the sweep prefers catching every crash over fewer false alarms', () => {
  const [best] = shared.sweepThresholds(rows, 1000);
  assert.equal(best.missed, 0);
  assert.equal(best.falseAlarms, 0);
  assert.ok(best.thresholds.impactG <= 6.3);
});

test('GA needs enough hours, no missed crashes and under 1 false alarm per 1,000 h', () => {
  const good = shared.evaluateThresholds(rows, 800, { impactG: 5.5, minSpeedBeforeKmh: 15 });
  assert.deepEqual(shared.crashGaReadiness(good, 800), { ready: true, reasons: [] });
  const fewHours = shared.crashGaReadiness(shared.evaluateThresholds(rows, 120, { impactG: 5.5, minSpeedBeforeKmh: 15 }), 120);
  assert.equal(fewHours.ready, false);
  assert.match(fewHours.reasons.join(' '), /120 riding hours/);
  const deaf = shared.crashGaReadiness(shared.evaluateThresholds(rows, 800, { impactG: 7, minSpeedBeforeKmh: 15 }), 800);
  assert.match(deaf.reasons.join(' '), /1 real crash would not/);
});
