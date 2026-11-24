import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * REAL session-cookie workflow, in a real browser, against the real API and REAL PostgreSQL (`hr_test`
 * only, enforced by playwright.live-testdb.config.ts and by scripts/e2e-testdb.ts). Nothing is mocked:
 * users sign in through the login form, the API sets httpOnly cookies, `/api/v1/me` supplies identity
 * and permissions, and every assertion about persistence reads PostgreSQL directly.
 * The API runs with AUTH_MODE=session, so development bearer tokens are rejected outright.
 */

const API = 'http://localhost:4300/api/v1';
const WEB_ORIGIN = 'http://localhost:3300';
// Throwaway credential for the isolated hr_test database only; never used anywhere else.
const PASSWORD = 'E2e-Test-Pass-1!';
const USERS = {
  hr: { email: 'hana.admin@dev.local', externalId: 'dev-hr-admin' },
  manager: { email: 'mia.manager@dev.local', externalId: 'dev-manager' },
  employee: { email: 'ravi.reddy@dev.local', externalId: 'dev-employee' },
} as const;
type Persona = keyof typeof USERS;

const apiDir = path.resolve(__dirname, '../../api');
const tsx = path.join(apiDir, 'node_modules/tsx/dist/cli.mjs');
const fx = (...args: string[]) =>
  execFileSync(process.execPath, [tsx, 'scripts/e2e-testdb.ts', ...args], {
    cwd: apiDir,
    encoding: 'utf8',
  }).trim();

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(() => {
  expect(fx('database')).toBe('hr_test');
});
test.beforeEach(() => {
  fx('prepare');
  fx('set-passwords', PASSWORD);
});

async function signIn(page: Page, persona: Persona, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(USERS[persona].email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signedIn(page: Page, persona: Persona) {
  await signIn(page, persona);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies(API)).find((c) => c.name === name);
}

async function csrf(context: BrowserContext) {
  const c = await cookie(context, 'gsc_csrf');
  expect(c).toBeDefined();
  return decodeURIComponent(c!.value);
}

// Next also renders an empty role=alert route announcer, so target the form's own message.
const formAlert = (page: Page) => page.locator('form [role="alert"]');

const name = (page: Page, full: string) => page.getByRole('link', { name: full, exact: true });

test.describe('route protection (server-side)', () => {
  test('anonymous visits to protected pages are redirected to /login by the server, with no page content', async ({ page, request }) => {
    // Server level: a 307 to /login (carrying where the user was headed), and no page body.
    for (const url of ['/dashboard', '/employees', '/employees/new', '/settings']) {
      const res = await request.get(`${WEB_ORIGIN}${url}`, { maxRedirects: 0 });
      expect(res.status(), url).toBe(307);
      expect(res.headers().location, url).toMatch(/\/login/);
      expect(await res.text(), url).not.toMatch(/Add employee|Employees<|Dashboard</);
    }
    // Browser level.
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login\?next=%2Femployees/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('anonymous API calls are 401 and bearer development tokens are rejected', async ({ request }) => {
    expect((await request.get(`${API}/me`)).status()).toBe(401);
    expect((await request.get(`${API}/employees`)).status()).toBe(401);
    const bearer = { authorization: 'Bearer dev:dev-hr-admin' };
    expect((await request.get(`${API}/me`, { headers: bearer })).status()).toBe(401);
    expect((await request.get(`${API}/employees`, { headers: bearer })).status()).toBe(401);
  });

  test('CORS preflight allows the CSRF header from the web origin only', async ({ request }) => {
    const ok = await request.fetch(`${API}/employees`, {
      method: 'OPTIONS',
      headers: {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    });
    expect(ok.headers()['access-control-allow-headers']?.toLowerCase()).toContain('x-csrf-token');
    expect(ok.headers()['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(ok.headers()['access-control-allow-credentials']).toBe('true');
    const evil = await request.fetch(`${API}/employees`, {
      method: 'OPTIONS',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers()['access-control-allow-origin']).toBeUndefined();
  });
});

test.describe('login, session persistence and logout', () => {
  test('wrong password shows one generic error and creates no session', async ({ page, context }) => {
    await signIn(page, 'hr', 'definitely-wrong-password');
    await expect(formAlert(page)).toContainText('Invalid email or password');
    await expect(page).toHaveURL(/\/login/);
    expect(await cookie(context, 'gsc_session')).toBeUndefined();
    // Unknown email gets the very same message (no account enumeration).
    await page.getByLabel('Email').fill('nobody@dev.local');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(formAlert(page)).toContainText('Invalid email or password');
  });

  test('HR signs in, the session is an httpOnly cookie, survives refresh, and shows PostgreSQL data', async ({ page, context }) => {
    const apiCalls: { url: string; auth: string | undefined; credentials: boolean }[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(API)) apiCalls.push({ url: r.url(), auth: r.headers().authorization, credentials: true });
    });

    await signedIn(page, 'hr');
    const session = await cookie(context, 'gsc_session');
    expect(session?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain('gsc_session');
    expect((await cookie(context, 'gsc_csrf'))?.httpOnly).toBe(false);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/); // persisted across a refresh

    await page.goto('/employees');
    await expect(page.getByTestId('employee-table')).toBeVisible({ timeout: 30_000 });
    for (const n of ['Hana Admin', 'Mia Manager', 'Ravi Reddy']) await expect(name(page, n)).toBeVisible();
    await expect(page.getByText('Demo mode.')).toHaveCount(0);
    await expect(name(page, 'Meera Nair')).toHaveCount(0); // a demo-data person

    // The database agrees with what is on screen.
    expect(fx('count', 'employees')).toBe('3');
    // Evidence the browser used the real authenticated API: /me and /employees were requested,
    // no request carried a bearer token (cookie auth only).
    expect(apiCalls.some((c) => /\/me$/.test(c.url))).toBe(true);
    expect(apiCalls.some((c) => /\/employees(\?|$)/.test(c.url))).toBe(true);
    expect(apiCalls.every((c) => c.auth === undefined)).toBe(true);
  });

  test('logout ends the session: pages redirect, and the old cookie is dead at the API', async ({ page, context }) => {
    await signedIn(page, 'hr');
    const old = (await cookie(context, 'gsc_session'))!.value;
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);

    // Replaying the captured cookie must not work: the session was revoked server-side.
    const replay = await page.request.get(`${API}/me`, { headers: { cookie: `gsc_session=${old}` } });
    expect(replay.status()).toBe(401);
  });

  test('a revoked session is rejected on the next navigation and API call', async ({ page, context }) => {
    await signedIn(page, 'hr');
    const raw = (await cookie(context, 'gsc_session'))!.value;
    fx('revoke-sessions', USERS.hr.externalId);
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get(`${API}/me`, { headers: { cookie: `gsc_session=${raw}` } })).status()).toBe(401);
  });

  test('an idle-expired session (8h) is rejected', async ({ page }) => {
    await signedIn(page, 'hr');
    // Let Next's link prefetches (which legitimately count as activity) finish before ageing the session.
    await page.waitForLoadState('networkidle');
    fx('expire-sessions', USERS.hr.externalId);
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a session that dies while the page is open sends the user to /login on the next request', async ({ page }) => {
    await signedIn(page, 'hr');
    await page.goto('/employees');
    await expect(page.getByTestId('employee-table')).toBeVisible({ timeout: 30_000 });
    fx('revoke-sessions', USERS.hr.externalId);
    await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill('Mia');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('deactivating a user kills the live session and blocks new sign-ins', async ({ page, context }) => {
    await signedIn(page, 'hr');
    fx('disable-user', USERS.hr.externalId);
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
    await context.clearCookies();
    await signIn(page, 'hr');
    await expect(formAlert(page)).toContainText('Invalid email or password');
  });
});

test.describe('CSRF', () => {
  test('writes without or with a wrong CSRF token are refused; the right token succeeds', async ({ page, context }) => {
    await signedIn(page, 'hr');
    const body = { employeeNumber: 'E2E-CSRF-1', firstName: 'Csrf', lastName: 'Check' };
    const before = fx('count', 'employees');

    const none = await context.request.post(`${API}/employees`, { data: body });
    expect(none.status()).toBe(403);
    const wrong = await context.request.post(`${API}/employees`, { data: body, headers: { 'x-csrf-token': 'not-the-token' } });
    expect(wrong.status()).toBe(403);
    expect(fx('count', 'employees')).toBe(before); // nothing written by either refusal

    const ok = await context.request.post(`${API}/employees`, { data: body, headers: { 'x-csrf-token': await csrf(context) } });
    expect(ok.status()).toBe(201);
    expect(JSON.parse(fx('employee-by-number', 'E2E-CSRF-1'))).toMatchObject({ firstName: 'Csrf', lastName: 'Check' });
  });
});

test.describe('HR operations through the UI persist in PostgreSQL', () => {
  test('create, edit and change status of an employee', async ({ page }) => {
    await signedIn(page, 'hr');
    await page.goto('/employees');
    await page.getByRole('link', { name: 'Add employee' }).first().click();
    const form = page.getByRole('form', { name: 'Add employee' });
    await form.getByLabel('Employee number').fill('E2E-UI-1');
    await form.getByLabel('First name').fill('Uma');
    await form.getByLabel('Last name').fill('Browser');
    await form.getByLabel('Job title').fill('Test Engineer');
    await form.getByRole('button', { name: 'Create employee' }).click();
    await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    expect(JSON.parse(fx('employee-by-number', 'E2E-UI-1'))).toMatchObject({ jobTitle: 'Test Engineer', status: 'ONBOARDING' }); // PRD W2: new employees start in Onboarding

    await page.getByRole('link', { name: 'Edit' }).first().click();
    const edit = page.getByRole('form', { name: 'Edit employee' });
    await edit.getByLabel('Job title').fill('Senior Test Engineer');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Uma Browser' }).getByText('Senior Test Engineer', { exact: true })).toBeVisible();
    expect(JSON.parse(fx('employee-by-number', 'E2E-UI-1'))).toMatchObject({ jobTitle: 'Senior Test Engineer' });

    const status = page.getByRole('form', { name: 'Change employment status' });
    await status.getByLabel('Status').selectOption('ON_LEAVE');
    await status.getByRole('button', { name: 'Update status' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Uma Browser' }).getByText('On leave').first()).toBeVisible();
    expect(JSON.parse(fx('employee-by-number', 'E2E-UI-1'))).toMatchObject({ status: 'ON_LEAVE' });

    await page.reload();
    await expect(page.getByRole('article', { name: 'Profile of Uma Browser' })).toBeVisible();
  });
});

test.describe('role restrictions', () => {
  test('Manager sees only self and direct reports, with no write controls; the API refuses writes', async ({ page, context }) => {
    await signedIn(page, 'manager');
    await page.goto('/employees');
    await expect(page.getByTestId('employee-table')).toBeVisible({ timeout: 30_000 });
    await expect(name(page, 'Mia Manager')).toBeVisible();
    await expect(name(page, 'Ravi Reddy')).toBeVisible();
    await expect(name(page, 'Hana Admin')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);

    const token = await csrf(context); // a VALID token: the refusal must be about permission, not CSRF
    const write = await context.request.post(`${API}/employees`, {
      data: { employeeNumber: 'E2E-NOPE', firstName: 'No', lastName: 'Way' },
      headers: { 'x-csrf-token': token },
    });
    expect(write.status()).toBe(403);
    expect(fx('employee-by-number', 'E2E-NOPE')).toBe('null');
  });

  test('Employee sees only their own record and cannot reach write screens', async ({ page, context }) => {
    await signedIn(page, 'employee');
    await page.goto('/employees');
    await expect(page.getByTestId('employee-table')).toBeVisible({ timeout: 30_000 });
    await expect(name(page, 'Ravi Reddy')).toBeVisible();
    await expect(name(page, 'Mia Manager')).toHaveCount(0);
    await expect(name(page, 'Hana Admin')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);

    await page.goto('/employees/new');
    await expect(page.getByText('Only HR Admins can add employees.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('form', { name: 'Add employee' })).toHaveCount(0);

    const write = await context.request.post(`${API}/employees`, {
      data: { employeeNumber: 'E2E-NOPE2', firstName: 'No', lastName: 'Way' },
      headers: { 'x-csrf-token': await csrf(context) },
    });
    expect(write.status()).toBe(403);
  });

  test('a membership suspended after sign-in is refused by the API on the next request', async ({ page, context }) => {
    await signedIn(page, 'hr');
    fx('suspend', USERS.hr.externalId);
    expect((await context.request.get(`${API}/employees`)).status()).toBe(403);
    await page.goto('/employees');
    await expect(page.getByTestId('session-error')).toHaveAttribute('data-code', '403', { timeout: 30_000 });
    await expect(page.getByTestId('employee-table')).toHaveCount(0);
  });
});
