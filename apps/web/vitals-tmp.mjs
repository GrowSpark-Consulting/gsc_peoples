import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [,, sessionFile, base = 'http://localhost:3000', label = 'local'] = process.argv;
const { token, csrf } = sessionFile && sessionFile !== '-' ? JSON.parse(readFileSync(sessionFile, 'utf8')) : {};
const browser = await chromium.launch({ channel: 'chrome' });
async function measure(path, { auth = true, nav } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (auth && token) await ctx.addCookies([{ name: 'gsc_session', value: token, domain: 'localhost', path: '/' }, { name: 'gsc_csrf', value: csrf, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__v = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  const reqs = []; let js = 0;
  page.on('response', async (r) => { const u = r.url(); if (u.includes('/api/v1/')) reqs.push(new URL(u).pathname.replace('/api/v1', '')); if (u.endsWith('.js')) { try { js += (await r.body()).length; } catch {} } });
  const t0 = Date.now();
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"][role="status"]'), null, { timeout: 15000 }).catch(() => {});
  const usable = Date.now() - t0;
  const v = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { ttfb: n.responseStart, fcp: fcp?.startTime, lcp: window.__v.lcp, cls: window.__v.cls }; });
  const out = { label, path, ttfb: Math.round(v.ttfb), fcp: Math.round(v.fcp), lcp: Math.round(v.lcp), cls: +v.cls.toFixed(4), usableMs: usable, meCalls: reqs.filter((r) => r === '/me').length, apiCalls: reqs.length, jsKB: Math.round(js / 1024) };
  if (nav) {
    const before = reqs.length; const t1 = Date.now();
    await page.click(`a[href="${nav}"]`);
    await page.waitForURL('**' + nav);
    const sawAppLoader = await page.evaluate(() => !!document.querySelector('.fixed.inset-0[role="status"]'));
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"][role="status"]'), null, { timeout: 15000 }).catch(() => {});
    out.nav = { to: nav, usableMs: Date.now() - t1, apiCalls: reqs.slice(before), sawFullScreenLoader: sawAppLoader };
  }
  await ctx.close();
  return out;
}
const results = [];
results.push(await measure('/login', { auth: false }));
if (token) {
  results.push(await measure('/settings', { nav: '/departments' }));
  results.push(await measure('/departments', { nav: '/settings' }));
  results.push(await measure('/dashboard'));
}
for (const r of results) console.log(JSON.stringify(r));
await browser.close();
