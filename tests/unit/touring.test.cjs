const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const seed = loader()('shared/touringSeed.ts');
const manaliLeh = seed.SEED_ROUTES.find(r => r.id === 'manali-leh');
const fuel = seed.SEED_POIS.filter(p => p.route_id === 'manali-leh');

// The seed line joins towns with straight segments, so it is shorter than the
// road (Tandi to Karu is ~190 km here, ~330 km by road). Real trips use the
// Mapbox route line.
test('Manali–Leh fixture: Tandi is the last fuel for a long stretch', () => {
  const report = shared.findFuelGaps(manaliLeh.line, fuel, 400);
  assert.deepEqual(report.stops.map(s => s.poi.id), ['fuel-manali', 'fuel-tandi', 'fuel-karu', 'fuel-leh']);
  const afterTandi = report.stretches.find(s => s.from && s.from.poi.id === 'fuel-tandi');
  assert.ok(afterTandi.lengthKm > 150, `Tandi to Karu was ${afterTandi.lengthKm} km`);
  assert.equal(afterTandi.long, true);
  assert.equal(report.gaps.length, 0, 'a 400 km pack makes it');
  assert.ok(report.warnings.some(w => /^Tandi fuel station is the last fuel for \d+ km/.test(w)));
});

test('a small-tank pack gets a real gap and a carry-extra-fuel warning first', () => {
  const report = shared.findFuelGaps(manaliLeh.line, fuel, 180);
  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].from.poi.id, 'fuel-tandi');
  assert.match(report.warnings[0], /no fuel after Tandi fuel station, more than the pack's 180 km range\. Carry extra fuel\./);
});

test('synthetic straight route: stations off the corridor do not count', () => {
  // ~111 km per degree of latitude, going north.
  const line = [[77, 10], [77, 13]];
  const pois = [
    { id: 'a', kind: 'fuel', name: 'A', lat: 10.5, lng: 77 },
    { id: 'off', kind: 'fuel', name: 'Far off', lat: 11.5, lng: 77.2 },
    { id: 'atm', kind: 'atm', name: 'ATM', lat: 11.5, lng: 77 },
    { id: 'b', kind: 'fuel', name: 'B', lat: 12.9, lng: 77.001 },
  ];
  const report = shared.findFuelGaps(line, pois, 200);
  assert.deepEqual(report.stops.map(s => s.poi.id), ['a', 'b']);
  assert.equal(report.gaps.length, 1);
  assert.ok(Math.abs(report.gaps[0].lengthKm - 266) < 5, String(report.gaps[0].lengthKm));
  assert.deepEqual(shared.findFuelGaps(null, pois, 200).stops, []);
});

test('live last-fuel warning shows near the station, then goes away', () => {
  const report = shared.findFuelGaps(manaliLeh.line, fuel, 400);
  const tandi = report.stops.find(s => s.poi.id === 'fuel-tandi').atKm;
  const now = '2026-07-01T08:00:00Z';
  assert.equal(shared.lastFuelAttention(tandi - 20, report, now), null);
  const before = shared.lastFuelAttention(tandi - 3, report, now);
  assert.match(before.title, /^Last fuel for \d+ km in 3 km$/);
  assert.match(before.body, /Tandi fuel station\. Next fuel: Karu fuel station/);
  assert.match(before.body, /Not verified this season/);
  assert.equal(before.kind, 'fuel');
  const at = shared.lastFuelAttention(tandi + 1, report, now);
  assert.match(at.title, /^You are at the last fuel for/);
  assert.equal(shared.lastFuelAttention(tandi + 10, report, now), null);
});

test('a trip matches a known route in either direction, a different trip does not', () => {
  const reversed = manaliLeh.line.slice().reverse();
  assert.equal(shared.matchKnownRoute(reversed, seed.SEED_ROUTES).route.id, 'manali-leh');
  const delhiJaipur = [[77.21, 28.61], [76.8, 27.9], [75.79, 26.91]];
  assert.equal(shared.matchKnownRoute(delhiJaipur, seed.SEED_ROUTES), null);
});

test('pass windows explain themselves out of season; permits always show', () => {
  const adv = seed.SEED_ADVISORIES.filter(a => a.route_id === 'manali-leh');
  const winter = shared.advisoriesForTrip(adv, '2027-01-10');
  const season = winter.find(a => a.kind === 'pass_window');
  assert.equal(season.inSeason, false);
  assert.match(season.sentence, /usually closed on your dates\. Opens around 1 Jun\./);
  assert.equal(winter[0].kind, 'permit');
  const summer = shared.advisoriesForTrip(adv, '2027-07-10');
  assert.equal(summer.find(a => a.kind === 'pass_window').inSeason, true);
  // Windows can wrap the new year.
  assert.equal(shared.advisoryInSeason({ season_from: '11-01', season_to: '02-28' }, '2027-01-15'), true);
  assert.equal(shared.advisoryInSeason({ season_from: '11-01', season_to: '02-28' }, '2027-06-15'), false);
});

test('seed data is sane and the migration carries it', () => {
  const ids = new Set();
  for (const r of seed.SEED_ROUTES) {
    assert.ok(r.line.length >= 2);
    for (const [lng, lat] of r.line) assert.ok(lng > 68 && lng < 98 && lat > 6 && lat < 37, `${r.id} point outside India`);
  }
  for (const p of [...seed.SEED_POIS, ...seed.SEED_ADVISORIES]) {
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`); ids.add(p.id);
    assert.ok(seed.SEED_ROUTES.some(r => r.id === p.route_id), `${p.id} has unknown route`);
    assert.ok(!p.verified_at, `${p.id} must not claim verification in seed`);
  }
  const { seedSql } = require(path.resolve('scripts/touring-seed.cjs'));
  const migration = fs.readFileSync('supabase/migrations/049_touring_knowledge.sql', 'utf8');
  assert.ok(migration.includes(seedSql()), 'run node scripts/touring-seed.cjs --write');
});
