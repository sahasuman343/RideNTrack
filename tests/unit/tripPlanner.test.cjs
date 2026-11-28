const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const place = (id, lng, lat) => ({ id, name: id, address: id + ', India', longitude: lng, latitude: lat });

test('trip dates cover the whole range and stop at 31 days', () => {
  assert.deepEqual(shared.tripDates('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(shared.tripDates('2026-12-05', '2026-12-04'), []);
  assert.deepEqual(shared.tripDates('', '2026-12-04'), []);
  assert.equal(shared.tripDates('2026-01-01', '2026-03-01').length, 31);
});

test('place results drop bad coordinates and duplicates', () => {
  const results = shared.parsePlaceResults({ features: [
    { id: 'a', text: 'Leh', place_name: 'Leh, Ladakh, India', center: [77.58, 34.15] },
    { id: 'a', text: 'Leh again', center: [77.58, 34.15] },
    { id: 'b', text: 'Broken', center: ['x'] },
    { id: 'c', place_name: 'Manali, Himachal Pradesh', center: [77.19, 32.24] },
  ] });
  assert.deepEqual(results.map(r => r.name), ['Leh', 'Manali, Himachal Pradesh']);
  assert.equal(results[0].address, 'Leh, Ladakh, India');
  assert.deepEqual(shared.parsePlaceResults(null), []);
});

test('draft validation explains what is missing', () => {
  const base = { name: 'Spiti loop', tripType: 'touring', origin: place('Shimla', 77.17, 31.1), destination: place('Kaza', 78.07, 32.22), stops: [] };
  assert.equal(shared.validateTripPlanDraft(base, 5), null);
  assert.match(shared.validateTripPlanDraft({ ...base, name: ' ' }, 5), /name/);
  assert.match(shared.validateTripPlanDraft({ ...base, destination: null }, 5), /ends/);
  assert.match(shared.validateTripPlanDraft({ ...base, stops: [{ place: null, kind: 'fuel' }] }, 5), /every stop/);
  const fourStops = Array.from({ length: 4 }, (_, i) => ({ place: place('s' + i, 77, 31), kind: 'stop' }));
  assert.match(shared.validateTripPlanDraft({ ...base, stops: fourStops }, 5), /up to 5 route points/);
  assert.match(shared.validateTripPlanDraft({ ...base, startDate: '2026-12-10' }, 5), /both/);
  assert.match(shared.validateTripPlanDraft({ ...base, startDate: '2026-12-10', endDate: '2026-12-09' }, 5), /on or after/);
});

test('create_trip_plan arguments match the mobile payload', () => {
  const args = shared.buildCreateTripPlanArgs({
    name: ' Spiti loop ', description: '', tripType: 'touring', startDate: '2026-12-10', endDate: '2026-12-11',
    origin: place('Shimla', 77.17, 31.1), destination: place('Kaza', 78.07, 32.22),
    stops: [{ place: place('Narkanda', 77.45, 31.26), kind: 'fuel' }],
  }, { geometry: { type: 'LineString', coordinates: [[77.17, 31.1], [78.07, 32.22]] }, distance: 420000, duration: 36000 });
  assert.equal(args.p_trip.name, 'Spiti loop');
  assert.equal(args.p_trip.description, null);
  assert.equal(args.p_trip.visibility, 'invite_only');
  assert.deepEqual(args.p_trip.origin_coords, [77.17, 31.1]);
  assert.equal(args.p_trip.route_geometry.type, 'Feature');
  assert.equal(args.p_trip.estimated_distance_meters, 420000);
  assert.deepEqual(args.p_waypoints.map(w => [w.sequence, w.waypoint_type, w.name]), [[0, 'origin', 'Shimla'], [1, 'fuel', 'Narkanda'], [2, 'destination', 'Kaza']]);
  assert.deepEqual(args.p_days, [{ day_number: 1, trip_date: '2026-12-10', title: 'Day 1' }, { day_number: 2, trip_date: '2026-12-11', title: 'Day 2' }]);
  assert.equal(args.p_stay, null);
  const noRoute = shared.buildCreateTripPlanArgs({ name: 'x', tripType: 'solo', origin: place('A', 1, 1), destination: place('B', 2, 2), stops: [] }, null);
  assert.equal(noRoute.p_trip.route_geometry, null);
  assert.deepEqual(noRoute.p_days, []);
});
