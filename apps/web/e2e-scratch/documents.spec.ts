import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { API_ORIGIN, apiCall, resetDb, signIn, sql } from './support';

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeEach(() => resetDb());

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('e2e document body '.repeat(50))]);

async function upload(page: Page, name = 'passport.pdf', buffer = PDF, mimeType = 'application/pdf') {
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Upload document' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('File').setInputFiles({ name, mimeType, buffer });
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('document upload, preview, download (DOC-001, DOC-003)', () => {
  test('uploads through multipart, lists the file, previews and downloads it through a signed link', async ({ page }) => {
    await signIn(page, 'team');
    await upload(page);
    const row = page.locator('tr', { hasText: 'passport.pdf' });
    await expect(row).toBeVisible();
    const [stored] = sql<{ storedPath: string; sizeBytes: number; mimeType: string }>(`select "storedPath","sizeBytes","mimeType" from hr.employee_documents`);
    expect(stored).toMatchObject({ sizeBytes: PDF.length, mimeType: 'application/pdf' });
    expect(stored!.storedPath).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/); // company/owner/uuid, no file name

    // download: the API answers with a 60-second link and the browser follows it
    const linkPromise = page.waitForResponse((r) => /\/documents\/[^/]+\/download/.test(r.url()) && r.request().method() === 'GET');
    const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Download' }).click()]);
    const link = (await (await linkPromise).json()) as { data: { url: string; expiresInSeconds: number } };
    expect(link.data.expiresInSeconds).toBe(60);
    expect(link.data.url).toContain('/documents/local-file/');
    expect(download.suggestedFilename()).toBe('passport.pdf');
    expect(readFileSync((await download.path())!).equals(PDF)).toBe(true);

    // preview: a new tab opens on an inline link
    const [popup] = await Promise.all([page.waitForEvent('popup'), row.getByRole('button', { name: 'Preview' }).click()]);
    await popup.waitForURL(/\/documents\/local-file\//, { timeout: 20_000 });
    await popup.close();
  });

  test('a signed link stops working after 60 seconds', async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, 'team');
    await upload(page);
    const id = sql<{ id: string }>(`select id from hr.employee_documents`)[0]!.id;
    const link = (await apiCall(page, 'GET', `/documents/${id}/download`)).json.data as { url: string };
    const fresh = await page.request.get(link.url);
    expect(fresh.status()).toBe(200);
    await page.waitForTimeout(62_000);
    expect((await page.request.get(link.url)).status()).toBe(403);
  });

  test('the server rejects a disallowed or disguised file even when the browser checks are bypassed', async ({ page }) => {
    await signIn(page, 'team');
    const csrf = decodeURIComponent((await page.context().cookies(API_ORIGIN)).find((c) => c.name === 'gsc_csrf')!.value);
    const post = (name: string, mimeType: string, buffer: Buffer) =>
      page.request.post(`${API_ORIGIN}/api/v1/documents/employee`, { headers: { 'X-CSRF-Token': csrf }, multipart: { category: 'ID_PROOF', file: { name, mimeType, buffer } } });
    expect((await post('x.html', 'text/html', Buffer.from('<html></html>'))).status()).toBe(400);
    expect((await post('fake.pdf', 'application/pdf', Buffer.from('<script>alert(1)</script>'))).status()).toBe(400);
    expect((await post('big.pdf', 'application/pdf', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]))).status()).toBe(413);
    expect(sql(`select count(*)::int n from hr.employee_documents`)[0]).toEqual({ n: 0 });
  });
});

test.describe('visibility, deletion (DOC-004, DOC-005)', () => {
  test('a peer cannot see or fetch another employee\'s document; HR deletes it and it disappears everywhere', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    await signIn(owner, 'team');
    await upload(owner, 'private.pdf');
    const id = sql<{ id: string }>(`select id from hr.employee_documents`)[0]!.id;

    const peerCtx = await browser.newContext();
    const peer = await peerCtx.newPage();
    await signIn(peer, 'peer');
    await peer.goto('/documents');
    await expect(peer.getByText('private.pdf')).toHaveCount(0);
    expect((await apiCall(peer, 'GET', `/documents/${id}/download`)).status).toBe(403);

    const hrCtx = await browser.newContext();
    const hr = await hrCtx.newPage();
    await signIn(hr, 'hr');
    await hr.goto('/documents');
    const row = hr.locator('tr', { hasText: 'private.pdf' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();
    await hr.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(hr.locator('tr', { hasText: 'private.pdf' })).toHaveCount(0);
    const [d] = sql<{ deletedAt: string | null; purgeAfterAt: string | null }>(`select "deletedAt","purgeAfterAt" from hr.employee_documents where id='${id}'`);
    expect(d!.deletedAt).not.toBeNull();
    expect(d!.purgeAfterAt).not.toBeNull();
    expect((await apiCall(owner, 'GET', `/documents/${id}/download`)).status).toBe(404);
    await ownerCtx.close();
    await peerCtx.close();
    await hrCtx.close();
  });

  test('an employee has no delete, visibility or company-upload controls', async ({ page }) => {
    await signIn(page, 'team');
    await upload(page);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Company documents' }).click();
    await expect(page.getByRole('button', { name: 'Upload document' })).toHaveCount(0);
  });
});
