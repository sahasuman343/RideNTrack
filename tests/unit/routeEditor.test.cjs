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

const gpxFile = body => `<?xml version="1.0"?><gpx version="1.1"><metadata><name>Spiti &amp; back</name></metadata>${body}</gpx>`;

test('GPX import prefers named waypoints and sets the ends', () => {
  const r = shared.gpxToRoutePoints(gpxFile(`
    <wpt lat="31.10" lon="77.17"><name>Shimla</name><type>fuel</type></wpt>
    <wpt lat="31.26" lon="77.45"><name>Narkanda</name><type>origin</type></wpt>
    <wpt lat="31.44" lon="77.63"><name>Rampur</name><type>food</type></wpt>
    <wpt lat="32.22" lon="78.07"><name>Kaza</name></wpt>
    <trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk>`), 5);
  assert.equal(r.source, 'waypoints');
  assert.equal(r.name, 'Spiti & back');
  assert.deepEqual(r.points.map(p => [p.sequence, p.waypoint_type, p.name]), [
    [0, 'origin', 'Shimla'], [1, 'stop', 'Narkanda'], [2, 'food', 'Rampur'], [3, 'destination', 'Kaza'],
  ]);
  assert.equal(shared.validateRoutePoints(r.points), null, 'imported points pass the save checks');
});

test('GPX import thins a long track to the plan limit and keeps both ends', () => {
  const pts = Array.from({ length: 30 }, (_, i) => `<trkpt lat="${30 + i / 10}" lon="${77 + i / 10}"/>`).join('');
  const r = shared.gpxToRoutePoints(gpxFile(`<trk><trkseg>${pts}</trkseg></trk>`), 5);
  assert.equal(r.source, 'track');
  assert.equal(r.total, 30);
  assert.equal(r.points.length, 5);
  assert.deepEqual([r.points[0].latitude, r.points[4].latitude], [30, 32.9]);
  assert.equal(r.points[2].name, 'Track point 3');
  assert.equal(shared.validateRoutePoints(r.points), null);
});

test('GPX import explains an empty or broken file', () => {
  assert.throws(() => shared.gpxToRoutePoints('', 5), /no route/);
  assert.throws(() => shared.gpxToRoutePoints(gpxFile('<wpt lat="abc" lon="77"><name>x</name></wpt>'), 5), /no route/);
});

test('trip file names are safe', () => {
  assert.equal(shared.tripFileName('Spiti Valley Loop 2027!', 'gpx'), 'spiti-valley-loop-2027.gpx');
  assert.equal(shared.tripFileName('../..', 'gpx'), 'trip.gpx');
});
