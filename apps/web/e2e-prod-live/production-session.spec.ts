import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * PRODUCTION-MODE workflow: `next start` frontend + built production API (NODE_ENV=production,
 * AUTH_MODE=session, Secure cookies) + REAL PostgreSQL `hr_test`. Real browser, nothing mocked. Compare
 * e2e-live-testdb, which runs the same product on the Next DEVELOPMENT server and a development-mode API.
 */

const API = 'http://localhost:4400/api/v1';
const WEB = 'http://localhost:3400';
const PASSWORD = 'E2e-Test-Pass-1!'; // throwaway credential, hr_test only
const USERS = {
  hr: { email: 'hana.admin@dev.local', externalId: 'dev-hr-admin' },
  manager: { email: 'mia.manager@dev.local', externalId: 'dev-manager' },
  employee: { email: 'ravi.reddy@dev.local', externalId: 'dev-employee' },
} as const;
type Persona = keyof typeof USERS;

const apiDir = path.resolve(__dirname, '../../api');
const tsx = path.join(apiDir, 'node_modules/tsx/dist/cli.mjs');
const fx = (...args: string[]) =>
  execFileSync(process.execPath, [tsx, 'scripts/e2e-testdb.ts', ...args], { cwd: apiDir, encoding: 'utf8' }).trim();

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeAll(() => expect(fx('database')).toBe('hr_test'));
test.beforeEach(() => {
  fx('prepare');
  fx('set-passwords', PASSWORD);
});

async function signedIn(page: Page, persona: Persona) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(USERS[persona].email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}
const cookie = async (context: BrowserContext, name: string) => (await context.cookies(API)).find((c) => c.name === name);
const csrf = async (context: BrowserContext) => decodeURIComponent((await cookie(context, 'gsc_csrf'))!.value);
const link = (page: Page, full: string) => page.getByRole('link', { name: full, exact: true });

test.describe('this really is the production build', () => {
  test('production server: no dev overlay, no showcase, no dev-session, hostile build flags ignored', async ({ request }) => {
    expect((await request.get(`${WEB}/showcase`, { maxRedirects: 0 })).status()).toBe(404);
    const dev = await request.get(`${WEB}/api/dev-session`, { maxRedirects: 0 });
    expect([307, 404]).toContain(dev.status());
    const html = await (await request.get(`${WEB}/login`)).text();
    expect(html).not.toContain('__next_dev'); // dev-only markers
    expect(html).not.toMatch(/Demo: view as|Demo mode\./);
    // The API is in production mode too: the development-only reset-token header must not exist.
    const reset = await request.post(`${API}/auth/forgot-password`, { data: { email: USERS.hr.email } });
    expect(reset.status()).toBe(200);
    expect(reset.headers()['x-development-reset-token']).toBeUndefined();
  });
});

test.describe('session workflow in production mode', () => {
  test('anonymous access is redirected to /login and API calls are 401 (bearer dev tokens too)', async ({ page, request }) => {
    for (const url of ['/dashboard', '/employees', '/employees/new']) {
      const res = await request.get(`${WEB}${url}`, { maxRedirects: 0 });
      expect(res.status(), url).toBe(307);
      expect(res.headers().location, url).toMatch(/\/login/);
    }
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login\?next=%2Femployees/);
    expect((await request.get(`${API}/me`)).status()).toBe(401);
    expect((await request.get(`${API}/me`, { headers: { authorization: 'Bearer dev:dev-hr-admin' } })).status()).toBe(401);
  });

  test('HR: login sets Secure httpOnly session + readable CSRF cookie, /me names the right company, directory shows PostgreSQL rows, refresh persists', async ({ page, context }) => {
    const apiCalls: { url: string; auth?: string }[] = [];
    page.on('request', (r) => r.url().startsWith(API) && apiCalls.push({ url: r.url(), auth: r.headers().authorization }));
    await signedIn(page, 'hr');

    const session = await cookie(context, 'gsc_session');
    const token = await cookie(context, 'gsc_csrf');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    expect(token).toMatchObject({ httpOnly: false, secure: true, sameSite: 'Lax' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('gsc_session');

    const me = await context.request.get(`${API}/me`);
    expect(me.status()).toBe(200);
    const identity = (await me.json()).data;
    expect(identity).toMatchObject({ email: USERS.hr.email, companyId: 'dev-company' });
    expect(identity.roles).toEqual(['HR_ADMIN']);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto('/employees');
    await expect(page.getByTestId('employee-table')).toBeVisible({ timeout: 30_000 });
    for (const n of ['Hana Admin', 'Mia Manager', 'Ravi Reddy']) await expect(link(page, n)).toBeVisible();
    await expect(page.getByText('Demo mode.')).toHaveCount(0);
    await expect(link(page, 'Meera Nair')).toHaveCount(0);
    expect(fx('count', 'employees')).toBe('3');
    expect(apiCalls.some((c) => /\/employees(\?|$)/.test(c.url))).toBe(true);
    expect(apiCalls.every((c) => c.auth === undefined)).toBe(true); // cookie auth only
  });

  test('HR creates, edits and changes the status of an employee; rows are in PostgreSQL', async ({ page }) => {
    await signedIn(page, 'hr');
    await page.goto('/employees');
    await page.getByRole('link', { name: 'Add employee' }).first().click();
    const form = page.getByRole('form', { name: 'Add employee' });
    await form.getByLabel('Employee number').fill('E2E-PROD-1');
    await form.getByLabel('First name').fill('Pia');
    await form.getByLabel('Last name').fill('Production');
    await form.getByLabel('Job title').fill('Test Engineer');
    await form.getByRole('button', { name: 'Create employee' }).click();
    await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    expect(JSON.parse(fx('employee-by-number', 'E2E-PROD-1'))).toMatchObject({ jobTitle: 'Test Engineer', status: 'ONBOARDING' });

    await page.getByRole('link', { name: 'Edit' }).first().click();
    const edit = page.getByRole('form', { name: 'Edit employee' });
    await edit.getByLabel('Job title').fill('Senior Test Engineer');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Pia Production' }).getByText('Senior Test Engineer', { exact: true })).toBeVisible();
    expect(JSON.parse(fx('employee-by-number', 'E2E-PROD-1'))).toMatchObject({ jobTitle: 'Senior Test Engineer' });

    const status = page.getByRole('form', { name: 'Change employment status' });
    await status.getByLabel('Status').selectOption('ON_LEAVE');
    await status.getByRole('button', { name: 'Update status' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Pia Production' }).getByText('On leave').first()).toBeVisible();
    expect(JSON.parse(fx('employee-by-number', 'E2E-PROD-1'))).toMatchObject({ status: 'ON_LEAVE' });
  });

  test('CSRF is enforced in production: no or wrong token is refused, the right one writes', async ({ page, context }) => {
    await signedIn(page, 'hr');
    const body = { employeeNumber: 'E2E-PROD-CSRF', firstName: 'Csrf', lastName: 'Check' };
    expect((await context.request.post(`${API}/employees`, { data: body })).status()).toBe(403);
    expect((await context.request.post(`${API}/employees`, { data: body, headers: { 'x-csrf-token': 'nope' } })).status()).toBe(403);
    expect(fx('employee-by-number', 'E2E-PROD-CSRF')).toBe('null');
    expect((await context.request.post(`${API}/employees`, { data: body, headers: { 'x-csrf-token': await csrf(context) } })).status()).toBe(201);
  });

  test('Manager sees only self and direct reports and cannot write; Employee sees only self and cannot reach write screens', async ({ page, context }) => {
    await signedIn(page, 'manager');
    await page.goto('/employees');
    await expect(page.getByTestId('employee-table')).toBeVisible({ timeout: 30_000 });
    await expect(link(page, 'Mia Manager')).toBeVisible();
    await expect(link(page, 'Ravi Reddy')).toBeVisible();
    await expect(link(page, 'Hana Admin')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);
    const mgrWrite = await context.request.post(`${API}/employees`, {
      data: { employeeNumber: 'E2E-NOPE', firstName: 'No', lastName: 'Way' },
      headers: { 'x-csrf-token': await csrf(context) }, // valid token: the refusal is about permission
    });
    expect(mgrWrite.status()).toBe(403);

    await context.clearCookies();
    await signedIn(page, 'employee');
    await page.goto('/employees');
    await expect(page.getByTestId('employee-table')).toBeVisible({ timeout: 30_000 });
    await expect(link(page, 'Ravi Reddy')).toBeVisible();
    await expect(link(page, 'Mia Manager')).toHaveCount(0);
    await page.goto('/employees/new');
    await expect(page.getByText('Only HR Admins can add employees.')).toBeVisible({ timeout: 30_000 });
    const empWrite = await context.request.post(`${API}/employees`, {
      data: { employeeNumber: 'E2E-NOPE2', firstName: 'No', lastName: 'Way' },
      headers: { 'x-csrf-token': await csrf(context) },
    });
    expect(empWrite.status()).toBe(403);
    expect(fx('employee-by-number', 'E2E-NOPE')).toBe('null');
    expect(fx('employee-by-number', 'E2E-NOPE2')).toBe('null');
  });

  test('HR invitation limits hold over real HTTP in production: Employee/Manager yes; HR Admin/Super Admin no', async ({ page, context }) => {
    await signedIn(page, 'hr');
    const headers = { 'x-csrf-token': await csrf(context) };
    for (const roleKey of ['EMPLOYEE', 'MANAGER']) {
      const ok = await context.request.post(`${API}/settings/users/invite`, { data: { email: `p.${roleKey.toLowerCase()}@example.com`, roleKey }, headers });
      expect(ok.status(), roleKey).toBe(201);
    }
    for (const roleKey of ['HR_ADMIN', 'SUPER_ADMIN']) {
      const no = await context.request.post(`${API}/settings/users/invite`, { data: { email: `p.${roleKey.toLowerCase()}@example.com`, roleKey }, headers });
      expect(no.status(), roleKey).toBe(403);
    }
    expect((await context.request.get(`${API}/settings/audit-logs`)).status()).toBe(403);
  });

  test('logout revokes the session: pages redirect and the captured cookie gets 401 at the API', async ({ page, context }) => {
    await signedIn(page, 'hr');
    const old = (await cookie(context, 'gsc_session'))!.value;
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get(`${API}/me`, { headers: { cookie: `gsc_session=${old}` } })).status()).toBe(401);
    expect((await page.request.get(`${API}/employees`, { headers: { cookie: `gsc_session=${old}` } })).status()).toBe(401);
  });
});
