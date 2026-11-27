// Waitlist: the form on the home page and /waitlist passes a Turnstile check
// and posts to the waitlist-join Edge Function; /waitlist/confirm opens the
// emailed link. Turnstile, the function and the database calls are mocked here
// (the database rules are tested in tests/db/190_waitlist.sql). The header
// buttons are compact. No network calls leave the machine.
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
    let placesLeft = 3, joinReply = { status: 200, json: { status: 'check_email' } }, confirmReply = { status: 200, json: { status: 'confirmed', early: true } };
    let turnstileWorks = true;

    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
    const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    await context.route(u => !u.href.startsWith(origin) && !u.href.startsWith(API) && u.href !== TURNSTILE, r => r.abort());
    // Stand-in for Cloudflare's widget: passes at once with a fixed token.
    await context.route(TURNSTILE, r => turnstileWorks
      ? r.fulfill({ contentType: 'text/javascript', body: "window.turnstile={render:function(el,o){window.__ts=o;el.dataset.widget='1';setTimeout(function(){o.callback('test-turnstile-token')},0);return 'w1'},reset:function(){setTimeout(function(){window.__ts.callback('test-turnstile-token')},0)}};" })
      : r.abort());
    await context.route(API + '/rest/v1/rpc/**', async r => {
      const name = new URL(r.request().url()).pathname.split('/').pop();
      calls.push({ name, body: r.request().postDataJSON(), apikey: r.request().headers().apikey });
      if (name === 'waitlist_places_left') return r.fulfill({ status: 200, json: placesLeft });
      if (name === 'confirm_waitlist') return r.fulfill(confirmReply);
      return r.fulfill({ status: 404, json: {} });
    });
    await context.route(API + '/functions/v1/waitlist-join', async r => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
      calls.push({ name: 'waitlist-join', body: r.request().postDataJSON(), apikey: r.request().headers().apikey });
      return r.fulfill(joinReply);
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
    assert.equal(calls.filter(c => c.name === 'waitlist-join').length, 0, 'bad email is caught before the request');

    await home.getByLabel('Email').fill('  rider@example.test ');
    await home.getByLabel('Name (optional)').fill('Asha');
    await home.getByRole('button', { name: 'Join the waitlist' }).click();
    await home.getByRole('status').filter({ hasText: 'Check your email.' }).waitFor();
    await home.getByText('The first 10 people to confirm get Pro free for 3 months.').waitFor();
    const join = calls.find(c => c.name === 'waitlist-join');
    assert.deepEqual(join.body, { email: 'rider@example.test', name: 'Asha', turnstile_token: 'test-turnstile-token' });
    assert.equal(join.apikey, 'test-only-placeholder', 'uses the public key only');
    await page.screenshot({ path: 'test-results/marketing/waitlist-joined-360.png' });

    // /waitlist page: offer full, server error message, then a normal signup.
    placesLeft = 0;
    joinReply = { status: 400, json: { error: 'Enter a valid email address.' } };
    await page.goto(origin + '/waitlist');
    await page.getByText('All 10 free Pro places are taken').waitFor();
    await page.getByText('The first 10 people on the list get Pro free for 3 months.').waitFor();
    assert.match(await page.locator('meta[name="description"]').getAttribute('content'), /first 10 people get Pro free for 3 months/);
    await page.getByLabel('Email').fill('odd@example.test');
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('alert').filter({ hasText: 'Enter a valid email address.' }).waitFor();
    joinReply = { status: 500, json: {} };
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('alert').filter({ hasText: 'Couldn’t join the waitlist just now.' }).waitFor();
    joinReply = { status: 429, json: {} };
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('alert').filter({ hasText: 'Too many tries.' }).waitFor();
    joinReply = { status: 200, json: { status: 'check_email' } };
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('status').filter({ hasText: 'Check your email.' }).waitFor();
    await page.screenshot({ path: 'test-results/marketing/waitlist-page-360.png', fullPage: true });

    // A bot filling the hidden field gets the normal answer and nothing is sent.
    const before = calls.filter(c => c.name === 'waitlist-join').length;
    await page.goto(origin + '/waitlist');
    await page.getByLabel('Email').fill('bot@example.test');
    await page.locator('input[name="website"]').fill('spam', { force: true });
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    await page.getByRole('status').filter({ hasText: 'Check your email.' }).waitFor();
    assert.equal(calls.filter(c => c.name === 'waitlist-join').length, before, 'honeypot signup is not sent');

    // Turnstile blocked: the form says so and sends nothing.
    turnstileWorks = false;
    const ctx2 = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
    await ctx2.route(u => !u.href.startsWith(origin), r => r.abort());
    const blocked = await ctx2.newPage();
    blocked.on('pageerror', e => errors.push(e.message));
    await blocked.goto(origin + '/waitlist');
    await blocked.getByLabel('Email').fill('blocked@example.test');
    await blocked.getByRole('button', { name: 'Join the waitlist' }).click();
    await blocked.getByRole('alert').filter({ hasText: 'The bot check couldn’t load.' }).waitFor();
    await ctx2.close();
    turnstileWorks = true;

    // The emailed link: confirmed early, confirmed later, expired, broken.
    const token = 'ab'.repeat(32);
    await page.goto(origin + '/waitlist/confirm?token=' + token);
    await page.getByRole('status').filter({ hasText: 'You’re one of the first 10.' }).waitFor();
    assert.deepEqual(calls.filter(c => c.name === 'confirm_waitlist').pop().body, { p_token: token });
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
    await page.screenshot({ path: 'test-results/marketing/waitlist-confirmed-360.png' });
    confirmReply = { status: 200, json: { status: 'confirmed', early: false } };
    await page.goto(origin + '/waitlist/confirm?token=' + token);
    await page.getByRole('status').filter({ hasText: 'You’re on the list.' }).waitFor();
    confirmReply = { status: 200, json: { status: 'expired' } };
    await page.goto(origin + '/waitlist/confirm?token=' + token);
    await page.getByRole('alert').filter({ hasText: 'This link has expired.' }).waitFor();
    const confirmCalls = calls.filter(c => c.name === 'confirm_waitlist').length;
    await page.goto(origin + '/waitlist/confirm?token=nope');
    await page.getByRole('alert').filter({ hasText: 'This link doesn’t work.' }).waitFor();
    assert.equal(calls.filter(c => c.name === 'confirm_waitlist').length, confirmCalls, 'a malformed token is not sent');

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
