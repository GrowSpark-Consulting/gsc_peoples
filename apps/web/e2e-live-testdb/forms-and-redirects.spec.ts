import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Password-form security, redirect safety, CSRF and bearer separation, in a real browser against the
 * real local API and REAL PostgreSQL (`hr_test` only; see playwright.live-testdb.config.ts). Reset and
 * invitation tokens are the genuine ones issued by the API (nothing is stubbed or intercepted).
 */

const API = 'http://localhost:4300/api/v1';
const WEB = 'http://localhost:3300';
const PASSWORD = 'E2e-Test-Pass-1!'; // throwaway credential for hr_test only
const HR = { email: 'hana.admin@dev.local', externalId: 'dev-hr-admin' };

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

const formAlert = (page: Page) => page.locator('form [role="alert"]');

/** Records every navigation URL and every request (URL, method, referer) so leaks can be asserted. */
function recorder(page: Page) {
  const urls: string[] = [];
  const requests: { url: string; method: string; referer?: string }[] = [];
  page.on('framenavigated', (f) => urls.push(f.url()));
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), referer: r.headers().referer }));
  return {
    urls,
    requests,
    expectNoLeak(secrets: string[]) {
      const hay = [...urls, ...requests.flatMap((r) => [r.url, r.referer ?? ''])];
      for (const s of secrets) {
        for (const form of [s, encodeURIComponent(s)]) {
          for (const h of hay) expect(h, `secret "${s}" leaked into ${h}`).not.toContain(form);
        }
      }
    },
  };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click(); // auto-waits until hydrated (enabled)
}

async function csrf(context: BrowserContext) {
  const c = (await context.cookies(API)).find((x) => x.name === 'gsc_csrf');
  expect(c).toBeDefined();
  return decodeURIComponent(c!.value);
}

async function resetToken(request: import('@playwright/test').APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/forgot-password`, { data: { email } });
  expect(res.status()).toBe(200);
  const token = res.headers()['x-development-reset-token'];
  expect(token, 'the non-production API issues a development reset token header').toBeTruthy();
  return token!;
}

test.describe('login form', () => {
  test('server-rendered markup is a POST form with the submit button disabled until hydration', async ({ request }) => {
    const html = await (await request.get('/login')).text();
    expect(html).toMatch(/<form[^>]*method="post"/i);
    expect(html).toMatch(/<button[^>]*disabled/i);
  });

  test('without JavaScript a native submit is a POST and no credential reaches a URL', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: WEB });
    const page = await context.newPage();
    const rec = recorder(page);
    const secret = 'Zq9-Native-Marker!';
    await page.goto('/login');
    await page.locator('#email').fill(HR.email);
    await page.locator('#password').fill(secret);
    // The button is disabled in the HTML, so submit the way a keyboard user would.
    await page.locator('#password').press('Enter');
    await page.waitForLoadState('load');
    expect(new URL(page.url()).search).toBe('');
    const posts = rec.requests.filter((r) => r.method === 'POST');
    expect(posts.every((r) => !r.url.includes('password=') && !r.url.includes('email='))).toBe(true);
    rec.expectNoLeak([secret, HR.email]);
    await context.close();
  });

  test('an immediate click before hydration cannot leak credentials, and sign-in then works', async ({ page }) => {
    const rec = recorder(page);
    await page.goto('/login', { waitUntil: 'commit' });
    await page.locator('#email').fill(HR.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click({ force: true }); // may land before hydration
    // Either hydration finished and it signed in, or the click was ignored; never a native GET.
    await page.waitForTimeout(500);
    expect(rec.urls.every((u) => !/[?&](email|password)=/.test(u))).toBe(true);
    rec.expectNoLeak([PASSWORD]);
    if (!/\/dashboard$/.test(page.url())) {
      await page.getByRole('button', { name: 'Sign in' }).click();
    }
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    rec.expectNoLeak([PASSWORD]);
  });

  test('a validation error (400) shows a message and puts nothing in the URL', async ({ page }) => {
    const rec = recorder(page);
    await signIn(page, HR.email, 'short');
    await expect(formAlert(page)).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    rec.expectNoLeak(['short=', PASSWORD]);
    const login = rec.requests.find((r) => r.url === `${API}/auth/login`);
    expect(login?.method).toBe('POST');
  });
});

test.describe('forgot password', () => {
  test('POSTs the email, answers identically for known and unknown accounts, and leaves the URL clean', async ({ page }) => {
    const rec = recorder(page);
    const messages: string[] = [];
    for (const email of [HR.email, 'nobody@dev.local']) {
      await page.goto('/forgot-password');
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Send reset link' }).click();
      await expect(page.getByRole('status')).toContainText('reset link has been issued');
      messages.push(await page.getByRole('status').innerText());
      expect(new URL(page.url()).search).toBe('');
    }
    expect(messages[0]).toBe(messages[1]); // no account enumeration
    const calls = rec.requests.filter((r) => r.url === `${API}/auth/forgot-password`);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST']);
    rec.expectNoLeak([HR.email]);
  });
});

test.describe('reset password', () => {
  test('invalid token and too-short password are rejected without leaking the password into any URL', async ({ page }) => {
    const rec = recorder(page);
    const secret = 'Zq9-Reset-Marker!';
    await page.goto(`/reset-password?token=${'x'.repeat(43)}`);
    await page.getByLabel('New password').fill(secret);
    await page.getByRole('button', { name: 'Set password' }).click();
    // The API's 401 replaces the form with the invalid-link message and a way to request a new link.
    await expect(page.getByRole('alert')).toContainText('invalid or has expired');
    await expect(page.getByRole('link', { name: 'Send reset link' })).toHaveAttribute('href', '/forgot-password');
    expect(new URL(page.url()).searchParams.get('password')).toBeNull();

    // A too-short password is refused in the browser, before any request.
    await page.goto(`/reset-password?token=${'x'.repeat(43)}`);
    await page.getByLabel('New password').fill('tooshort1'); // 9 characters: below the PRD minimum of 10
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(formAlert(page)).toContainText('Password must be 10 to 128 characters');
    rec.expectNoLeak([secret, 'tooshort1']);
    const posts = rec.requests.filter((r) => r.url === `${API}/auth/reset-password`);
    expect(posts).toHaveLength(1);
    expect(posts.every((p) => p.method === 'POST')).toBe(true);
  });

  test('a real reset token works once: password changes, old password and old sessions die, token is single-use', async ({ page, request, context }) => {
    const rec = recorder(page);
    // An existing session that the reset must revoke.
    await signIn(page, HR.email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    const oldSession = (await context.cookies(API)).find((c) => c.name === 'gsc_session')!.value;

    const token = await resetToken(request, HR.email);
    const next = 'Zq9-Brand-New-Pass!';
    await page.goto(`/reset-password?token=${token}`);
    await page.getByLabel('New password').fill(next);
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    rec.expectNoLeak([next, PASSWORD]);

    expect((await request.get(`${API}/me`, { headers: { cookie: `gsc_session=${oldSession}` } })).status()).toBe(401);

    // Old password fails, new password works through the real login form.
    await context.clearCookies();
    await page.getByLabel('Email').fill(HR.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(formAlert(page)).toContainText('Invalid email or password');
    await page.getByLabel('Password', { exact: true }).fill(next);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    // Single use.
    const again = await request.post(`${API}/auth/reset-password`, { data: { token, password: 'Another-Long-Pass-2!' } });
    expect(again.status()).toBe(401);
    rec.expectNoLeak([next, PASSWORD, 'Another-Long-Pass-2!']);
  });
});

test.describe('accept invitation', () => {
  test('an HR-issued invitation activates a new account once; failures stay on the page with clean URLs', async ({ page, browser, context }) => {
    // A Super Admin signs in and invites a new user through the real settings API (cookie auth + CSRF).
    // (Settings routes are Super Admin only today; PRD AUTH-004 also allows HR: tracked as a defect.)
    fx('promote-super-admin', HR.externalId);
    await signIn(page, HR.email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    const invite = await context.request.post(`${API}/settings/users/invite`, {
      data: { email: 'new.hire@dev.local', name: 'New Hire', roleKey: 'EMPLOYEE' },
      headers: { 'x-csrf-token': await csrf(context) },
    });
    expect(invite.status()).toBe(201);
    const token = ((await invite.json()) as { data: { invitationToken: string } }).data.invitationToken;

    const inviteeCtx = await browser.newContext({ baseURL: WEB });
    const invitee = await inviteeCtx.newPage();
    const rec = recorder(invitee);
    const secret = 'Zq9-Invite-Marker!';

    // Bad token.
    await invitee.goto(`/accept-invitation?token=${'y'.repeat(43)}`);
    await invitee.getByLabel('Password', { exact: true }).fill(secret);
    await invitee.getByLabel('Confirm password').fill(secret);
    await invitee.getByRole('button', { name: 'Activate account' }).click();
    await expect(invitee.getByRole('alert')).toContainText('invalid, has expired or has already been used');
    // Too-short password with a good token: refused in the browser, token not consumed.
    await invitee.goto(`/accept-invitation?token=${token}`);
    await invitee.getByLabel('Password', { exact: true }).fill('tooshort1');
    await invitee.getByLabel('Confirm password').fill('tooshort1');
    await invitee.getByRole('button', { name: 'Activate account' }).click();
    await expect(formAlert(invitee)).toContainText('Password must be 10 to 128 characters');

    // Good token and password: account activates and a session cookie is issued.
    await invitee.getByLabel('Password', { exact: true }).fill(secret);
    await invitee.getByLabel('Confirm password').fill(secret);
    await invitee.getByRole('button', { name: 'Activate account' }).click();
    await expect(invitee).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    const cookies = await inviteeCtx.cookies(API);
    expect(cookies.find((c) => c.name === 'gsc_session')?.httpOnly).toBe(true);
    const me = await inviteeCtx.request.get(`${API}/me`);
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { data: { roles: string[] } }).data.roles).toEqual(['EMPLOYEE']);

    // Single use.
    const reuse = await inviteeCtx.request.post(`${API}/auth/accept-invitation`, { data: { token, password: 'Yet-Another-Pass-3!' } });
    expect(reuse.status()).toBe(401);

    rec.expectNoLeak([secret, 'tooshort1']);
    expect(rec.requests.filter((r) => r.url === `${API}/auth/accept-invitation`).every((r) => r.method === 'POST')).toBe(true);
    await inviteeCtx.close();
  });
});

test.describe('redirect safety (real navigation)', () => {
  const attacks: [string, string][] = [
    ['absolute URL', 'https://evil.example/x'],
    ['protocol-relative', '//evil.example/x'],
    ['backslash', '/\\evil.example'],
    ['tab character', '/\t/evil.example'], // a REAL tab: browsers strip it, which would yield //evil.example
    ['newline character', '/\n/evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
  ];
  for (const [label, attack] of attacks) {
    test(`after sign-in, next=${label} is ignored and lands on the dashboard`, async ({ page, context }) => {
      const requested: string[] = [];
      page.on('request', (r) => requested.push(r.url()));
      await context.clearCookies();
      await page.goto(`/login?next=${encodeURIComponent(attack)}`);
      await page.getByLabel('Email').fill(HR.email);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(`${WEB}/dashboard`, { timeout: 30_000 });
      // No request may ever go to the attacker's host (the /login?next=... URL itself merely contains the text).
      expect(requested.filter((u) => new URL(u).hostname.includes('evil.example'))).toEqual([]);
    });
  }

  test('a valid internal path keeps its query and hash', async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent('/employees?q=Mia#results')}`);
    await page.getByLabel('Email').fill(HR.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${WEB}/employees?q=Mia#results`, { timeout: 30_000 });
  });

  test('the server gate only ever redirects to its own origin, even for odd paths', async ({ request }) => {
    for (const p of ['/employees', '//evil.example/employees', '/employees//evil.example', '/%5Cevil.example']) {
      const res = await request.get(`${WEB}${p}`, { maxRedirects: 0 });
      const location = res.headers().location;
      if (res.status() === 307) {
        const target = new URL(location!, WEB); // relative or absolute, it must stay on our origin
        expect(target.origin, p).toBe(WEB);
        expect(target.pathname, p).toBe('/login');
      } else {
        expect([308, 404]).toContain(res.status()); // framework normalisation or not found, never off-site
        if (location) {
          // A path that merely contains the word is fine (`//evil.example` is normalised to the
          // same-origin path `/evil.example/...`); what must never happen is leaving our origin.
          expect(location, p).not.toMatch(/^(\/\/|\/\\|\\)/); // never protocol-relative
          expect(new URL(location, WEB).origin, p).toBe(WEB);
        }
      }
    }
  });
});

test.describe('CORS, CSRF and bearer separation (real HTTP)', () => {
  test('preflight allows PATCH, PUT and the CSRF header from the web origin only', async ({ request }) => {
    for (const method of ['POST', 'PATCH', 'PUT']) {
      const res = await request.fetch(`${API}/employees`, {
        method: 'OPTIONS',
        headers: {
          origin: WEB,
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type,x-csrf-token',
        },
      });
      expect(res.headers()['access-control-allow-origin'], method).toBe(WEB);
      expect(res.headers()['access-control-allow-methods'], method).toContain(method);
      expect(res.headers()['access-control-allow-headers']?.toLowerCase()).toContain('x-csrf-token');
    }
  });

  test('a forged CSRF cookie/header pair is refused: the token must match the session', async ({ page, context }) => {
    await signIn(page, HR.email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await context.addCookies([{ name: 'gsc_csrf', value: 'forged-value', url: API }]);
    const before = fx('count', 'employees');
    const res = await context.request.post(`${API}/employees`, {
      data: { employeeNumber: 'E2E-FORGED', firstName: 'No', lastName: 'Way' },
      headers: { 'x-csrf-token': 'forged-value' },
    });
    expect(res.status()).toBe(403);
    expect(fx('count', 'employees')).toBe(before);
  });

  test('an invalid session plus a bearer header never falls back to the bearer; bearer cannot bypass CSRF on a session', async ({ page, context, request }) => {
    const bearer = { authorization: 'Bearer dev:dev-hr-admin' };
    // Dead session cookie + bearer: still 401.
    const dead = await request.get(`${API}/me`, { headers: { ...bearer, cookie: 'gsc_session=not-a-real-session' } });
    expect(dead.status()).toBe(401);

    // Live session + bearer header on a write without CSRF: CSRF still enforced (bearer does not switch it off).
    await signIn(page, HR.email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    const res = await context.request.post(`${API}/employees`, {
      data: { employeeNumber: 'E2E-BEARER', firstName: 'No', lastName: 'Way' },
      headers: bearer,
    });
    expect(res.status()).toBe(403);
    expect(fx('employee-by-number', 'E2E-BEARER')).toBe('null');
  });
});
