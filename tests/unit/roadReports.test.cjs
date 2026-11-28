const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const now = Date.parse('2026-07-01T10:00:00Z');
const nowIso = new Date(now).toISOString();
// Straight route north along 77°E, ~111 m per 0.001°.
const route = [[77, 12], [77, 12.2]];
const rep = (id, lat, extra = {}) => ({
  id, type: 'landslide', lat, lng: 77, note: null, created_at: '2026-07-01T08:00:00Z',
  expires_at: '2026-07-03T08:00:00Z', confirm_count: 2, ...extra,
});

test('nearest report ahead on the route becomes a hazard item', () => {
  const me = { lat: 12.05, lng: 77 };
  const item = shared.roadReportAheadAttention(me, route, [
    rep('behind', 12.03),
    rep('far', 12.1),
    rep('near', 12.06, { type: 'pothole', note: 'Left lane' }),
    rep('offroute', 12.055, { lng: 77.02 }),
  ], nowIso);
  assert.equal(item.id, 'road:near');
  assert.equal(item.kind, 'hazard');
  assert.equal(item.title, 'Potholes 1.1 km ahead');
  assert.equal(item.body, 'Left lane · Confirmed by 2 riders · 2 h ago');
  assert.deepEqual(item.actions.map(a => a.id), ['dismiss_road'], '"Still there" only when you reach it');
});

test('at the spot you can confirm; your own and expired reports never warn', () => {
  const me = { lat: 12.05, lng: 77 };
  const at = shared.roadReportAheadAttention(me, route, [rep('here', 12.0505)], nowIso);
  assert.match(at.title, /here$/);
  assert.equal(at.actions[0].id, 'road_confirm');
  assert.equal(shared.roadReportAheadAttention(me, route, [rep('mine', 12.06, { mine: true })], nowIso), null);
  assert.equal(shared.roadReportAheadAttention(me, route, [rep('old', 12.06, { expires_at: '2026-07-01T09:00:00Z' })], nowIso), null);
  assert.equal(shared.roadReportAheadAttention({ lat: 12.05, lng: 77.1 }, route, [rep('x', 12.06)], nowIso), null, 'off the route: no warning');
});

test('map features: severe red, pending hollow, expired gone', () => {
  const fc = shared.roadReportFeatures([
    rep('a', 12.01),
    rep('b', 12.02, { type: 'police_check', pending: true }),
    rep('c', 12.03, { expires_at: '2026-07-01T09:00:00Z' }),
  ], now);
  assert.deepEqual(fc.features.map(f => [f.properties.id, f.properties.severe, f.properties.pending]), [['a', true, false], ['b', false, true]]);
  assert.equal(shared.reportTrust({ confirm_count: 0, created_at: '2026-07-01T09:55:00Z' }, now), 'Reported once · 5 min ago');
  assert.equal(shared.reportTrust({ pending: true, confirm_count: 0, created_at: nowIso }, now), 'Waiting for signal to share');
});

test('report types match the database check', () => {
  const sql = fs.readFileSync('supabase/migrations/050_road_reports.sql', 'utf8');
  for (const t of shared.ROAD_REPORT_TYPES) assert.match(sql, new RegExp(`'${t.type}'`));
});
