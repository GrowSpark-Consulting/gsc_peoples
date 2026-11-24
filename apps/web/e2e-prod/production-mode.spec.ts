import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { buildDemoRows } from '../src/modules/employees/adapters/demo/demo-data';

/**
 * PRODUCTION-MODE checks against a real `next build` + `next start` that was built and started with the
 * demo adapter and dev-auth flags FORCED ON in the environment (see playwright.prod.config.ts) and with
 * an API URL that nothing listens on. No API and no database exist behind it, so nothing here uses
 * PostgreSQL: the point is what a production build does (and refuses to do) on its own. Real-PostgreSQL
 * coverage of the same app in session mode is in e2e-live-testdb.
 */

const DEMO_NAMES = buildDemoRows().map((r) => `${r.firstName} ${r.lastName}`);
const DIST = path.resolve(__dirname, '../.next-prod');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test.describe('production build ignores demo and dev-auth flags and fails closed', () => {
  test('anonymous visitors are redirected to /login from every protected page, with no demo data', async ({ page }) => {
    for (const url of ['/employees', '/employees/new', '/dashboard', '/', '/employees/00000000-0000-4000-8000-000000000001']) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/login(\?|$)/);
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByText('Demo mode.')).toHaveCount(0);
      const text = await page.locator('body').innerText();
      for (const name of DEMO_NAMES) expect(text).not.toContain(name);
    }
  });

  test('a session cookie with an unreachable API fails closed (503), never serving the page', async ({ request }) => {
    for (const url of ['/employees', '/dashboard']) {
      const res = await request.get(url, { headers: { cookie: 'gsc_session=forged' }, maxRedirects: 0 });
      expect(res.status()).toBe(503);
      const body = await res.text();
      expect(body).not.toMatch(/Employees|Dashboard|Demo mode/);
    }
  });

  test('with the API unreachable, signing in shows an error, keeps the URL clean and creates no session', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Zq9-Unreachable-Marker!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form [role="alert"]')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    expect(page.url()).not.toContain('Zq9');
    expect((await context.cookies()).filter((c) => c.name.startsWith('gsc_'))).toEqual([]);
    await expect(page.getByText('Demo mode.')).toHaveCount(0);
  });

  test('the UI pattern showcase is not served in production', async ({ request }) => {
    expect((await request.get('/showcase', { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get('/showcase/patterns', { maxRedirects: 0 })).status()).toBe(404);
  });

  test('the dev-session endpoint does not exist: no handler ever answers, GET or POST', async ({ request }) => {
    for (const method of ['get', 'post'] as const) {
      // Do not follow redirects: the first response is what matters. An anonymous caller is bounced to
      // /login by the session gate (307); a route that existed would answer 200/201 with a token instead.
      const res = await request[method]('/api/dev-session', {
        maxRedirects: 0,
        ...(method === 'post' ? { data: { persona: 'hr' } } : {}),
      });
      expect([307, 404], `${method} status`).toContain(res.status());
      if (res.status() === 307) expect(new URL(res.headers().location!, 'http://x').pathname).toBe('/login');
      expect(await res.text()).not.toMatch(/dev:|token|dev-hr-admin/i);
    }
  });

  test('public pages carry no dev token, persona identity or database credential', async ({ request }) => {
    for (const url of ['/login', '/forgot-password']) {
      const html = await (await request.get(url)).text();
      expect(html).not.toMatch(/dev:dev-/);
      expect(html).not.toMatch(/hr_migrator|hr_app|postgres(ql)?:\/\//i);
    }
  });
});

test.describe('production bundles', () => {
  const clientFiles = () => walk(path.join(DIST, 'static')).filter((f) => /\.(js|css|json|html|map)$/.test(f));

  test('no database credential or development token is shipped to the browser', () => {
    const files = clientFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (/hr_migrator|hr_app\b|postgres(ql)?:\/\/|DIRECT_URL|DATABASE_URL/i.test(text)) offenders.push(`${f}: db credential/name`);
      if (/dev:dev-|dev:["'`]\s*\+|Bearer dev:/.test(text)) offenders.push(`${f}: dev token`);
    }
    expect(offenders).toEqual([]);
  });

  test('no demo employee data, demo personas or dev persona identities are in any client or server output', () => {
    const files = [...clientFiles(), ...walk(path.join(DIST, 'server')).filter((f) => /\.(js|json|html|rsc)$/.test(f))];
    const offenders = new Set<string>();
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const id of ['dev-super-admin', 'dev-hr-admin', 'dev-manager', 'dev-employee']) if (text.includes(id)) offenders.add(`${path.relative(DIST, f)}: persona id ${id}`);
      for (const n of DEMO_NAMES) if (text.includes(n)) offenders.add(`${path.relative(DIST, f)}: demo person "${n}"`);
      if (text.includes('Demo: view as') || text.includes('createDemoStore')) offenders.add(`${path.relative(DIST, f)}: demo provider`);
    }
    expect([...offenders]).toEqual([]);
  });
});
