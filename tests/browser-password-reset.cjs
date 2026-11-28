// Password reset on the web: the sign-in link, asking for a reset email (same
// answer for any address, rate limit shown), the emailed link's code exchange,
// choosing a new password, and an expired link. Supabase is mocked.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';
const userId = '11111111-1111-4111-8111-111111111111';
const now = Math.floor(Date.now() / 1000);
const session = {
  access_token: Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: userId, exp: now + 3600, role: 'authenticated' })).toString('base64url') + '.test',
  refresh_token: 'test-refresh', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer',
  user: { id: userId, email: 'rider@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
};

(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    browser = await chromium.launch();
    const errors = [];
    const calls = { recover: [], token: [], user: [] };
    let recoverStatus = 200, updateStatus = 200;
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.route('https://ridentrack-test.supabase.co/**', route => {
      const req = route.request(), url = req.url();
      if (url.includes('/auth/v1/recover')) {
        calls.recover.push({ url, body: req.postDataJSON() });
        return recoverStatus === 200 ? route.fulfill({ json: {} }) : route.fulfill({ status: recoverStatus, json: { code: 'over_email_send_rate_limit', msg: 'Email rate limit exceeded' } });
      }
      if (url.includes('/auth/v1/token')) { calls.token.push({ url, body: req.postDataJSON() }); return route.fulfill({ json: session }); }
      if (url.includes('/auth/v1/user') && req.method() === 'PUT') {
        calls.user.push(req.postDataJSON());
        return updateStatus === 200 ? route.fulfill({ json: session.user }) : route.fulfill({ status: updateStatus, json: { code: 'same_password', msg: 'New password should be different from the old password.' } });
      }
      if (url.includes('/auth/v1/user')) return route.fulfill({ status: 401, json: { msg: 'no session' } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));

    // Sign-in links to the reset page.
    await page.goto(origin + '/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await page.getByRole('heading', { level: 1, name: 'Reset your password' }).waitFor();

    // A malformed address is caught before anything is sent.
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.getByRole('alert').filter({ hasText: 'Enter the email address' }).waitFor();
    assert.equal(calls.recover.length, 0);

    // Rate limit is explained.
    recoverStatus = 429;
    await page.getByLabel('Email').fill('rider@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.getByRole('alert').filter({ hasText: 'Too many requests' }).waitFor();

    // Success reads the same whether or not the account exists, and links back here.
    recoverStatus = 200;
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.getByRole('status').filter({ hasText: 'If rider@example.test has a rideNtrack account' }).waitFor();
    const sent = calls.recover.at(-1);
    assert.equal(sent.body.email, 'rider@example.test');
    assert.equal(new URL(sent.url).searchParams.get('redirect_to'), origin + '/reset-password');
    assert.ok(sent.body.code_challenge, 'PKCE challenge sent so the link only works in this browser');

    // The emailed link lands with ?code=; it is exchanged for a recovery session.
    await page.goto(origin + '/reset-password?code=test-recovery-code');
    await page.getByRole('heading', { level: 1, name: 'Choose a new password' }).waitFor();
    await page.getByLabel('New password').waitFor();
    assert.ok(calls.token.some(c => c.url.includes('grant_type=pkce') && c.body.auth_code === 'test-recovery-code'), 'code exchanged');

    await page.getByLabel('New password').fill('abc');
    await page.getByLabel('Type it again').fill('abc');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.getByRole('alert').filter({ hasText: 'Use at least 8 characters.' }).waitFor();
    await page.getByLabel('New password').fill('test-only-fixture-2');
    await page.getByLabel('Type it again').fill('test-only-fixture-3');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.getByRole('alert').filter({ hasText: 'don’t match' }).waitFor();
    assert.equal(calls.user.length, 0, 'nothing saved until the form is valid');

    updateStatus = 422;
    await page.getByLabel('Type it again').fill('test-only-fixture-2');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.getByRole('alert').filter({ hasText: 'haven’t used' }).waitFor();

    updateStatus = 200;
    await page.getByRole('button', { name: 'Save new password' }).click();
    await page.getByRole('status').filter({ hasText: 'Password saved' }).waitFor();
    assert.equal(calls.user.at(-1).password, 'test-only-fixture-2');
    await page.screenshot({ path: 'test-results/marketing/reset-saved-1280.png' });

    // A link with no usable session says so and offers a new one.
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await fresh.route('https://ridentrack-test.supabase.co/**', r => r.fulfill({ status: 401, json: {} }));
    const p2 = await fresh.newPage();
    p2.on('pageerror', e => errors.push(e.message));
    await p2.goto(origin + '/reset-password');
    await p2.getByRole('alert').filter({ hasText: 'expired or was already used' }).waitFor({ timeout: 10000 });
    await p2.getByRole('link', { name: 'Send a new link' }).click();
    await p2.getByRole('heading', { level: 1, name: 'Reset your password' }).waitFor();
    assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll at 390px');

    assert.deepEqual(errors, []);
    console.log('Password reset browser checks passed.');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
