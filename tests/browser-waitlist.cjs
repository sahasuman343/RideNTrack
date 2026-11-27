// Waitlist: the form on the home page and /waitlist calls the public
// join_waitlist and waitlist_places_left functions (mocked here; the database
// rules are tested in tests/db/190_waitlist.sql). The header buttons are compact.
// No network calls leave the machine.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';
const API = 'https://ridentrack-test.supabase.co';

(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    fs.mkdirSync('test-results/marketing', { recursive: true });
    browser = await chromium.launch();
    const errors = [];
    const calls = [];
    let placesLeft = 3, joinReply = { status: 200, json: { early: true } };

    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
    await context.route(u => !u.href.startsWith(origin) && !u.href.startsWith(API), r => r.abort());
    await context.route(API + '/rest/v1/rpc/**', async r => {
      const name = new URL(r.request().url()).pathname.split('/').pop();
      calls.push({ name, body: r.request().postDataJSON(), apikey: r.request().headers().apikey });
      if (name === 'waitlist_places_left') return r.fulfill({ status: 200, json: placesLeft });
      if (name === 'join_waitlist') return r.fulfill(joinReply);
      return r.fulfill({ status: 404, json: {} });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));

    // Header: compact buttons that fit a 360 px screen, with a waitlist link.
    await page.goto(origin + '/');
    const header = page.locator('header').first();
    for (const name of ['Create account', 'Join waitlist']) {
      const box = await header.getByRole('link', { name }).boundingBox();
      assert.ok(box && box.height <= 36, `${name} button is compact: ${box && box.height}px`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'header fits at 360px');

    // Home page form.
    const home = page.locator('#waitlist');
    await home.getByRole('heading', { name: 'First 10 get Pro free.' }).waitFor();
    await home.getByText('the first 10 people get Pro free for 3 months').waitFor();
    await home.getByText('3 of 10 free Pro places left').waitFor();
    await home.getByLabel('Email').fill('not-an-email');
    await home.getByRole('button', { name: 'Join the waitlist' }).click();
    await home.getByRole('alert').filter({ hasText: 'Enter a valid email address.' }).waitFor();
    assert.equal(calls.filter(c => c.name === 'join_waitlist').length, 0, 'bad email is caught before the request');

    await home.getByLabel('Email').fill('  rider@example.test ');
    await home.getByLabel('Name (optional)').fill('Asha');
    await home.getByRole('button', { name: 'Join the waitlist' }).click();
    await home.getByRole('status').filter({ hasText: 'You’re one of the first 10.' }).waitFor();
    await home.getByText('Pro is yours free for 3 months').waitFor();
    const join = calls.find(c => c.name === 'join_waitlist');
    assert.deepEqual(join.body, { p_email: 'rider@example.test', p_name: 'Asha' });
    assert.equal(join.apikey, 'test-only-placeholder', 'uses the public key only');
    await page.screenshot({ path: 'test-results/marketing/waitlist-joined-360.png' });

    // /waitlist page: offer full, server error message, then a normal signup.
    placesLeft = 0;
    joinReply = { status: 400, json: { message: 'Enter a valid email address' } };
    await page.goto(origin + '/waitlist');
    await page.getByText('All 10 free Pro places are taken').waitFor();
    await page.getByText('The first 10 people on the list get Pro free for 3 months.').waitFor();
    assert.match(await page.locator('meta[name="description"]').getAttribute('content'), /first 10 people get Pro free for 3 months/);
    await page.getByLabel('Email').fill('odd@example.test');
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('alert').filter({ hasText: 'Enter a valid email address.' }).waitFor();
    joinReply = { status: 503, json: {} };
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('alert').filter({ hasText: 'Couldn’t join the waitlist just now.' }).waitFor();
    joinReply = { status: 200, json: { early: false } };
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('status').filter({ hasText: 'You’re on the list.' }).waitFor();
    await page.screenshot({ path: 'test-results/marketing/waitlist-page-360.png', fullPage: true });

    // A bot filling the hidden field gets the normal answer and nothing is sent.
    const before = calls.filter(c => c.name === 'join_waitlist').length;
    await page.goto(origin + '/waitlist');
    await page.getByLabel('Email').fill('bot@example.test');
    await page.locator('input[name="website"]').fill('spam', { force: true });
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('status').filter({ hasText: 'You’re on the list.' }).waitFor();
    assert.equal(calls.filter(c => c.name === 'join_waitlist').length, before, 'honeypot signup is not sent');

    // Without the places count (API down), the form still works.
    await context.unroute(API + '/rest/v1/rpc/**');
    await context.route(API + '/**', r => r.abort());
    await page.goto(origin + '/waitlist');
    await page.getByRole('button', { name: 'Join the waitlist' }).waitFor();
    assert.equal(await page.getByText(/free Pro places/).count(), 0, 'no count shown when it can’t be read');
    await page.getByLabel('Email').fill('offline@example.test');
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('alert').filter({ hasText: 'No connection.' }).waitFor();

    assert.deepEqual(errors, []);
    console.log('Waitlist browser checks passed.');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
