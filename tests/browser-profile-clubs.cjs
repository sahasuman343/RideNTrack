// Profile (rider, emergency, motorcycle, saved places, delete account) and
// clubs (list, create, join, roster roles, regular rides). Supabase is mocked.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';
const userId = '11111111-1111-4111-8111-111111111111';
const ashaId = '22222222-2222-4222-8222-222222222222';
const raviId = '33333333-3333-4333-8333-333333333333';
const clubId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now = Math.floor(Date.now() / 1000);
const session = {
  access_token: Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: userId, exp: now + 3600, role: 'authenticated' })).toString('base64url') + '.test',
  refresh_token: 'test-refresh', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer',
  user: { id: userId, email: 'rider@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
};
const sessionCookie = s => ({ name: 'sb-ridentrack-test-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url'), url: origin });
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let profile = { id: userId, username: 'suman', display_name: 'Suman', phone: null, emergency_contact: null, blood_group: null, share_ice_with_ride: false, share_phone_with_ride: false,
  motorcycle_make: 'Royal Enfield', motorcycle_model: 'Himalayan 450', motorcycle_category: 'adventure', fuel_tank_capacity_liters: 17, mileage_km_per_liter: 30, fuel_reserve_liters: 3, subscription_tier: 'free' };
let places = [{ id: 'p1', user_id: userId, name: 'Kunzum La', category: 'pass', latitude: 32.3949, longitude: 77.6371, address: null, notes: 'Cold by 4 pm', created_at: new Date().toISOString() }];
let failPlaces = true;
let failDelete = true;
const patches = [];
const calls = {};
let myClubs = [];
const members = () => [
  { user_id: userId, display_name: 'Suman', role: 'owner', joined_at: '2026-03-01T00:00:00Z', rides: 12, km: 1480, last_ride_at: null },
  { user_id: ashaId, display_name: 'Asha Rao', role: ashaRole, joined_at: '2026-04-01T00:00:00Z', rides: 3, km: 410, last_ride_at: null },
  ...(raviIn ? [{ user_id: raviId, display_name: 'Ravi', role: 'member', joined_at: '2026-05-01T00:00:00Z', rides: 0, km: 0, last_ride_at: null }] : []),
];
let ashaRole = 'member';
let raviIn = true;
let deccanRole = null;
const clubs = {
  'deccan-dawn': () => ({
    club: { id: clubId, slug: 'deccan-dawn', name: 'Deccan Dawn', city: 'Pune', description: 'Sunrise rides out of Pune.', join_policy: 'code', verified: true, created_at: '2026-03-01T00:00:00Z' },
    my_role: deccanRole, member_count: 3,
    members: deccanRole ? members() : [], series: deccanRole ? [{ id: 's1', name: 'Sunday dawn ride', recurrence_rule: 'FREQ=WEEKLY;BYDAY=SU', template_ride_id: 'r1', planned_dates: [] }] : [],
    rides: [
      { id: 'r2', name: 'Tamhini loop', status: 'planned', start_date: day(9), distance_km: 140, visibility: 'public' },
      { id: 'r3', name: 'Lavasa run', status: 'planned', start_date: day(2), distance_km: 90, visibility: 'public' },
      { id: 'r1', name: 'Sinhagad sunrise', status: 'completed', start_date: day(-7), distance_km: 60, visibility: 'public' },
    ],
  }),
};

(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser, page;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addCookies([sessionCookie(session)]);
    await context.route('https://ridentrack-test.supabase.co/**', route => {
      const req = route.request(); const url = req.url();
      const rpc = (url.match(/\/rpc\/([a-z_]+)/) || [])[1];
      const body = rpc ? req.postDataJSON() : null;
      if (rpc) (calls[rpc] = calls[rpc] || []).push(body);
      const fail = (msg, status = 400) => route.fulfill({ status, json: { code: 'P0001', message: msg, details: null, hint: null } });
      if (rpc === 'get_my_flags') return route.fulfill({ json: [] });
      if (rpc === 'get_rider_analytics') return route.fulfill({ json: { total_distance_km: 2380.4, total_hours: 61.5, completed_trips: 9, active_trips: 1, milestones: [{ id: 'm1', title: '1,000 km club', description: 'Rode 1,000 km', icon: 'trophy' }] } });
      if (rpc === 'get_user_saved_places') return failPlaces ? fail('timeout', 500) : route.fulfill({ json: places });
      if (rpc === 'add_saved_place') { places = [{ id: 'p' + (places.length + 1), user_id: userId, name: body.p_name, category: body.p_category, latitude: body.p_latitude, longitude: body.p_longitude, address: body.p_address, notes: body.p_notes, created_at: new Date().toISOString() }, ...places]; return route.fulfill({ json: places[0].id }); }
      if (rpc === 'delete_saved_place') { places = places.filter(p => p.id !== body.p_place_id); return route.fulfill({ json: null }); }
      if (rpc === 'delete_user_account') return failDelete ? fail('Account identity was not deleted') : route.fulfill({ json: null });
      if (rpc === 'get_my_clubs') return route.fulfill({ json: myClubs });
      if (rpc === 'create_club') { if (body.p_slug === 'taken-club') return fail('That club link is taken. Try another.'); return route.fulfill({ json: clubId }); }
      if (rpc === 'get_club') { const c = clubs[body.p_slug]; return route.fulfill({ json: c ? c() : null }); }
      if (rpc === 'get_club_join_code') return route.fulfill({ json: 'DAWN42' });
      if (rpc === 'join_club') { if (body.p_code !== 'DAWN42') return fail('Ask a club admin for the join code'); deccanRole = 'member'; return route.fulfill({ json: null }); }
      if (rpc === 'set_club_member_role') { if (body.p_role === 'removed') raviIn = false; else ashaRole = body.p_role; return route.fulfill({ json: null }); }
      if (rpc === 'schedule_series_ride') return route.fulfill({ json: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
      if (rpc === 'leave_club') { deccanRole = null; return route.fulfill({ json: null }); }
      if (url.includes('/rest/v1/profiles')) {
        if (req.method() === 'PATCH') { const b = req.postDataJSON(); patches.push(b); profile = { ...profile, ...b }; }
        return route.fulfill({ json: profile });
      }
      if (url.includes('/auth/v1/user')) return route.fulfill({ json: session.user });
      if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204 });
      return route.fulfill({ json: [] });
    });
    page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));

    // ---------- Profile ----------
    await page.goto(origin + '/app/profile');
    await page.getByRole('heading', { name: 'Suman', level: 1 }).waitFor();
    await page.getByText('2,380.4 km').waitFor();
    await page.getByText('1,000 km club').waitFor();
    await page.getByText('510 km', { exact: true }).waitFor();
    await page.getByText('420 km before reserve').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Profile' }).getAttribute('aria-current'), 'page');

    // Rider: bad phone is refused locally; a good save writes only what changed.
    await page.getByRole('button', { name: 'Edit rider details' }).click();
    await page.getByLabel('Phone').fill('call me');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Check the phone number' }).waitFor();
    assert.equal(patches.length, 0);
    await page.getByLabel('Phone').fill('+91 98765 43210');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Rider details saved' }).waitFor();
    assert.deepEqual(patches.at(-1), { phone: '+91 98765 43210' });

    // Emergency: blood group is upper-cased, ICE consent saved; phone sharing is on by default flag.
    await page.getByRole('button', { name: 'Edit emergency details' }).click();
    await page.getByLabel('Blood group').fill('o+');
    await page.getByLabel(/Let riders on my ride see/).check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Emergency details saved' }).waitFor();
    assert.deepEqual(patches.at(-1), { blood_group: 'O+', share_ice_with_ride: true });

    // Motorcycle: reserve must stay below the tank.
    await page.getByRole('button', { name: 'Edit motorcycle' }).click();
    await page.getByLabel('Reserve (litres)').fill('20');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'less than the tank' }).waitFor();
    await page.getByLabel('Reserve (litres)').fill('2');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('450 km before reserve').waitFor();
    assert.deepEqual(patches.at(-1), { fuel_reserve_liters: 2 });

    // Saved places: a failed read says so; then add (with checks) and remove (with a confirm).
    await page.getByRole('alert').filter({ hasText: 'Could not load your saved places' }).waitFor();
    failPlaces = false;
    await page.getByRole('alert').filter({ hasText: 'saved places' }).getByRole('button', { name: 'Try again' }).click();
    await page.getByText('Kunzum La').waitFor();
    await page.getByRole('button', { name: 'Add place' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Chandratal camp');
    await page.getByLabel('Latitude').fill('95');
    await page.getByLabel('Longitude').fill('77.6');
    await page.getByRole('button', { name: 'Save place' }).click();
    await page.getByRole('alert').filter({ hasText: 'latitude from -90 to 90' }).waitFor();
    assert.equal(calls.add_saved_place, undefined);
    await page.getByLabel('Latitude').fill('32.475');
    await page.getByLabel('Kind of place').selectOption('stay');
    await page.getByRole('button', { name: 'Save place' }).click();
    await page.getByRole('status').filter({ hasText: 'Chandratal camp saved.' }).waitFor();
    assert.deepEqual(calls.add_saved_place.at(-1), { p_name: 'Chandratal camp', p_category: 'stay', p_latitude: 32.475, p_longitude: 77.6, p_address: null, p_notes: null });
    await page.getByRole('heading', { name: 'Saved places (2)' }).waitFor();
    await page.getByRole('button', { name: 'Remove Kunzum La' }).click();
    assert.equal(calls.delete_saved_place, undefined, 'removing asks first');
    await page.getByRole('group', { name: 'Remove Kunzum La?' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('status').filter({ hasText: 'Kunzum La removed.' }).waitFor();
    assert.deepEqual(calls.delete_saved_place.at(-1), { p_place_id: 'p1' });

    // Delete account: typed confirm, a server failure keeps the account and says so.
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Delete account' }).isDisabled(), true);
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete account' }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Your account was not deleted' }).waitFor();
    assert.deepEqual(calls.delete_user_account.at(-1), { p_expected_user_id: userId });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    // ---------- Clubs ----------
    await page.goto(origin + '/app/clubs');
    await page.getByRole('heading', { name: 'No clubs yet.' }).waitFor();
    await page.getByRole('link', { name: 'Start a club' }).first().click();
    await page.getByLabel('Name').fill('Taken Club!');
    assert.equal(await page.getByLabel('Club link').inputValue(), 'taken-club');
    await page.getByRole('button', { name: 'Create club' }).click();
    await page.getByRole('alert').filter({ hasText: 'That club link is taken' }).waitFor();
    await page.getByLabel('Club link').fill('Deccan--Dawn');
    await page.getByText('3 to 40 letters').waitFor();
    assert.equal(await page.getByLabel('Club link').getAttribute('aria-invalid'), 'true');
    await page.getByLabel('Club link').fill('deccan-dawn');
    await page.getByLabel('City').fill('Pune');
    await page.getByLabel(/Join by code only/).check();
    deccanRole = 'owner';
    await page.getByRole('button', { name: 'Create club' }).click();
    await page.waitForURL('**/app/clubs/deccan-dawn');
    assert.deepEqual(calls.create_club.at(-1), { p_name: 'Taken Club!', p_slug: 'deccan-dawn', p_city: 'Pune', p_description: '', p_join_policy: 'code' });

    // Owner view: rides soonest first, join code, roster roles with a confirm before removing.
    await page.getByRole('heading', { name: /Deccan Dawn/, level: 1 }).waitFor();
    await page.getByText('DAWN42').waitFor();
    const next = page.getByRole('region', { name: 'Next rides' }).or(page.locator('section[aria-labelledby="next-heading"]'));
    const rideNames = await next.locator('li .font-medium').allTextContents();
    assert.deepEqual(rideNames, ['Lavasa run', 'Tamhini loop']);
    await page.getByText('12 club rides · 1,480 km').waitFor();
    await page.getByText(/Joined May 2026, no club rides yet/).waitFor();
    await page.getByText('1 ride finished together · 60 km').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Manage Suman' }).count(), 0, 'no actions on yourself');
    await page.getByRole('button', { name: 'Manage Asha Rao' }).click();
    await page.getByRole('group', { name: 'Actions for Asha Rao' }).getByRole('button', { name: 'Make admin' }).click();
    await page.getByRole('status').filter({ hasText: 'Asha Rao is now an admin.' }).waitFor();
    assert.deepEqual(calls.set_club_member_role.at(-1), { p_club_id: clubId, p_user_id: ashaId, p_role: 'admin' });
    await page.getByRole('button', { name: 'Manage Ravi' }).click();
    await page.getByRole('group', { name: 'Actions for Ravi' }).getByRole('button', { name: 'Remove from club' }).click();
    assert.equal(calls.set_club_member_role.length, 1, 'removing asks first');
    await page.getByRole('group', { name: 'Actions for Ravi' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Ravi was removed from the club.' }).waitFor();
    assert.equal(await page.getByText('Ravi', { exact: true }).count(), 0);

    // New regular ride form needs a name and a template trip.
    await page.getByRole('button', { name: 'New regular ride' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Saturday loop');
    await page.getByText('Sat', { exact: true }).click();
    await page.getByLabel('How often').selectOption('fortnight');
    await page.getByText('Every other Saturday').waitFor();
    await page.getByRole('button', { name: 'Save regular ride' }).click();
    await page.getByRole('alert').filter({ hasText: 'Pick one of the club’s trips' }).waitFor();
    await page.getByLabel('Copy this trip each time').selectOption('r1');
    await page.getByRole('button', { name: 'Save regular ride' }).click();
    await page.getByRole('status').filter({ hasText: 'Saturday loop added.' }).waitFor();
    assert.deepEqual(calls.create_club_series.at(-1), { p_club_id: clubId, p_name: 'Saturday loop', p_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', p_template_ride_id: 'r1' });

    // Planning the next date opens the new trip.
    await page.getByRole('button', { name: /^Plan / }).click();
    await page.waitForURL('**/app/trips/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    assert.equal(calls.schedule_series_ride.at(-1).p_series_id, 's1');

    // Visitor view: no roster, join needs the code; a wrong code is reported.
    deccanRole = null;
    await page.goto(origin + '/app/clubs/deccan-dawn');
    const join = page.getByRole('button', { name: 'Join Deccan Dawn' });
    await join.waitFor();
    assert.equal(await join.isDisabled(), true);
    assert.equal(await page.getByRole('heading', { name: 'Roster' }).count(), 0);
    await page.getByLabel('Join code').fill('wrong1');
    await join.click();
    await page.getByRole('alert').filter({ hasText: 'Ask a club admin for the join code' }).waitFor();
    await page.getByLabel('Join code').fill('dawn42');
    await join.click();
    await page.getByRole('status').filter({ hasText: 'Welcome to Deccan Dawn.' }).waitFor();
    assert.equal(calls.join_club.at(-1).p_code, 'DAWN42');
    await page.getByText('You are a member.').waitFor();

    // Leaving asks first.
    await page.getByRole('button', { name: 'Leave club' }).click();
    await page.getByRole('group', { name: 'Leave Deccan Dawn?' }).getByRole('button', { name: 'Leave' }).click();
    await page.getByRole('status').filter({ hasText: 'You left Deccan Dawn.' }).waitFor();

    await page.goto(origin + '/app/clubs/no-such-club');
    await page.getByRole('heading', { name: 'Club not found' }).waitFor();

    // My clubs list.
    myClubs = [{ id: clubId, slug: 'deccan-dawn', name: 'Deccan Dawn', city: 'Pune', verified: true, role: 'owner', member_count: 3, next_ride: { id: 'r3', name: 'Lavasa run', start_date: day(2) } }];
    await page.goto(origin + '/app/clubs');
    await page.getByRole('link', { name: /Deccan Dawn/ }).waitFor();
    await page.getByText('Lavasa run').waitFor();

    // Phone width: nothing scrolls sideways.
    deccanRole = 'owner'; raviIn = true;
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of ['/app/profile', '/app/clubs', '/app/clubs/deccan-dawn', '/app/clubs/new']) {
      await page.goto(origin + path);
      await page.locator('h1').first().waitFor();
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${path} scrolls sideways by ${overflow}px at 360px`);
    }

    assert.deepEqual(errors, []);
    console.log('Profile and club browser checks passed.');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
