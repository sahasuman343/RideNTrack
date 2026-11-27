// Browser checks for the web trip planner: list, create (search, stops,
// route preview, create_trip_plan payload), view, edit and delete.
// Run after `npm --workspace=web run build` with the CI placeholder env.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';
const userId = '11111111-1111-4111-8111-111111111111';
const tripId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const newTripId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const session = {
  access_token: Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.test',
  refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
  user: { id: userId, email: 'rider@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
};
const places = {
  shim: { id: 'place.shimla', text: 'Shimla', place_name: 'Shimla, Himachal Pradesh, India', center: [77.1734, 31.1048] },
  kaza: { id: 'place.kaza', text: 'Kaza', place_name: 'Kaza, Himachal Pradesh, India', center: [78.0718, 32.2276] },
  ramp: { id: 'place.rampur', text: 'Rampur Bushahr', place_name: 'Rampur Bushahr, Himachal Pradesh, India', center: [77.6346, 31.4493] },
  nark: { id: 'place.narkanda', text: 'Narkanda', place_name: 'Narkanda, Himachal Pradesh, India', center: [77.4572, 31.2606] },
};
const existingTrip = {
  id: tripId, name: 'Spiti Valley Loop', ride_code: 'SPITI1', admin_id: userId, origin: 'Shimla, Himachal Pradesh, India', destination: 'Kaza, Himachal Pradesh, India',
  origin_coords: [77.1734, 31.1048], destination_coords: [78.0718, 32.2276], status: 'planned', trip_type: 'touring', visibility: 'invite_only',
  start_date: '2027-06-10', end_date: '2027-06-12', estimated_distance_meters: 420000, estimated_duration_seconds: 39600, created_at: new Date().toISOString(),
  description: 'Full tanks at Rampur.', max_participants: 8, ride_rules: null,
  route_geometry: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[77.1734, 31.1048], [77.4572, 31.2606], [78.0718, 32.2276]] } },
};
const pastTrip = { ...existingTrip, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Nandi Hills Sunrise', status: 'completed', start_date: '2026-01-04', end_date: '2026-01-04', trip_type: 'group' };
const waypoints = [
  { id: 'w1', ride_id: tripId, sequence: 0, waypoint_type: 'origin', name: 'Shimla', latitude: 31.1048, longitude: 77.1734, is_optional: false },
  { id: 'w2', ride_id: tripId, sequence: 1, waypoint_type: 'fuel', name: 'Narkanda', latitude: 31.2606, longitude: 77.4572, is_optional: false, trip_day_id: 'd2' },
  { id: 'w3', ride_id: tripId, sequence: 2, waypoint_type: 'destination', name: 'Kaza', latitude: 32.2276, longitude: 78.0718, is_optional: false },
];
const days = [1, 2, 3].map(n => ({ id: 'd' + n, ride_id: tripId, day_number: n, trip_date: '2027-06-1' + (n - 1), title: 'Day ' + n }));

const sessionCookie = s => ({ name: 'sb-ridentrack-test-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url'), url: origin });
(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser, page;
  const calls = { saveRoute: null, create: null, update: null, deleted: null, geocode: 0, directions: 0 };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    browser = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addCookies([sessionCookie(session)]);
    await context.route('https://api.mapbox.com/**', route => {
      const url = route.request().url();
      if (url.includes('/styles/')) return route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0c0c0e' } }] } });
      if (url.includes('/geocoding/')) {
        calls.geocode++;
        const q = decodeURIComponent(url.split('/mapbox.places/')[1].split('.json')[0]).toLowerCase();
        assert.ok(url.includes('country=IN'), 'place search stays in India');
        const hit = Object.entries(places).find(([k]) => q.startsWith(k));
        return route.fulfill({ json: { features: hit ? [hit[1]] : [] } });
      }
      if (url.includes('/directions/')) {
        calls.directions++;
        const coords = url.split('/driving/')[1].split('?')[0].split(';').map(p => p.split(',').map(Number));
        return route.fulfill({ json: { code: 'Ok', routes: [{ distance: 431000, duration: 41400, geometry: { type: 'LineString', coordinates: coords } }] } });
      }
      return route.fulfill({ status: 200, json: {} });
    });
    await context.route('https://events.mapbox.com/**', r => r.fulfill({ status: 204 }));
    let trips = [existingTrip, pastTrip];
    let flags = [];
    await context.route('https://ridentrack-test.supabase.co/**', route => {
      const req = route.request(); const url = req.url(); const method = req.method();
      if (url.includes('/auth/v1/user')) return route.fulfill({ json: session.user });
      if (url.includes('/rpc/get_my_flags')) return route.fulfill({ json: flags });
      if (url.includes('/rpc/get_trip_roster')) return route.fulfill({ json: [{ user_id: userId, display_name: 'Suman', role: 'captain', is_active: true, last_seen: null, attendance_status: 'confirmed' }] });
      if (url.includes('/rpc/create_trip_plan')) { calls.create = req.postDataJSON(); trips = [{ ...existingTrip, id: newTripId, name: calls.create.p_trip.name }, ...trips]; return route.fulfill({ json: newTripId }); }
      if (url.includes('/rpc/save_trip_route')) { calls.saveRoute = req.postDataJSON(); return route.fulfill({ status: 204, body: '' }); }
      if (url.includes('/rpc/delete_trip')) { calls.deleted = req.postDataJSON().p_ride_id; trips = trips.filter(t => t.id !== calls.deleted); return route.fulfill({ status: 204, body: '' }); }
      if (url.includes('/rest/v1/profiles')) return route.fulfill({ json: { id: userId, display_name: 'Suman', subscription_tier: 'free' } });
      if (url.includes('/rest/v1/ride_participants')) return route.fulfill({ json: trips.map(t => ({ ride_id: t.id, rides: t })) });
      if (url.includes('/rest/v1/rides') && method === 'PATCH') { calls.update = req.postDataJSON(); Object.assign(existingTrip, calls.update); return route.fulfill({ status: 204, body: '' }); }
      if (url.includes('/rest/v1/rides')) return route.fulfill({ json: trips.find(t => url.includes(t.id)) ?? existingTrip });
      if (url.includes('/rest/v1/trip_waypoints')) return route.fulfill({ json: waypoints });
      if (url.includes('/rest/v1/trip_days')) return route.fulfill({ json: days });
      if (url.includes('/rest/v1/trip_stays')) return route.fulfill({ json: [] });
      return route.fulfill({ json: {} });
    });
    page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));

    // Trip list with filters.
    await page.goto(origin + '/app/trips');
    await page.getByRole('heading', { name: 'Your trips' }).waitFor();
    await page.getByRole('link', { name: /Spiti Valley Loop/ }).waitFor();
    assert.equal(await page.locator('.trip-card').count(), 1, 'upcoming shows only planned trips');
    await page.getByRole('tab', { name: 'Past' }).click();
    await page.getByRole('link', { name: /Nandi Hills Sunrise/ }).waitFor();
    await page.getByRole('tab', { name: 'All' }).click();
    assert.equal(await page.locator('.trip-card').count(), 2);
    assert.equal(await page.getByRole('link', { name: 'Trips', exact: true }).getAttribute('aria-current'), 'page');

    // Create a trip.
    await page.getByRole('link', { name: 'Plan a trip' }).click();
    await page.getByRole('heading', { name: 'Plan a trip' }).waitFor();
    await page.getByRole('button', { name: 'Save trip' }).click();
    await page.getByRole('alert').filter({ hasText: 'name' }).waitFor();
    await page.getByLabel('Trip name').fill('Spiti Winter Run');
    await page.getByLabel('Type').selectOption('touring');
    await page.getByLabel('Start date').fill('2027-01-10');
    await page.getByLabel('End date').fill('2027-01-11');
    await page.getByRole('combobox', { name: 'Start', exact: true }).fill('Shim');
    await page.getByRole('option', { name: /Shimla/ }).click();
    await page.getByRole('combobox', { name: 'End', exact: true }).fill('Kaza');
    await page.getByRole('option', { name: /Kaza/ }).click();
    await page.getByText('431 km', { exact: true }).waitFor();
    await page.getByRole('button', { name: '+ Add a stop' }).click();
    await page.getByLabel('Stop 1 type').selectOption('fuel');
    await page.getByRole('button', { name: 'Save trip' }).click();
    await page.getByRole('alert').filter({ hasText: 'every stop' }).waitFor();
    await page.getByRole('combobox', { name: 'Stop 1', exact: true }).fill('Nark');
    await page.getByRole('option', { name: /Narkanda/ }).click();
    await page.getByText('3 points').waitFor();
    assert.equal(await page.locator('.trip-marker').count(), 3, 'map shows start, stop and end');
    assert.ok((await page.locator('.trip-map-canvas').boundingBox()).height > 300, 'planner map fills its panel');
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '+ Add a stop' }).click();
    await page.getByRole('button', { name: '+ Add a stop' }).click();
    await page.getByRole('alert').filter({ hasText: 'up to 5 route points' }).waitFor();
    for (let i = 3; i >= 2; i--) await page.getByRole('button', { name: `Remove stop ${i}` }).click();
    assert.equal(await page.getByRole('alert').filter({ hasText: 'route points' }).count(), 0, 'removing stops clears the limit message');
    fs.mkdirSync('test-results', { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'test-results/trip-planner-desktop.png' });
    await page.getByRole('button', { name: 'Save trip' }).click();
    await page.waitForURL(url => url.pathname === '/app/trips/' + newTripId);
    assert.equal(calls.create.p_trip.name, 'Spiti Winter Run');
    assert.equal(calls.create.p_trip.trip_type, 'touring');
    assert.equal(calls.create.p_trip.estimated_distance_meters, 431000);
    assert.deepEqual(calls.create.p_waypoints.map(w => [w.waypoint_type, w.name]), [['origin', 'Shimla'], ['fuel', 'Narkanda'], ['destination', 'Kaza']]);
    assert.deepEqual(calls.create.p_days.map(d => d.trip_date), ['2027-01-10', '2027-01-11']);

    // View, edit and delete.
    await page.goto(origin + '/app/trips/' + tripId);
    await page.getByRole('heading', { name: 'Spiti Valley Loop' }).waitFor();
    assert.equal(await page.locator('section[aria-labelledby="route-heading"] ol li').count(), 3);
    await page.getByText('SPITI1', { exact: true }).first().waitFor();
    await page.getByRole('heading', { name: 'Days' }).waitFor();
    assert.ok((await page.locator('.trip-map-canvas').boundingBox()).height > 300, 'trip map fills its panel');
    await page.screenshot({ path: 'test-results/trip-view-desktop.png' });
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByLabel('Pack size limit').fill('1');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Pack size must be a whole number from 2 to 500.').waitFor();
    assert.equal(calls.update, null);
    await page.getByLabel('Pack size limit').fill('10');
    await page.getByLabel('Trip name', { exact: true }).fill('Spiti Valley Loop 2027');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Trip details saved.').waitFor();
    assert.deepEqual({ name: calls.update.name, max: calls.update.max_participants, vis: calls.update.visibility }, { name: 'Spiti Valley Loop 2027', max: 10, vis: 'invite_only' });
    await page.getByRole('heading', { name: 'Spiti Valley Loop 2027' }).waitFor();

    // GPX download and the route editor.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download GPX' }).click()]);
    assert.equal(download.suggestedFilename(), 'spiti-valley-loop-2027.gpx');
    const gpx = fs.readFileSync(await download.path(), 'utf8');
    assert.equal((gpx.match(/<wpt /g) || []).length, 3, 'GPX has every route point');
    assert.equal((gpx.match(/<rtept /g) || []).length, 3, 'GPX has the road line');
    await page.getByRole('link', { name: 'Edit route' }).click();
    await page.waitForURL(url => url.pathname === '/app/trips/' + tripId + '/route');
    await page.getByRole('heading', { name: 'Edit route' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save route' }).isDisabled(), true, 'nothing to save before a change');
    assert.equal(await page.getByRole('combobox', { name: 'Stop 1', exact: true }).inputValue(), 'Narkanda');
    await page.getByRole('button', { name: '+ Add a stop' }).click();
    await page.getByRole('combobox', { name: 'Stop 2', exact: true }).fill('Ramp');
    await page.getByRole('option', { name: /Rampur/ }).click();
    await page.getByRole('button', { name: 'Move stop 2 up' }).click();
    await page.getByLabel('Stop 1 type').selectOption('food');
    await page.getByText('431 km', { exact: true }).waitFor();
    assert.equal(await page.locator('.trip-marker').count(), 4, 'map shows the new stop');
    await page.screenshot({ path: 'test-results/route-editor-desktop.png' });
    await page.getByRole('button', { name: 'Save route' }).click();
    await page.waitForURL(url => url.pathname === '/app/trips/' + tripId);
    assert.equal(calls.saveRoute.p_ride_id, tripId);
    assert.deepEqual(calls.saveRoute.p_waypoints.map(w => [w.id, w.sequence, w.waypoint_type, w.name, w.day_number]), [
      ['w1', 0, 'origin', 'Shimla', null], [null, 1, 'food', 'Rampur Bushahr', null], ['w2', 2, 'fuel', 'Narkanda', 2], ['w3', 3, 'destination', 'Kaza', null],
    ]);
    assert.equal(calls.saveRoute.p_trip.estimated_distance_meters, 431000);
    assert.equal(calls.saveRoute.p_trip.route_geometry.geometry.coordinates.length, 4);

    // GPX import: Pro only, like the plan table; beta_free_pro turns it on for everyone.
    await page.getByRole('link', { name: 'Edit route' }).click();
    await page.getByRole('heading', { name: 'Edit route' }).waitFor();
    await page.getByRole('button', { name: 'Import GPX' }).click();
    await page.getByRole('status').filter({ hasText: 'part of Pro Tourer' }).waitFor();
    flags = [{ key: 'beta_free_pro', enabled: true }];
    await page.reload();
    await page.getByText('of 50 route points').waitFor();
    const importFile = '<?xml version="1.0"?><gpx version="1.1"><metadata><name>Spiti</name></metadata>'
      + '<wpt lat="31.1048" lon="77.1734"><name>Shimla Mall Road</name></wpt><wpt lat="31.4493" lon="77.6346"><name>Rampur</name><type>fuel</type></wpt>'
      + '<wpt lat="32.2276" lon="78.0718"><name>Kaza</name></wpt></gpx>';
    await page.locator('input[type=file]').setInputFiles({ name: 'spiti.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(importFile) });
    await page.getByRole('status').filter({ hasText: 'Imported 3 points from spiti.gpx' }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Start', exact: true }).inputValue(), 'Shimla Mall Road');
    assert.equal(await page.getByLabel('Stop 1 type').inputValue(), 'fuel');
    await page.getByText('431 km', { exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/route-import-desktop.png' });
    await page.getByRole('button', { name: 'Save route' }).click();
    await page.waitForURL(url => url.pathname === '/app/trips/' + tripId);
    assert.deepEqual(calls.saveRoute.p_waypoints.map(w => [w.id, w.waypoint_type, w.name]), [[null, 'origin', 'Shimla Mall Road'], [null, 'fuel', 'Rampur'], [null, 'destination', 'Kaza']]);
    flags = [];
    await page.getByRole('button', { name: 'Delete trip' }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete trip' }).click();
    await page.waitForURL(url => url.pathname === '/app/trips');
    assert.equal(calls.deleted, tripId);

    // Phone width: no sideways scroll on the planner.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/app/trips/new');
    await page.getByRole('heading', { name: 'Plan a trip' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at phone width');
    await page.screenshot({ path: 'test-results/trip-planner-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`Trip planner browser checks passed: list filters, create with search/stops/route preview/limits, view, edit, GPX download, route editor, GPX import (Pro gate), delete, phone layout; ${calls.geocode} searches, ${calls.directions} route requests; no page errors.`);
  } catch (error) {
    if (page) { fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/trip-planner-failure.png', fullPage: true }); }
    throw error;
  } finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
