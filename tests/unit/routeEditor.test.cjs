const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const pt = (seq, type, name, lng, lat, extra = {}) => ({ sequence: seq, waypoint_type: type, name, longitude: lng, latitude: lat, ...extra });
const route = { geometry: { type: 'LineString', coordinates: [[77.17, 31.1], [77.45, 31.26], [78.07, 32.22]] }, distance: 431000, duration: 41400 };

test('save_trip_route arguments match the mobile route editor', () => {
  const points = [
    pt(0, 'origin', 'Shimla', 77.17, 31.1, { id: 'w1', address: 'Shimla, Himachal Pradesh' }),
    pt(1, 'fuel', ' Narkanda ', 77.45, 31.26, { trip_day_id: 'd2' }),
    pt(2, 'destination', 'Kaza', 78.07, 32.22, { id: 'w3' }),
  ];
  const args = shared.buildSaveTripRouteArgs('ride-1', points, [{ id: 'd1', day_number: 1 }, { id: 'd2', day_number: 2 }], route);
  assert.equal(args.p_ride_id, 'ride-1');
  assert.deepEqual(args.p_trip.origin_coords, [77.17, 31.1]);
  assert.equal(args.p_trip.origin, 'Shimla, Himachal Pradesh');
  assert.equal(args.p_trip.destination, 'Kaza');
  assert.deepEqual(args.p_trip.route_geometry, { type: 'Feature', geometry: route.geometry, properties: {} });
  assert.equal(args.p_trip.estimated_distance_meters, 431000);
  assert.deepEqual(args.p_waypoints.map(w => [w.id, w.sequence, w.waypoint_type, w.name, w.day_number]), [
    ['w1', 0, 'origin', 'Shimla', null], [null, 1, 'fuel', 'Narkanda', 2], ['w3', 2, 'destination', 'Kaza', null],
  ]);
  assert.equal(args.p_waypoints[1].address, ' Narkanda ');
});

test('GPX export has every point and the road line, escaped', () => {
  const gpx = shared.tripRouteToGpx({ name: 'Spiti <loop> & back' }, [
    pt(0, 'origin', 'Shimla', 77.1734567891, 31.1), pt(1, 'destination', 'Kaza "camp"', 78.07, 32.22),
  ], route.geometry);
  assert.match(gpx, /^<\?xml version="1.0"/);
  assert.match(gpx, /<metadata><name>Spiti &lt;loop&gt; &amp; back<\/name>/);
  assert.equal((gpx.match(/<wpt /g) || []).length, 2);
  assert.match(gpx, /<wpt lat="31.1" lon="77.173457"><name>Shimla<\/name><type>origin<\/type><\/wpt>/);
  assert.match(gpx, /Kaza &quot;camp&quot;/);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 3);
  const noLine = shared.tripRouteToGpx({ name: '' }, [pt(0, 'origin', 'A', 1, 2)], null);
  assert.doesNotMatch(noLine, /<trk>/);
  assert.match(noLine, /rideNtrack trip/);
});

test('trip file names are safe', () => {
  assert.equal(shared.tripFileName('Spiti Valley Loop 2027!', 'gpx'), 'spiti-valley-loop-2027.gpx');
  assert.equal(shared.tripFileName('../..', 'gpx'), 'trip.gpx');
});
