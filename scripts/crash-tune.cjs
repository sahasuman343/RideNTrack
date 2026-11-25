#!/usr/bin/env node
// F7 GA: reads the JSON from `select public.crash_beta_report();` and prints
// how each threshold pair would have done, plus the go / no-go verdict.
// Usage: node scripts/crash-tune.cjs report.json
const fs = require('node:fs');
const path = require('node:path');
const { loader } = require(path.resolve(__dirname, '../tests/unit/loader.cjs'));

const shared = loader()('shared/types.ts');
const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/crash-tune.cjs report.json');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const report = raw.crash_beta_report ?? raw;
const hours = Number(report.riding_hours) || 0;
const rows = (report.rows || []).map(r => ({ kind: r.kind, peak_g: Number(r.peak_g), speed_before_kmh: r.speed_before_kmh == null ? null : Number(r.speed_before_kmh) }));

console.log(`${report.riders ?? '?'} riders, ${hours} riding hours, ${rows.length} events`);
const current = shared.evaluateThresholds(rows, hours);
console.log(`Current (impact ${current.thresholds.impactG} g, ${current.thresholds.minSpeedBeforeKmh} km/h): ${current.falseAlarms} false alarms (${current.falseAlarmsPer1000h ?? '?'} per 1,000 h), caught ${current.caught}, missed ${current.missed}`);
console.log('\nBest threshold pairs:');
console.log('impactG  speed  falseAlarms  per1000h  caught  missed');
for (const e of shared.sweepThresholds(rows, hours).slice(0, 10)) {
  console.log(`${String(e.thresholds.impactG).padEnd(8)} ${String(e.thresholds.minSpeedBeforeKmh).padEnd(6)} ${String(e.falseAlarms).padEnd(12)} ${String(e.falseAlarmsPer1000h ?? '?').padEnd(9)} ${String(e.caught).padEnd(7)} ${e.missed}`);
}
const best = shared.sweepThresholds(rows, hours)[0];
const verdict = shared.crashGaReadiness(best, hours);
console.log(`\n${verdict.ready ? 'READY for GA' : 'NOT READY'} with impactG=${best.thresholds.impactG}, minSpeedBeforeKmh=${best.thresholds.minSpeedBeforeKmh}`);
for (const r of verdict.reasons) console.log(`- ${r}`);
if (verdict.ready) console.log(`Set the crash_detection_beta payload to {"impactG": ${best.thresholds.impactG}, "minSpeedBeforeKmh": ${best.thresholds.minSpeedBeforeKmh}} and roll out by percentage.`);
