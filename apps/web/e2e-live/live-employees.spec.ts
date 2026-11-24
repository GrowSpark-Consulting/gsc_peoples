import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * LIVE tests: real browser, real Next dev server, real local API (port 4100) and the real local
 * PostgreSQL `hr_db`. Nothing here is mocked EXCEPT the explicitly labelled "network fault" tests,
 * which intercept browser requests to prove error handling (they use no database).
 *
 * Data: provisioned dev users (never modified) + records created here with the unique prefix
 * E2E-<run>. Created employees are cleaned up by TERMINATING them through the API (the audit log is
 * append-only and rows with audit history cannot be deleted). The foreign-company fixture has no audit
 * rows and is removed outright. EMP-900 and the provisioned users are never touched.
 */

const API = 'http://localhost:4100/api/v1';
const RUN = Date.now().toString(36).toUpperCase();
const apiDir = path.resolve(__dirname, '../../api');
const tsx = path.join(apiDir, 'node_modules/tsx/dist/cli.mjs');

const TOKENS = {
  hr: 'dev:dev-hr-admin',
  manager: 'dev:dev-manager',
  employee: 'dev:dev-employee',
} as const;
type Persona = keyof typeof TOKENS;
const auth = (p: Persona) => ({ authorization: `Bearer ${TOKENS[p]}` });

let foreign: { companyId: string; employeeId: string };
let createdId: string | undefined;

function fixture(command: 'create' | 'remove') {
  return execFileSync(process.execPath, [tsx, 'scripts/e2e-fixture.ts', command, RUN], {
    cwd: apiDir,
    encoding: 'utf8',
  }).trim();
}

test.beforeAll(() => {
  foreign = JSON.parse(fixture('create')) as typeof foreign;
});

test.afterAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  try {
    // The UI may fail after the API created the record (e.g. a slow first compile), so fall back to
    // looking the test-owned employee up by its unique run number.
    createdId ??= (await findCreatedByNumber(request))?.id;
    if (createdId) {
      const res = await request.put(`${API}/employees/${createdId}/status`, {
        headers: auth('hr'),
        data: { status: 'TERMINATED', terminationDate: '2026-11-19' },
      });
      expect([200, 409]).toContain(res.status()); // terminated (or already)
    }
  } finally {
    await request.dispose();
    fixture('remove');
  }
});

async function findCreatedByNumber(request: APIRequestContext) {
  const res = await request.get(`${API}/employees?q=${encodeURIComponent(`E2E-${RUN}-A`)}`, { headers: auth('hr') });
  if (!res.ok()) return undefined;
  const body = (await res.json()) as { data: { id: string; employeeNumber: string }[] };
  return body.data.find((e) => e.employeeNumber === `E2E-${RUN}-A`);
}

async function openAs(page: Page, persona: Persona) {
  await page.goto('/employees');
  await expect(page.getByRole('heading', { level: 1, name: 'Employees' })).toBeVisible();
  await expect(page.getByText('Development session.')).toBeVisible();
  if (persona !== 'hr') {
    const me = page.waitForResponse((r) => r.url().endsWith('/me') && r.status() === 200);
    await page.getByLabel('Dev: sign in as').selectOption(persona);
    await me;
  }
  await expect(page.getByText(/^\d+ employees? on this page$/)).toBeAttached();
}

const table = (page: Page) => page.getByTestId('employee-table');
const shownNames = async (page: Page) =>
  (await table(page).locator('a[href^="/employees/"]').allInnerTexts()).map((t) => t.trim());
const apiList = async (request: APIRequestContext, p: Persona, query = '') => {
  const res = await request.get(`${API}/employees${query}`, { headers: auth(p) });
  return { status: res.status(), body: (await res.json()) as { data: { id: string; firstName: string; lastName: string; employeeNumber: string }[] } };
};

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('HR Admin (real API + PostgreSQL)', () => {
  test('session resolves from /me and the directory shows all employees, not demo data', async ({ page, request }) => {
    await openAs(page, 'hr');
    await expect(page.getByText('Demo mode.')).toHaveCount(0);
    await expect(page.getByText('HR_ADMIN (from /me)')).toBeVisible();
    const names = await shownNames(page);
    for (const n of ['Hana Admin', 'Mia Manager', 'Ravi Reddy']) expect(names).toContain(n);
    expect(names).not.toContain('Meera Nair'); // a demo-data person
    const live = await apiList(request, 'hr', '?limit=100');
    expect(live.body.data.length).toBeGreaterThanOrEqual(3);
    expect(names.length).toBe(Math.min(live.body.data.length, 25));
  });

  test('creates, edits and changes status of an employee through the UI; it persists in PostgreSQL', async ({ page, request }) => {
    await openAs(page, 'hr');
    await page.getByRole('link', { name: 'Add employee' }).first().click();
    const form = page.getByRole('form', { name: 'Add employee' });
    const number = `E2E-${RUN}-A`;
    await form.getByLabel('Employee number').fill(number);
    await form.getByLabel('First name').fill('E2E');
    await form.getByLabel('Last name').fill(`Run${RUN}`);
    await form.getByLabel('Job title').fill('Test Engineer');
    await form.getByRole('button', { name: 'Create employee' }).click();

    // Generous: the first visit to /employees/[id] compiles the route in `next dev`.
    await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    createdId = page.url().split('/').pop();
    const profile = page.getByRole('article', { name: `Profile of E2E Run${RUN}` });
    await expect(profile).toBeVisible();
    await expect(profile.getByText('Test Engineer', { exact: true })).toBeVisible();

    // edit
    await page.getByRole('link', { name: 'Edit' }).first().click();
    const edit = page.getByRole('form', { name: 'Edit employee' });
    await edit.getByLabel('Job title').fill('Senior Test Engineer');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('article', { name: `Profile of E2E Run${RUN}` }).getByText('Senior Test Engineer', { exact: true })).toBeVisible();

    // status
    const status = page.getByRole('form', { name: 'Change employment status' });
    await status.getByLabel('Status').selectOption('ON_LEAVE');
    await status.getByRole('button', { name: 'Update status' }).click();
    await expect(page.getByRole('article', { name: `Profile of E2E Run${RUN}` }).getByText('On leave').first()).toBeVisible();

    // persisted: read back through the API, and after a full reload
    const got = await request.get(`${API}/employees/${createdId}`, { headers: auth('hr') });
    expect(got.status()).toBe(200);
    expect(await got.json()).toMatchObject({
      data: { employeeNumber: number, jobTitle: 'Senior Test Engineer', status: 'ON_LEAVE' },
    });
    await page.reload();
    await expect(page.getByRole('article', { name: `Profile of E2E Run${RUN}` })).toBeVisible();
  });
});

test.describe('Manager (real API + PostgreSQL)', () => {
  test('sees only self and direct reports, with no write controls', async ({ page }) => {
    await openAs(page, 'manager');
    await expect(page.getByText('MANAGER (from /me)')).toBeVisible();
    expect((await shownNames(page)).sort()).toEqual(['Mia Manager', 'Ravi Reddy']);
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Ravi Reddy' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Ravi Reddy' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Change employment status' })).toHaveCount(0);
  });

  test('the API itself refuses writes and out-of-scope reads', async ({ request }) => {
    const hr = await apiList(request, 'hr', `?q=${encodeURIComponent('Hana')}`);
    const hanaId = hr.body.data[0]!.id;
    const ravi = (await apiList(request, 'manager')).body.data.find((e) => e.firstName === 'Ravi')!;

    const body = { employeeNumber: `E2E-${RUN}-M`, firstName: 'No', lastName: 'Way' };
    expect((await request.post(`${API}/employees`, { headers: auth('manager'), data: body })).status()).toBe(403);
    expect((await request.patch(`${API}/employees/${ravi.id}`, { headers: auth('manager'), data: { jobTitle: 'x' } })).status()).toBe(403);
    expect((await request.put(`${API}/employees/${ravi.id}/status`, { headers: auth('manager'), data: { status: 'ON_LEAVE' } })).status()).toBe(403);
    // someone outside the team
    expect((await request.get(`${API}/employees/${hanaId}`, { headers: auth('manager') })).status()).not.toBe(200);
    // another company's record
    expect((await request.get(`${API}/employees/${foreign.employeeId}`, { headers: auth('manager') })).status()).not.toBe(200);
    // and nothing leaked into the list
    const list = await apiList(request, 'manager', `?q=${foreign.employeeId.slice(0, 4)}&limit=100`);
    expect(list.body.data.some((e) => e.id === foreign.employeeId)).toBe(false);
  });
});

test.describe('Employee (real API + PostgreSQL)', () => {
  test('sees only their own record, with no write controls', async ({ page }) => {
    await openAs(page, 'employee');
    await expect(page.getByText('EMPLOYEE (from /me)')).toBeVisible();
    expect(await shownNames(page)).toEqual(['Ravi Reddy']);
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Ravi Reddy' }).click();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Change employment status' })).toHaveCount(0);
  });

  test('the API refuses writes and reads of other people', async ({ request }) => {
    const own = (await apiList(request, 'employee')).body.data;
    expect(own).toHaveLength(1);
    const hanaId = (await apiList(request, 'hr', '?q=Hana')).body.data[0]!.id;
    expect((await request.get(`${API}/employees/${hanaId}`, { headers: auth('employee') })).status()).not.toBe(200);
    expect((await request.get(`${API}/employees/${foreign.employeeId}`, { headers: auth('employee') })).status()).not.toBe(200);
    const id = own[0]!.id;
    expect((await request.post(`${API}/employees`, { headers: auth('employee'), data: { employeeNumber: `E2E-${RUN}-E`, firstName: 'No', lastName: 'Way' } })).status()).toBe(403);
    expect((await request.patch(`${API}/employees/${id}`, { headers: auth('employee'), data: { jobTitle: 'x' } })).status()).toBe(403);
    expect((await request.put(`${API}/employees/${id}/status`, { headers: auth('employee'), data: { status: 'ON_LEAVE' } })).status()).toBe(403);
  });
});

test.describe('Authentication and tenant isolation (real API)', () => {
  test('invalid tokens are 401; an unknown identity fails safely', async ({ request }) => {
    for (const authorization of [undefined, 'Bearer bad', 'Bearer dev:unknown-person', 'Bearer dev:dev-manager:HR_ADMIN', 'Bearer dev:dev-manager:']) {
      const res = await request.get(`${API}/me`, { headers: authorization ? { authorization } : {} });
      expect(res.status(), String(authorization)).toBe(401);
    }
  });

  test('HR Admin cannot read or change another company\'s employee (404) and never lists it', async ({ request }) => {
    const h = { headers: auth('hr') };
    expect((await request.get(`${API}/employees/${foreign.employeeId}`, h)).status()).toBe(404);
    expect((await request.patch(`${API}/employees/${foreign.employeeId}`, { ...h, data: { jobTitle: 'hijack' } })).status()).toBe(404);
    expect((await request.put(`${API}/employees/${foreign.employeeId}/status`, { ...h, data: { status: 'ON_LEAVE' } })).status()).toBe(404);
    const found = await apiList(request, 'hr', `?q=Company${RUN}`);
    expect(found.body.data).toHaveLength(0);
    // and the foreign row is untouched
    const out = execFileSync(process.execPath, ['-e', `
      const pg=require('pg');require('dotenv').config({path:'../../.env',quiet:true});
      const u=new URL(process.env.DIRECT_URL);u.searchParams.delete('schema');
      const c=new pg.Client({connectionString:u.toString()});
      c.connect().then(()=>c.query('select "jobTitle",status from hr.employees where id=$1',[process.argv[1]])).then(r=>{console.log(JSON.stringify(r.rows[0]));return c.end()});
    `, foreign.employeeId], { cwd: apiDir, encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual({ jobTitle: null, status: 'ACTIVE' });
  });

  test('HR Admin opening another company\'s profile URL gets not-found in the UI', async ({ page }) => {
    await openAs(page, 'hr');
    await page.goto(`/employees/${foreign.employeeId}`);
    await expect(page.getByText('Employee not found')).toBeVisible();
    await expect(page.getByText(`Company${RUN}`)).toHaveCount(0);
  });
});

test.describe('Session behaviour in the browser', () => {
  test('changing identity re-requests /me and changes permissions', async ({ page }) => {
    await openAs(page, 'hr');
    await expect(page.getByRole('link', { name: 'Add employee' }).first()).toBeVisible();
    const meCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/me')) meCalls.push(r.headers()['authorization'] ?? '');
    });
    await page.getByLabel('Dev: sign in as').selectOption('employee');
    await expect(page.getByText('EMPLOYEE (from /me)')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);
    expect(meCalls).toContain(`Bearer ${TOKENS.employee}`);
    await page.getByLabel('Dev: sign in as').selectOption('hr');
    await expect(page.getByRole('link', { name: 'Add employee' }).first()).toBeVisible();
  });

  test('NETWORK FAULT (intercepted): a rejected token shows a 401 error state, no data, no demo', async ({ page }) => {
    await page.route('**/api/v1/me', (route) =>
      route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer bad' } }),
    );
    await page.goto('/employees');
    await expect(page.getByTestId('session-error')).toContainText('401');
    await expect(page.getByTestId('employee-table')).toHaveCount(0);
    await expect(page.getByText('Demo mode.')).toHaveCount(0);
  });

  test('NETWORK FAULT (intercepted): unknown identity from the token source fails safely', async ({ page }) => {
    await page.route('**/api/dev-session', (route) =>
      route.fulfill({ json: { persona: 'hr', token: 'dev:nobody' } }),
    );
    await page.goto('/employees');
    await expect(page.getByTestId('session-error')).toContainText('401');
    await expect(page.getByTestId('employee-table')).toHaveCount(0);
  });

  test('NETWORK FAULT (intercepted): API unavailable shows an error, never demo data', async ({ page }) => {
    await page.route('**/api/v1/**', (route) => route.abort());
    await page.goto('/employees');
    await expect(page.getByTestId('session-error')).toContainText('not reachable');
    await expect(page.getByTestId('employee-table')).toHaveCount(0);
    await expect(page.getByText('Demo mode.')).toHaveCount(0);
    await expect(page.getByText('Meera Nair')).toHaveCount(0);
  });
});

test.describe('No privileged values in the browser', () => {
  test('bundles and dev-session responses contain no database credentials', async ({ page }) => {
    const bodies: string[] = [];
    page.on('response', async (r) => {
      const type = r.headers()['content-type'] ?? '';
      if (/javascript|json|html/.test(type)) bodies.push(await r.text().catch(() => ''));
    });
    await openAs(page, 'hr');
    await page.waitForLoadState('networkidle');
    const env = readFileSync(path.resolve(apiDir, '../../.env'), 'utf8');
    const secrets = [...env.matchAll(/^(?:DATABASE_URL|DIRECT_URL|TEST_DATABASE_URL|TEST_DIRECT_URL)=postgresql:\/\/[^:]+:([^@]+)@/gm)].map((m) => decodeURIComponent(m[1]!));
    expect(secrets.length).toBeGreaterThan(0);
    const all = bodies.join('\n');
    expect(all.length).toBeGreaterThan(10_000); // we really inspected the bundles
    for (const s of secrets) expect(all.includes(s)).toBe(false);
    for (const needle of ['hr_migrator', 'postgresql://', 'DIRECT_URL', 'DATABASE_URL']) expect(all.includes(needle), needle).toBe(false);
    expect(all.includes('process.env.DEV_AUTH_ENABLED')).toBe(false); // the server-only flag is never read client-side
  });
});
