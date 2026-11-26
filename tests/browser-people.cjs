// People on a trip: RSVP, invite link, leader tools (roles, attendance, remove,
// hand over), join by code or link, and leave. Supabase is mocked.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';
const userId = '11111111-1111-4111-8111-111111111111';
const ashaId = '22222222-2222-4222-8222-222222222222';
const raviId = '33333333-3333-4333-8333-333333333333';
const tripId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const now = Math.floor(Date.now() / 1000);
const session = {
  access_token: Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: userId, exp: now + 3600, role: 'authenticated' })).toString('base64url') + '.test',
  refresh_token: 'test-refresh', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer',
  user: { id: userId, email: 'rider@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
};
const sessionCookie = s => ({ name: 'sb-ridentrack-test-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url'), url: origin });
const trip = { id: tripId, name: 'Spiti Valley Loop', ride_code: 'SPITI1', admin_id: userId, origin: 'Shimla', destination: 'Kaza', origin_coords: [77.17, 31.1], destination_coords: [78.07, 32.22], status: 'planned', trip_type: 'touring', visibility: 'invite_only', start_date: '2027-06-10', end_date: '2027-06-12', created_at: new Date().toISOString() };
let roster = [
  { user_id: userId, display_name: 'Suman', role: 'captain', is_active: true, last_seen: null, attendance_status: 'confirmed' },
  { user_id: ashaId, display_name: 'Asha Rao', role: 'member', is_active: true, last_seen: null, attendance_status: 'tentative' },
  { user_id: raviId, display_name: 'Ravi', role: 'sweeper', is_active: true, last_seen: null, attendance_status: 'confirmed' },
];
const calls = {};
let checklist = [];
const seeded = [
  { id: 'c1', category: 'fuel_tires', title: 'Tyre pressure checked', description: 'Cold pressure, front and rear.', is_mandatory: true, sequence: 1, my_completed: false, completed_count: 2, assigned_to_user_id: null },
  { id: 'c2', category: 'emergency_kit', title: 'Puncture kit', description: null, is_mandatory: false, sequence: 2, my_completed: false, completed_count: 0, assigned_to_user_id: raviId },
];
let failToggle = false;

(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser, page;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    browser = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addCookies([sessionCookie(session)]);
    await context.route('https://api.mapbox.com/**', r => r.request().url().includes('/styles/')
      ? r.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0c0c0e' } }] } })
      : r.fulfill({ json: {} }));
    await context.route('https://events.mapbox.com/**', r => r.fulfill({ status: 204 }));
    await context.route('https://ridentrack-test.supabase.co/**', route => {
      const req = route.request(); const url = req.url();
      const rpc = (url.match(/\/rpc\/([a-z_]+)/) || [])[1];
      const body = rpc ? req.postDataJSON() : null;
      if (rpc) (calls[rpc] = calls[rpc] || []).push(body);
      if (rpc === 'get_trip_roster') return route.fulfill({ json: roster });
      if (rpc === 'update_participant_attendance') { roster = roster.map(r => r.user_id === (body.p_target_user_id ?? userId) ? { ...r, attendance_status: body.p_status } : r); return route.fulfill({ json: body.p_status }); }
      if (rpc === 'set_trip_participant_role') return route.fulfill({ status: 204, body: '' });
      if (rpc === 'remove_trip_participant') { roster = roster.filter(r => r.user_id !== body.p_user_id); return route.fulfill({ status: 204, body: '' }); }
      if (rpc === 'transfer_trip_leadership') { trip.admin_id = body.p_new_admin_id; roster = roster.map(r => r.user_id === body.p_new_admin_id ? { ...r, role: 'captain' } : r.user_id === userId ? { ...r, role: 'member' } : r); return route.fulfill({ status: 204, body: '' }); }
      if (rpc === 'leave_ride') return route.fulfill({ status: 204, body: '' });
      if (rpc === 'join_ride_by_code') return body.p_code === 'SPITI1' ? route.fulfill({ json: tripId }) : route.fulfill({ status: 400, json: { code: 'P0001', message: 'Invalid ride code or ride has ended', details: null, hint: null } });
      if (rpc === 'get_trip_checklists') return route.fulfill({ json: checklist });
      if (rpc === 'seed_default_trip_checklists') { checklist = seeded.map(i => ({ ...i })); return route.fulfill({ status: 204, body: '' }); }
      if (rpc === 'toggle_trip_checklist_item') return failToggle ? route.fulfill({ status: 400, json: { code: 'P0001', message: 'You must be a trip participant to check off items' } }) : route.fulfill({ json: body.p_completed });
      if (rpc === 'claim_trip_checklist_item') return route.fulfill({ status: 204, body: '' });
      if (rpc === 'get_my_flags') return route.fulfill({ json: [] });
      if (url.includes('/auth/v1/user')) return route.fulfill({ json: session.user });
      if (url.includes('/rest/v1/profiles')) return route.fulfill({ json: { id: userId, display_name: 'Suman', subscription_tier: 'free' } });
      if (url.includes('/rest/v1/ride_participants')) return route.fulfill({ json: [{ ride_id: tripId, rides: trip }] });
      if (url.includes('/rest/v1/rides')) return route.fulfill({ json: trip });
      return route.fulfill({ json: [] });
    });
    page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));

    // Join: a shared link pre-fills the code; a wrong code explains itself.
    await page.goto(origin + '/app/join?code=wrong-1');
    await page.getByRole('heading', { name: 'Got an invite?' }).waitFor();
    assert.equal(await page.getByLabel('Invite code').inputValue(), 'WRONG1');
    await page.getByRole('button', { name: 'Join trip' }).click();
    await page.getByRole('alert').filter({ hasText: 'No open trip uses that code' }).waitFor();
    await page.goto(origin + '/app/join?code=spiti1');
    await page.getByRole('button', { name: 'Join trip' }).click();
    await page.waitForURL(u => u.pathname === '/app/trips/' + tripId);
    assert.equal(calls.join_ride_by_code.at(-1).p_code, 'SPITI1');

    // Tabs: Plan opens first, the rest are one click (or arrow key) away.
    assert.equal(await page.getByRole('tab', { name: 'Plan' }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('heading', { name: /Riders/ }).count(), 0, 'other tabs stay hidden');
    await page.getByRole('tab', { name: 'Plan' }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: /Riders/ }).getAttribute('aria-selected'), 'true', 'arrow keys move between tabs');
    assert.equal(new URL(page.url()).hash, '#riders');

    // Roster and RSVP.
    await page.getByRole('heading', { name: /Riders/ }).waitFor();
    const list = page.getByRole('list', { name: 'Riders on this trip' });
    await list.getByText('Asha Rao', { exact: true }).first().waitFor();
    assert.equal(await list.getByRole('listitem').count(), 3);
    await list.getByText('Member · Maybe').waitFor();
    await page.getByRole('button', { name: 'Maybe', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'You are marked maybe.' }).waitFor();
    assert.deepEqual(calls.update_participant_attendance.at(-1), { p_ride_id: tripId, p_status: 'tentative', p_target_user_id: null });
    assert.equal(await page.getByRole('button', { name: 'Maybe', exact: true }).getAttribute('aria-pressed'), 'true');

    // Invite link.
    await page.getByRole('button', { name: 'Copy invite link' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), origin + '/app/join?code=SPITI1');

    // Leader tools.
    assert.equal(await page.getByRole('button', { name: 'Manage Suman' }).count(), 0, 'no tools on yourself');
    await page.getByRole('button', { name: 'Manage Asha Rao' }).click();
    await page.getByLabel('Role').selectOption('marshal');
    await page.getByRole('status').filter({ hasText: 'Asha Rao is now marshal.' }).waitFor();
    assert.deepEqual(calls.set_trip_participant_role.at(-1), { p_ride_id: tripId, p_user_id: ashaId, p_role: 'marshal' });
    await page.getByLabel('Attendance').selectOption('confirmed');
    await page.getByRole('status').filter({ hasText: 'Asha Rao marked going.' }).waitFor();
    assert.equal(calls.update_participant_attendance.at(-1).p_target_user_id, ashaId);
    await page.screenshot({ path: 'test-results/trip-people-desktop.png' });
    await page.getByRole('button', { name: 'Remove from trip' }).click();
    await page.getByRole('alertdialog').getByText('Remove Asha Rao from “Spiti Valley Loop”?').waitFor();
    await page.getByRole('button', { name: 'Remove rider' }).click();
    await page.getByRole('status').filter({ hasText: 'Asha Rao was removed' }).waitFor();
    assert.equal(await list.getByRole('listitem').count(), 2);
    assert.deepEqual(calls.remove_trip_participant.at(-1), { p_ride_id: tripId, p_user_id: ashaId });

    // Checklist: the leader seeds defaults once, ticks are personal, gear can be claimed.
    await page.getByRole('tab', { name: 'Checklist' }).click();
    await page.getByRole('heading', { name: 'Pre-ride checklist' }).waitFor();
    await page.getByLabel(/Tyre pressure checked/).waitFor();
    assert.equal(calls.seed_default_trip_checklists.length, 1);
    await page.getByText('0/2 ready').waitFor();
    await page.getByText('bringing it: Ravi').waitFor();
    await page.getByLabel(/Tyre pressure checked/).check();
    await page.getByText('1/2 ready').waitFor();
    assert.deepEqual(calls.toggle_trip_checklist_item.at(-1), { p_checklist_id: 'c1', p_completed: true });
    await page.getByText('3 riders ticked').waitFor();
    await page.getByRole('button', { name: /bring it.*Tyre pressure/ }).click();
    await page.getByText('3 riders ticked · bringing it: you').waitFor();
    assert.deepEqual(calls.claim_trip_checklist_item.at(-1), { p_checklist_id: 'c1', p_assign_to_self: true });
    failToggle = true;
    // click(), not check(): the tick is rolled back on purpose, and check() fails if
    // the rollback lands before it re-reads the box.
    await page.getByLabel(/Puncture kit/).click();
    await page.getByRole('alert').filter({ hasText: 'trip participant' }).waitFor();
    assert.equal(await page.getByLabel(/Puncture kit/).isChecked(), false, 'a failed tick rolls back');
    await page.getByText('1/2 ready').waitFor();
    failToggle = false;
    await page.getByRole('heading', { name: 'Pre-ride checklist' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/trip-checklist-desktop.png' });

    // Hand over, then leave as an ordinary rider.
    await page.getByRole('tab', { name: /Riders/ }).click();
    await page.getByRole('button', { name: 'Manage Ravi' }).click();
    await page.getByRole('button', { name: 'Make trip leader' }).click();
    await page.getByRole('button', { name: 'Hand over' }).click();
    await page.getByRole('status').filter({ hasText: 'Ravi now leads the trip.' }).waitFor();
    assert.deepEqual(calls.transfer_trip_leadership.at(-1), { p_ride_id: tripId, p_new_admin_id: raviId });
    await page.getByRole('button', { name: 'Leave this trip' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Manage / }).count(), 0, 'leader tools gone after handing over');
    assert.equal(await page.getByRole('button', { name: 'Edit details' }).count(), 0);
    await page.getByRole('button', { name: 'Leave this trip' }).click();
    await page.getByRole('button', { name: 'Leave trip' }).click();
    await page.waitForURL(u => u.pathname === '/app/trips');
    assert.deepEqual(calls.leave_ride.at(-1), { p_ride_id: tripId });

    // Phone width.
    trip.admin_id = userId;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(origin + '/app/trips/' + tripId + '#riders');
    await page.getByRole('list', { name: 'Riders on this trip' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll at 360px');
    assert.equal(await page.evaluate(() => { const t = document.querySelector('[role=tablist]'); return t.scrollWidth <= t.clientWidth + 1 || getComputedStyle(t).overflowX === 'auto'; }), true, 'tab strip scrolls inside itself');
    await page.getByRole('heading', { name: /Riders/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/trip-people-mobile.png' });
    await page.goto(origin + '/app/join');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'join page fits at 360px');
    await page.screenshot({ path: 'test-results/join-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('People browser checks passed: join by link and code (with error), roster, RSVP, invite link, roles, attendance, remove, tabs (click, arrow keys, #hash), checklist seed/tick/claim/rollback, hand over, leave, phone width; no page errors.');
  } catch (error) {
    if (page) { fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/people-failure.png', fullPage: true }); }
    throw error;
  } finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
