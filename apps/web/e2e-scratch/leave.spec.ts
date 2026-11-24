import { expect, test, type Page } from '@playwright/test';
import { apiCall, companyDate, resetDb, signIn, sql } from './support';

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeEach(() => resetDb());

async function apply(page: Page, start: string, end: string, reason: string) {
  await page.goto('/leave');
  await page.getByRole('button', { name: 'Apply for leave' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Leave type/).selectOption({ label: 'Casual Leave' });
  await dialog.getByLabel(/^Start date/).fill(start);
  await dialog.getByLabel(/^End date/).fill(end);
  await dialog.getByLabel(/^Reason/).fill(reason);
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog).toBeHidden();
}

const status = (reason: string) => sql<{ status: string; days: number }>(`select status, days from hr.leave_requests where reason='${reason}'`)[0];

test.describe('leave application and cancellation (LEAVE-003, LEAVE-007)', () => {
  test('an employee applies for leave, sees it pending, then cancels it', async ({ page }) => {
    await signIn(page, 'team');
    await apply(page, companyDate(10), companyDate(11), 'Family event');
    const table = page.getByRole('region', { name: 'Leave requests' });
    const row = table.locator('tr', { hasText: 'Family event' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Pending')).toBeVisible();
    expect(status('Family event')).toMatchObject({ status: 'PENDING', days: 2 });

    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.getByText('Cancelled')).toBeVisible();
    expect(status('Family event')?.status).toBe('CANCELLED');
  });

  test('overlapping and over-balance requests are refused with the server message and nothing is stored', async ({ page }) => {
    await signIn(page, 'team');
    await apply(page, companyDate(20), companyDate(21), 'First');
    await page.getByRole('button', { name: 'Apply for leave' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Leave type/).selectOption({ label: 'Casual Leave' });
    await dialog.getByLabel(/^Start date/).fill(companyDate(21));
    await dialog.getByLabel(/^End date/).fill(companyDate(22));
    await dialog.getByLabel(/^Reason/).fill('Overlaps');
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expect(dialog.getByRole('alert').or(dialog.getByText(/overlap|already/i)).first()).toBeVisible();
    expect(status('Overlaps')).toBeUndefined();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const long = await apiCall(page, 'POST', '/leave/requests', {
      leaveTypeId: sql<{ id: string }>(`select id from hr.leave_types limit 1`)[0]!.id,
      startDate: companyDate(40), endDate: companyDate(70), dayType: 'FULL_DAY', reason: 'Too long',
    });
    expect(long.status).toBe(400);
    expect(status('Too long')).toBeUndefined();
  });
});

test.describe('manager leave approval (LEAVE-005, LEAVE-006)', () => {
  test('a Manager approves a report\'s leave; an HR Admin cannot approve their own', async ({ browser }) => {
    const empCtx = await browser.newContext();
    const emp = await empCtx.newPage();
    await signIn(emp, 'team');
    await apply(emp, companyDate(15), companyDate(15), 'Dentist');

    const mgrCtx = await browser.newContext();
    const mgr = await mgrCtx.newPage();
    await signIn(mgr, 'mgr');
    await mgr.goto('/leave');
    const pending = mgr.getByRole('region', { name: 'Pending leave requests' });
    const row = pending.locator('tr', { hasText: 'Dentist' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(pending.locator('tr', { hasText: 'Dentist' })).toHaveCount(0);
    expect(status('Dentist')?.status).toBe('APPROVED');

    const hrCtx = await browser.newContext();
    const hr = await hrCtx.newPage();
    await signIn(hr, 'hr');
    await apply(hr, companyDate(30), companyDate(30), 'HR own');
    const id = sql<{ id: string }>(`select id from hr.leave_requests where reason='HR own'`)[0]!.id;
    expect((await apiCall(hr, 'PATCH', `/leave/requests/${id}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect(status('HR own')?.status).toBe('PENDING');
    await empCtx.close();
    await mgrCtx.close();
    await hrCtx.close();
  });

  test('an employee sees no approvals and cannot decide anything', async ({ page }) => {
    await signIn(page, 'team');
    await page.goto('/leave');
    await expect(page.getByRole('region', { name: 'Pending leave requests' })).toHaveCount(0);
    const id = '00000000-0000-4000-8000-000000000000';
    expect([403, 404]).toContain((await apiCall(page, 'PATCH', `/leave/requests/${id}/review`, { status: 'APPROVED' })).status);
  });
});
