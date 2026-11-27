import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_ORIGIN, apiCall, empId, resetDb, signIn, sql } from './support';
import { JPG, TEST_AADHAAR, TEST_PAN, fillIdentity } from './identity-helpers';

/**
 * Government ID documents end to end: real browser -> production web build -> real API (session auth, CSRF,
 * local private storage, AES-GCM key from the test config) -> scratch PostgreSQL with RLS.
 */

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeEach(() => resetDb());

const OUT = path.resolve(__dirname, '../test-results/identity-documents');

async function addEmployeeWithDocument(page: Page, email: string) {
  await page.goto('/employees/new');
  await page.getByLabel(/^First name/).fill('Ira');
  await page.getByLabel(/^Last name/).fill('Joshi');
  await page.getByLabel(/^Work email/).fill(email);
  await page.getByLabel(/^Hire date/).fill('2026-12-01');
  await page.getByLabel(/^Department/).selectOption({ label: 'Engineering' });
  await page.getByLabel(/^Designation/).selectOption({ label: 'Software Engineer' });
  await fillIdentity(page);
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/);
  return sql<{ id: string }>(`select id from hr.employees where "workEmail"='${email}'`)[0]!.id;
}

async function apiUpload(page: Page, employeeId: string, type: 'AADHAAR' | 'PAN', number: string) {
  const csrf = decodeURIComponent((await page.context().cookies(API_ORIGIN)).find((c) => c.name === 'gsc_csrf')!.value);
  return page.request.put(`${API_ORIGIN}/api/v1/employees/${employeeId}/identity-document`, {
    headers: { 'X-CSRF-Token': csrf },
    multipart: {
      documentType: type,
      documentNumber: number,
      consent: 'true',
      front: { name: 'front.jpg', mimeType: 'image/jpeg', buffer: JPG },
      ...(type === 'PAN' ? {} : { back: { name: 'back.jpg', mimeType: 'image/jpeg', buffer: JPG } }),
    },
  });
}

test.describe('Add employee with a mandatory government ID', () => {
  test('HR cannot create without the document; with it, the employee and an encrypted document are created', async ({ page }) => {
    await signIn(page, 'hr');
    await page.goto('/employees/new');
    await page.getByLabel(/^First name/).fill('Ira');
    await page.getByLabel(/^Last name/).fill('Joshi');
    await page.getByLabel(/^Work email/).fill('ira@e2e.local');
    await page.getByLabel(/^Hire date/).fill('2026-12-01');
    await page.getByLabel(/^Department/).selectOption({ label: 'Engineering' });
    await page.getByLabel(/^Designation/).selectOption({ label: 'Software Engineer' });
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(page.getByText('Complete the identity document section before creating the employee.')).toBeVisible();
    expect(sql(`select id from hr.employees where "workEmail"='ira@e2e.local'`)).toHaveLength(0);

    // The number is masked while typing.
    await fillIdentity(page);
    await expect(page.getByLabel(/^Document number/)).toHaveClass(/text-security/);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/);
    const id = sql<{ id: string }>(`select id from hr.employees where "workEmail"='ira@e2e.local'`)[0]!.id;
    const [doc] = sql<{ numberCiphertext: string; numberLast4: string; documentType: string }>(`select "numberCiphertext","numberLast4","documentType" from hr.employee_identity_documents where "employeeId"='${id}'`);
    expect(doc).toMatchObject({ documentType: 'AADHAAR', numberLast4: TEST_AADHAAR.slice(-4) });
    expect(doc!.numberCiphertext).not.toContain(TEST_AADHAAR);

    // Profile shows the masked number only.
    const card = page.getByRole('region', { name: 'Identity documents' });
    await expect(card.getByText(`XXXX XXXX ${TEST_AADHAAR.slice(-4)}`)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(TEST_AADHAAR);
    await expect(card.getByRole('button', { name: /Reveal/ })).toHaveCount(0); // HR never sees the full number
  });
});

test.describe('profile: roles, preview, reveal', () => {
  test('Super Admin reveals the full number (audited); HR cannot, even through the API', async ({ page }) => {
    await signIn(page, 'sa');
    const team = empId('team');
    expect((await apiUpload(page, team, 'AADHAAR', TEST_AADHAAR)).status()).toBe(201);
    await page.goto(`/employees/${team}`);
    const card = page.getByRole('region', { name: 'Identity documents' });
    await card.getByRole('button', { name: 'Reveal full number' }).click();
    await expect(card.getByText(TEST_AADHAAR)).toBeVisible();
    await expect(card.getByText(/This view was recorded/)).toBeVisible();
    await card.getByRole('button', { name: 'Hide' }).click();
    await expect(card.getByText(TEST_AADHAAR)).toHaveCount(0);
    expect(sql(`select id from hr.audit_logs where action='identity_document.number_revealed'`)).toHaveLength(1);

    await page.context().clearCookies();
    await signIn(page, 'hr');
    expect((await apiCall(page, 'POST', `/employees/${team}/identity-document/reveal`)).status).toBe(403);
    const masked = await apiCall(page, 'GET', `/employees/${team}/identity-document`);
    expect(JSON.stringify(masked.json)).not.toContain(TEST_AADHAAR);
  });

  test('HR previews a document through a 60-second link; the view is audited', async ({ page }) => {
    await signIn(page, 'hr');
    const team = empId('team');
    expect((await apiUpload(page, team, 'AADHAAR', TEST_AADHAAR)).status()).toBe(201);
    await page.goto(`/employees/${team}`);
    const card = page.getByRole('region', { name: 'Identity documents' });
    const linkPromise = page.waitForResponse((r) => /\/identity-document\/front\/link/.test(r.url()));
    const [popup] = await Promise.all([page.waitForEvent('popup'), card.getByRole('button', { name: 'Preview front side' }).click()]);
    const link = (await (await linkPromise).json()) as { data: { url: string; expiresInSeconds: number } };
    expect(link.data.expiresInSeconds).toBe(60);
    expect(link.data.url).toContain('/identity-documents/local-file/');
    await popup.waitForURL(/\/identity-documents\/local-file\//, { timeout: 20_000 });
    await popup.close();
    expect(sql(`select id from hr.audit_logs where action='identity_document.viewed'`)).toHaveLength(1);
  });

  test('an employee submits and replaces their own document; a Manager sees no identity section', async ({ page }) => {
    await signIn(page, 'team');
    await page.goto('/profile');
    const card = page.getByRole('region', { name: 'Identity documents' });
    await card.getByRole('button', { name: 'Add identity document' }).click();
    await fillIdentity(page, { type: 'PAN', audience: 'self' });
    await card.getByRole('button', { name: 'Submit document' }).click();
    await expect(card.getByText('Identity document saved.')).toBeVisible();
    await expect(card.getByText(`XXXXXX${TEST_PAN.slice(-4)}`)).toBeVisible();
    await expect(card.getByRole('button', { name: /Delete/ })).toHaveCount(0);

    await card.getByRole('button', { name: /Replace document/ }).click();
    await fillIdentity(page, { audience: 'self' });
    await card.getByRole('button', { name: 'Replace document' }).click();
    await expect(card.getByText('Identity document replaced.')).toBeVisible();
    expect(sql(`select id from hr.employee_identity_documents where "deletedAt" is not null`)).toHaveLength(1);

    await page.context().clearCookies();
    await signIn(page, 'mgr');
    await page.goto(`/employees/${empId('team')}`);
    await expect(page.getByRole('article')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Identity documents' })).toHaveCount(0);
    expect((await apiCall(page, 'GET', `/employees/${empId('team')}/identity-document`)).status).toBe(403);
  });

  test('cross-tenant access is refused', async ({ page }) => {
    await signIn(page, 'hrb');
    expect((await apiCall(page, 'GET', `/employees/${empId('team')}/identity-document`)).status).toBe(404);
  });
});

test.describe('layout: light and dark themes, phone to desktop', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [375, 768, 1280]) {
      test(`${theme} @ ${width}px: Add employee identity section and profile card fit the viewport`, async ({ page }) => {
        test.setTimeout(120_000);
        fs.mkdirSync(OUT, { recursive: true });
        await page.addInitScript((t) => localStorage.setItem('gs-theme', t), theme);
        await page.setViewportSize({ width, height: 900 });
        await signIn(page, 'hr');
        await page.goto('/employees/new');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const section = page.getByRole('region', { name: 'Government ID / Identity proof' });
        await expect(section).toBeVisible();
        await fillIdentity(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        await section.screenshot({ path: path.join(OUT, `add-${theme}-${width}.png`) });

        const team = empId('team');
        expect((await apiUpload(page, team, 'AADHAAR', TEST_AADHAAR)).status()).toBe(201);
        await page.goto(`/employees/${team}`);
        const card = page.getByRole('region', { name: 'Identity documents' });
        await expect(card.getByText(`XXXX XXXX ${TEST_AADHAAR.slice(-4)}`)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
        await card.screenshot({ path: path.join(OUT, `profile-${theme}-${width}.png`) });
      });
    }
  }
});

test('the two-step flow from the Add employee page stores exactly one active document', async ({ page }) => {
  await signIn(page, 'hr');
  const id = await addEmployeeWithDocument(page, 'kiran@e2e.local');
  expect(sql(`select id from hr.employee_identity_documents where "employeeId"='${id}' and "deletedAt" is null`)).toHaveLength(1);
});
