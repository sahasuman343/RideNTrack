// Marketing pages: each renders at 360, 768 and 1440 px with no sideways
// scroll and no axe-core WCAG A/AA violations; the home route line draws as
// you scroll and is fully drawn with reduced motion; the FAQ opens by keyboard;
// legal pages say they are drafts while operator details are missing.
// No network calls leave the machine: the pages are static.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [...(process.env.NODE_PATH || '').split(':').filter(Boolean), __dirname] }), 'utf8');
const origin = 'http://127.0.0.1:3000';
const WIDTHS = [360, 768, 1440];
const PAGES = [
  { path: '/', name: 'home', heading: 'Plan the road. Ride it together.' },
  { path: '/features', name: 'features', heading: 'Built for the group, not just the rider.' },
  { path: '/privacy-and-location', name: 'privacy-and-location', heading: 'Your position, on your terms.' },
  { path: '/faq', name: 'faq', heading: 'Questions riders ask.' },
  { path: '/download', name: 'download', heading: 'The ride happens on your phone.' },
  { path: '/support', name: 'support', heading: 'Get back on the road.' },
  { path: '/waitlist', name: 'waitlist', heading: 'Be first on the road.' },
  { path: '/privacy', name: 'privacy', heading: 'Privacy policy' },
  { path: '/terms', name: 'terms', heading: 'Terms of use' },
];

async function axe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
  const bad = result.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  assert.deepEqual(bad, [], `axe violations on ${label}`);
}

const inkOffsets = page => page.$$eval('.journey-ink', els => els.map(e => Number(getComputedStyle(e).strokeDashoffset.replace('px', ''))));

(async () => {
  const server = spawn(process.execPath, ['../node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1'], { cwd: 'web', stdio: 'inherit' });
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    fs.mkdirSync('test-results/marketing', { recursive: true });
    browser = await chromium.launch();
    const errors = [];

    for (const p of PAGES) assert.equal((await fetch(origin + p.path)).status, 200, p.path + ' is public');
    const sitemap = await (await fetch(origin + '/sitemap.xml')).text();
    for (const p of PAGES) assert.ok(sitemap.includes(`<loc>https://ridentrack.app${p.path === '/' ? '' : p.path}</loc>`), p.path + ' in sitemap');
    const robots = await (await fetch(origin + '/robots.txt')).text();
    assert.match(robots, /Disallow: \/track\//);
    assert.match(robots, /Disallow: \/app/);

    // Every page at three widths, with reduced motion so screenshots are stable.
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, reducedMotion: 'reduce' });
      await context.route(u => !u.href.startsWith(origin), r => r.abort());
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(`${width}px: ${e.message}`));
      for (const p of PAGES) {
        await page.goto(origin + p.path);
        await page.getByRole('heading', { level: 1, name: p.heading }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `no sideways scroll: ${p.path} at ${width}px`);
        assert.equal(await page.getByRole('navigation', { name: 'Site' }).evaluate(n => n.scrollWidth <= n.clientWidth), true, `site links fit without scrolling at ${width}px`);
        if (p.path !== '/') {
          const nav = page.getByRole('navigation', { name: 'Site' });
          const current = await nav.locator('[aria-current="page"]').count();
          assert.equal(current, ['/support', '/waitlist', '/privacy', '/terms'].includes(p.path) ? 0 : 1, `nav marks ${p.path}`);
        }
        await axe(page, `${p.path} at ${width}px`);
        await page.screenshot({ path: `test-results/marketing/${p.name}-${width}.png`, fullPage: true });
      }
      // Reduced motion: the whole route is drawn without scrolling.
      await page.goto(origin + '/');
      await page.waitForTimeout(100);
      assert.ok((await inkOffsets(page)).every(o => o === 0), 'route fully drawn with reduced motion');
      assert.equal(await page.locator('.scene[aria-hidden="true"]').count(), 1, '3D hero is decorative');
      assert.deepEqual(await page.$$eval('.scene-rider, .scene-plane', els => els.map(e => getComputedStyle(e).animationName)), ['none', 'none', 'none'], '3D hero holds still with reduced motion');
      await context.close();
    }

    // Full motion: the route starts undrawn below the fold and inks in on scroll.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/');
    await page.locator('.journey-ink-whole').first().waitFor({ state: 'detached' });
    await page.waitForTimeout(300);
    const before = await inkOffsets(page);
    assert.ok(before.every(o => o === 1), 'route undrawn before scrolling: ' + before);
    assert.equal(await page.locator('.journey-stop.is-reached').count(), 0);
    await page.locator('.journey-stop').nth(2).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    // The ink eases over 0.12 s; wait for it to settle rather than sampling mid-transition.
    await page.waitForFunction(() => {
      const v = [...document.querySelectorAll('.journey-ink')].map(e => parseFloat(getComputedStyle(e).strokeDashoffset));
      return v[0] === 0 && v[v.length - 1] === 1;
    }, null, { timeout: 5000 }).catch(() => {});
    const mid = await inkOffsets(page);
    await page.screenshot({ path: 'test-results/marketing/home-route-midway-1440.png' });
    assert.ok(mid[0] === 0 && mid[mid.length - 1] === 1, 'first segments drawn, last not yet: ' + mid);
    assert.ok(await page.locator('.journey-stop.is-reached').count() >= 2, 'reached stops light up');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    assert.ok((await inkOffsets(page)).every(o => o === 0), 'whole route drawn at the bottom');

    // FAQ answers open by keyboard.
    await page.goto(origin + '/faq');
    const q = page.locator('summary', { hasText: 'Does it give turn by turn directions?' });
    await q.focus();
    await page.keyboard.press('Enter');
    await page.getByText('hands each leg of the route to Google Maps').waitFor();

    // Unset operator details: drafts say so, and nothing invented is shown.
    for (const path of ['/privacy', '/terms']) {
      await page.goto(origin + path);
      await page.getByRole('note').filter({ hasText: 'This is a draft' }).waitFor();
      assert.ok(await page.locator('a[href="mailto:dev.sahasuman343@gmail.com"]').count() > 0, path + ' lists the support address');
    }
    await page.goto(origin + '/download');
    assert.equal(await page.getByText('Coming soon', { exact: true }).count(), 2, 'both stores say coming soon until links are set');
    await page.goto(origin + '/support');
    await page.getByRole('link', { name: 'dev.sahasuman343@gmail.com' }).waitFor();
    await page.goto(origin + '/features');
    const freeDays = await page.getByRole('row', { name: /^Days/ }).locator('td').first().innerText();
    assert.equal(freeDays, '2', 'plan table reads the shared limits');
    assert.equal(await page.getByRole('row', { name: /Location history kept/ }).count(), 0, 'no retention promise until the purge job is scheduled');
    await page.goto(origin + '/privacy');
    await page.getByText('Location history is kept until the trip or your account is deleted.').waitFor();

    // Skip link reaches the content.
    await page.goto(origin + '/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'content');

    assert.deepEqual(errors, []);
    console.log('Marketing browser checks passed.');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
