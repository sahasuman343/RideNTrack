// Money and journal tabs on a trip: shared expenses, who owes whom, delete,
// errors, and your own journal entry. Supabase is mocked.
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
const people = { [userId]: 'Suman', [ashaId]: 'Asha Rao', [raviId]: 'Ravi' };
const roster = Object.entries(people).map(([user_id, display_name], i) => ({ user_id, display_name, role: i ? 'member' : 'captain', is_active: true, last_seen: null, attendance_status: 'confirmed' }));
const calls = {};
let expenses = [];
let journal = null;
let failExpenses = true;
let failSave = false;

// Mirrors add_trip_expense: equal split, the remainder goes to the first rider.
function makeExpense(id, payer, title, amount, category, split) {
  const each = Math.floor((amount / split.length) * 100) / 100;
  const rem = Math.round((amount - each * split.length) * 100) / 100;
  return { id, ride_id: tripId, payer_id: payer, payer_name: people[payer], title, amount, currency: 'INR', category, split_type: 'equal', notes: null, created_at: new Date().toISOString(),
    splits: split.map((u, i) => ({ user_id: u, display_name: people[u], amount: i === 0 ? each + rem : each })) };
}
function summary() {
  const sum = xs => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  const paid = u => sum(expenses.filter(e => e.payer_id === u).map(e => e.amount));
  const share = u => sum(expenses.flatMap(e => e.splits).filter(s => s.user_id === u).map(s => s.amount));
  const cats = {}; for (const e of expenses) cats[e.category] = sum([cats[e.category] || 0, e.amount]);
  return { currency: 'INR', total_spend: sum(expenses.map(e => e.amount)), my_paid: paid(userId), my_share: share(userId), net_balance: Math.round((paid(userId) - share(userId)) * 100) / 100, category_breakdown: cats,
    participant_balances: Object.keys(people).map(u => ({ user_id: u, display_name: people[u], paid: paid(u), share: share(u), net: Math.round((paid(u) - share(u)) * 100) / 100 })) };
}

(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser, page;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    browser = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
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
      const fail = msg => route.fulfill({ status: 400, json: { code: 'P0001', message: msg, details: null, hint: null } });
      if (rpc === 'get_trip_roster') return route.fulfill({ json: roster });
      if (rpc === 'get_trip_checklists') return route.fulfill({ json: [{ id: 'c1', category: 'documents', title: 'Licence', description: null, is_mandatory: true, sequence: 1, my_completed: false, completed_count: 0, assigned_to_user_id: null }] });
      if (rpc === 'get_trip_expenses') return failExpenses ? fail('Access denied.') : route.fulfill({ json: expenses });
      if (rpc === 'get_trip_expense_summary') return route.fulfill({ json: summary() });
      if (rpc === 'add_trip_expense') { const id = 'e' + (expenses.length + 1); expenses = [makeExpense(id, userId, body.p_title, body.p_amount, body.p_category, body.p_split_user_ids), ...expenses]; return route.fulfill({ json: id }); }
      if (rpc === 'delete_trip_expense') { expenses = expenses.filter(e => e.id !== body.p_expense_id); return route.fulfill({ json: true }); }
      if (rpc === 'save_trip_journal_entry') {
        if (failSave) return route.fulfill({ status: 403, json: { code: '42501', message: 'You must be a trip participant to create a journal entry' } });
        journal = { id: 'j1', ride_id: tripId, user_id: userId, title: body.p_title, notes: body.p_notes, highlights: body.p_highlights, rating: body.p_rating, photos: body.p_photos, updated_at: new Date().toISOString() };
        return route.fulfill({ json: 'j1' });
      }
      if (rpc === 'get_my_flags') return route.fulfill({ json: [] });
      if (url.includes('/rest/v1/trip_journal_entries')) return route.fulfill({ json: journal ? [journal] : [] });
      if (url.includes('/auth/v1/user')) return route.fulfill({ json: session.user });
      if (url.includes('/rest/v1/profiles')) return route.fulfill({ json: { id: userId, display_name: 'Suman', subscription_tier: 'free' } });
      if (url.includes('/rest/v1/rides')) return route.fulfill({ json: trip });
      return route.fulfill({ json: [] });
    });
    page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));

    // A failed read says so and offers a retry; it never shows zero balances.
    await page.goto(origin + '/app/trips/' + tripId + '#money');
    await page.getByRole('heading', { name: 'Money' }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'Could not load the trip’s expenses' }).waitFor();
    assert.equal(await page.getByText('Trip total').count(), 0);
    failExpenses = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('No expenses yet.').waitFor();

    // Add: validation first, then an equal split between everyone by default.
    await page.getByRole('button', { name: 'Add expense' }).click();
    await page.getByLabel('What for').fill('Fuel at Rampur');
    await page.getByLabel(/^Amount/).fill('12.345');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await page.getByRole('alert').filter({ hasText: 'at most two decimals' }).waitFor();
    assert.equal(calls.add_trip_expense, undefined, 'bad amounts never reach the server');
    await page.getByLabel(/^Amount/).fill('3,000');
    await page.getByText('About ₹1,000 each.').waitFor();
    await page.getByRole('button', { name: 'Save expense' }).click();
    await page.getByRole('status').filter({ hasText: 'Fuel at Rampur added and split between 3 riders.' }).waitFor();
    assert.deepEqual(calls.add_trip_expense.at(-1), { p_ride_id: tripId, p_title: 'Fuel at Rampur', p_amount: 3000, p_category: 'fuel', p_split_user_ids: [userId, ashaId, raviId], p_notes: null });

    // A second cost Asha paid, split with Ravi only (seeded as if from her phone).
    expenses = [makeExpense('e9', ashaId, 'Homestay in Kaza', 1500, 'stay', [ashaId, raviId]), ...expenses];
    await page.getByRole('button', { name: 'Add expense' }).click();
    await page.getByLabel('What for').fill('Chai');
    await page.getByLabel(/^Amount/).fill('90');
    await page.getByLabel('Category', { exact: true }).selectOption('food');
    await page.getByRole('checkbox', { name: 'Ravi' }).uncheck();
    await page.getByRole('button', { name: 'Save expense' }).click();
    await page.getByRole('status').filter({ hasText: 'Chai added and split between 2 riders.' }).waitFor();
    assert.deepEqual(calls.add_trip_expense.at(-1).p_split_user_ids, [userId, ashaId]);

    // Totals: 3000 + 1500 + 90. Suman paid 3090, share 1045 → gets back 2045.
    const figures = page.locator('dl').filter({ hasText: 'Trip total' });
    await figures.getByText('₹4,590').waitFor();
    await figures.getByText('₹3,090').waitFor();
    await figures.getByText('₹1,045').waitFor();
    await figures.getByText('You get back').waitFor();
    const owes = page.getByRole('list', { name: 'Who owes whom' });
    assert.equal(await owes.getByRole('listitem').count(), 2);
    await owes.getByRole('listitem').filter({ hasText: 'Ravi pays you' }).getByText('₹1,750').waitFor();
    await owes.getByRole('listitem').filter({ hasText: 'Asha Rao pays you' }).getByText('₹295').waitFor();
    await page.getByRole('list', { name: 'Spend by category' }).getByText('Stay / Lodging').waitFor();
    await page.screenshot({ path: 'test-results/trip-money-desktop.png' });

    // Delete asks first; the leader can remove anyone's expense.
    await page.getByRole('button', { name: 'Delete Homestay in Kaza' }).click();
    await page.getByRole('alertdialog').getByText('Delete “Homestay in Kaza” for everyone?').waitFor();
    await page.getByRole('button', { name: 'Delete expense' }).click();
    await page.getByRole('status').filter({ hasText: 'Homestay in Kaza was deleted.' }).waitFor();
    assert.deepEqual(calls.delete_trip_expense.at(-1), { p_expense_id: 'e9' });
    assert.equal(await page.getByRole('list', { name: 'Trip expenses' }).getByRole('listitem').count(), 2);

    // Journal: empty, then write with a rating and a photo link (https only).
    await page.getByRole('tab', { name: 'Journal' }).click();
    await page.getByText('Nothing written yet.').waitFor();
    await page.getByRole('button', { name: 'Write entry' }).click();
    assert.equal(await page.getByLabel('Title').inputValue(), 'Spiti Valley Loop');
    await page.getByLabel('How it went').fill('Snow at Kunzum, sunshine at Chandratal.');
    await page.getByLabel('4 out of 5').check({ force: true });
    await page.getByLabel('Photo link').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Add photo' }).click();
    await page.getByRole('alert').filter({ hasText: 'starts with https://' }).waitFor();
    await page.getByLabel('Photo link').fill('https://photos.example.test/kunzum.jpg');
    await page.getByLabel('Photo caption').fill('Kunzum Pass');
    await page.getByRole('button', { name: 'Add photo' }).click();
    failSave = true;
    await page.getByRole('button', { name: 'Save journal' }).click();
    await page.getByRole('alert').filter({ hasText: 'Only riders on this trip' }).waitFor();
    failSave = false;
    await page.getByRole('button', { name: 'Save journal' }).click();
    await page.getByRole('status').filter({ hasText: 'Journal saved.' }).waitFor();
    const saved = calls.save_trip_journal_entry.at(-1);
    assert.equal(saved.p_rating, 4);
    assert.equal(saved.p_notes, 'Snow at Kunzum, sunshine at Chandratal.');
    assert.equal(saved.p_photos.length, 1);
    assert.equal(saved.p_photos[0].url, 'https://photos.example.test/kunzum.jpg');
    await page.getByRole('heading', { name: 'Spiti Valley Loop', level: 3 }).waitFor();
    await page.getByLabel('Rated 4 out of 5').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Kunzum Pass' }).getAttribute('rel'), 'noopener noreferrer nofollow');
    await page.screenshot({ path: 'test-results/trip-journal-desktop.png' });

    // Phone width.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(origin + '/app/trips/' + tripId + '#money');
    await page.getByText('Trip total').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scroll at 360px');
    await page.getByRole('heading', { name: 'Money' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/trip-money-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('Money and journal browser checks passed: load error and retry, add with validation and custom split, totals and settle up, delete with confirm, journal write/rating/photo link/https-only/permission error, phone width; no page errors.');
  } catch (error) {
    if (page) { fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/money-failure.png', fullPage: true }); }
    throw error;
  } finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
