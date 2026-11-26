// Site foundation: the /app gate, old-URL redirects, sign in with a return
// path, and no sideways scroll at 360, 768 and 1440 px. Supabase and Mapbox are
// mocked; no real project or production data is touched.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';
const userId = '11111111-1111-4111-8111-111111111111';
const tripId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const now = Math.floor(Date.now() / 1000);
const session = {
  access_token: Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: userId, exp: now + 3600, role: 'authenticated' })).toString('base64url') + '.test',
  refresh_token: 'test-refresh', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer',
  user: { id: userId, email: 'rider@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
};
const sessionCookie = s => ({ name: 'sb-ridentrack-test-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url'), url: origin });
const ride = { id: tripId, name: 'Spiti Valley Loop', ride_code: 'SPITI1', admin_id: userId, origin: 'Shimla', destination: 'Kaza', origin_coords: [77.17, 31.1], destination_coords: [78.07, 32.22], status: 'planned', trip_type: 'touring', start_date: '2027-06-10', end_date: '2027-06-12', created_at: new Date().toISOString() };
const WIDTHS = [360, 768, 1440];

async function mock(context) {
  await context.route('https://api.mapbox.com/**', r => r.request().url().includes('/styles/')
    ? r.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0c0c0e' } }] } })
    : r.fulfill({ json: {} }));
  await context.route('https://events.mapbox.com/**', r => r.fulfill({ status: 204 }));
  await context.route('https://ridentrack-test.supabase.co/**', route => {
    const url = route.request().url();
    if (url.includes('/auth/v1/token')) return route.fulfill({ json: session });
    if (url.includes('/auth/v1/user')) return route.fulfill({ json: session.user });
    if (url.includes('/rest/v1/profiles')) return route.fulfill({ json: { id: userId, display_name: 'Suman', subscription_tier: 'free' } });
    if (url.includes('/rest/v1/ride_participants')) return route.fulfill({ json: [{ ride_id: tripId, rides: ride }] });
    if (url.includes('/rest/v1/rides')) return route.fulfill({ json: ride });
    if (url.includes('/rest/v1/trip_waypoints') || url.includes('/rest/v1/trip_days')) return route.fulfill({ json: [] });
    if (url.includes('/rpc/get_my_flags')) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
}

async function noSidewaysScroll(page, label) {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.equal(ok, true, `no horizontal scroll: ${label}`);
}

(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser, page;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    browser = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    fs.mkdirSync('test-results/foundation', { recursive: true });

    // Signed out: the gate answers before any app code runs.
    const gate = await fetch(origin + '/app/trips/new', { redirect: 'manual' });
    assert.equal(gate.status, 307);
    assert.equal(new URL(gate.headers.get('location'), origin).pathname + new URL(gate.headers.get('location'), origin).search, '/login?next=%2Fapp%2Ftrips%2Fnew');
    for (const [from, to] of [['/dashboard', '/app'], ['/trips', '/app/trips'], ['/trips/new', '/app/trips/new'], ['/trip?id=' + tripId, '/app/trips/' + tripId], ['/ride?id=' + tripId, '/app/rides/' + tripId], ['/trip?id=not-a-uuid', '/app/trips']]) {
      const res = await fetch(origin + from, { redirect: 'manual' });
      assert.ok([307, 308].includes(res.status), from + ' redirects');
      assert.equal(new URL(res.headers.get('location'), origin).pathname, to, from + ' → ' + to);
    }
    for (const path of ['/', '/download', '/login', '/register']) {
      const res = await fetch(origin + path);
      assert.equal(res.status, 200, path + ' is public');
    }

    // Sign in returns to the page that asked for it, and only to same-site app paths.
    const signedOut = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await mock(signedOut);
    page = await signedOut.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/app/trips');
    await page.waitForURL(u => u.pathname === '/login');
    await page.getByLabel('Email').fill('rider@example.test');
    await page.getByLabel('Password').fill('test-only-fixture');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(u => u.pathname === '/app/trips');
    await page.getByRole('heading', { name: 'Your trips' }).waitFor();
    assert.ok((await signedOut.cookies()).some(c => c.name.startsWith('sb-ridentrack-test-auth-token')), 'session is kept in a cookie');
    await signedOut.clearCookies();
    await page.goto(origin + '/login?next=https://evil.example/app');
    await page.getByLabel('Email').fill('rider@example.test');
    await page.getByLabel('Password').fill('test-only-fixture');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(u => u.pathname === '/app');
    assert.equal(new URL(page.url()).origin, origin, 'never leaves the site after sign in');
    await signedOut.close();

    // Every screen at three widths: renders, no sideways scroll, screenshot for review.
    const screens = [
      { path: '/', heading: 'Plan the road. Ride it together.', auth: false },
      { path: '/download', heading: 'The ride happens on your phone.', auth: false },
      { path: '/login', heading: 'Sign in', auth: false },
      { path: '/register', heading: 'Create your account', auth: false },
      { path: '/app', heading: 'Your rides', auth: true },
      { path: '/app/trips', heading: 'Your trips', auth: true },
      { path: '/app/trips/new', heading: 'Plan a trip', auth: true },
      { path: '/app/trips/' + tripId, heading: 'Spiti Valley Loop', auth: true },
      { path: '/app/trips/' + tripId + '/route', heading: 'Edit route', auth: true },
    ];
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, reducedMotion: 'reduce' });
      await mock(context);
      await context.addCookies([sessionCookie(session)]);
      page = await context.newPage();
      page.on('pageerror', e => errors.push(`${width}px: ${e.message}`));
      for (const screen of screens) {
        await page.goto(origin + screen.path);
        if (screen.path === '/login') { await page.waitForURL(u => u.pathname === '/app'); continue; } // signed in already
        await page.getByRole('heading', { level: 1, name: screen.heading }).waitFor();
        await noSidewaysScroll(page, `${screen.path} at ${width}px`);
        const name = (screen.path === '/' ? 'home' : screen.path.slice(1).replaceAll('/', '-').replace(tripId, 'id'));
        await page.screenshot({ path: `test-results/foundation/${name}-${width}.png`, fullPage: !screen.auth });
      }
      if (width === 1440) {
        assert.equal(await page.getByRole('link', { name: 'Trips', exact: true }).getAttribute('aria-current'), 'page');
        await context.clearCookies();
        await page.goto(origin + '/login');
        await page.getByRole('heading', { level: 1, name: 'Sign in' }).waitFor();
        await noSidewaysScroll(page, '/login at 1440px');
        await page.screenshot({ path: 'test-results/foundation/login-1440.png' });
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(`Foundation browser checks passed: /app gate, ${6} old-URL redirects, sign in with safe return path, cookie session, ${screens.length} screens at ${WIDTHS.join('/')} px without sideways scroll; no page errors.`);
  } catch (error) {
    if (page) { fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/foundation-failure.png', fullPage: true }); }
    throw error;
  } finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
