import { expect, test } from '@playwright/test';
import { apiCall, companyDate, empId, resetDb, signIn, sql } from './support';

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeEach(() => resetDb());

test.describe('employee check-in / check-out (ATT-001, ATT-002)', () => {
  test('checks in and out once; a second check-in is refused with 409 and nothing is duplicated', async ({ page }) => {
    await signIn(page, 'team');
    await page.goto('/attendance');
    await page.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByText('Checked in', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check out' })).toBeVisible();
    expect(sql(`select count(*)::int n from hr.attendance_records where "checkInAt" is not null`)[0]).toEqual({ n: 1 });

    const dup = await apiCall(page, 'POST', '/attendance/check-in');
    expect(dup.status).toBe(409);
    expect(sql(`select count(*)::int n from hr.attendance_records`)[0]).toEqual({ n: 1 });

    await page.getByRole('button', { name: 'Check out' }).click();
    await expect(page.getByRole('button', { name: 'Done for today' })).toBeDisabled();
    const [row] = sql<{ checkOutAt: string | null }>(`select "checkOutAt" from hr.attendance_records`);
    expect(row!.checkOutAt).not.toBeNull();
    // the record is dated with the COMPANY calendar day (Asia/Kolkata), not the UTC date
    expect(sql<{ d: string }>(`select to_char(date,'YYYY-MM-DD') d from hr.attendance_records`)[0]!.d).toBe(companyDate(0));
  });
});

test.describe('HR attendance overview and manual correction (ATT-004, ATT-007)', () => {
  test('HR sees everyone for a date, corrects one employee, and the correction is audited', async ({ page }) => {
    await signIn(page, 'hr');
    await page.goto('/attendance');
    const overview = page.getByRole('region', { name: 'Attendance overview' });
    await expect(overview.getByText('Pia Peer')).toBeVisible();
    await expect(overview.getByText('Ravi Reddy')).toBeVisible();
    await expect(overview.getByText('Hugo Otherco')).toHaveCount(0); // other company
    // nobody has checked in and the working day has not ended (work end 23:59): "Not yet in", never "Absent"
    await expect(overview.getByText('Not yet in').first()).toBeVisible();
    await expect(overview.getByText('Absent', { exact: true })).toHaveCount(0);

    await overview.locator('tr', { hasText: 'Pia Peer' }).getByRole('button', { name: 'Correct' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/^Employee/)).toHaveValue(empId('peer'));
    await dialog.getByLabel('Check in').fill('09:15');
    await dialog.getByLabel('Check out').fill('17:45');
    await dialog.getByLabel(/Reason/).fill('Kiosk was down');
    await dialog.getByRole('button', { name: 'Save correction' }).click();
    await expect(dialog).toBeHidden();

    const row = overview.locator('tr', { hasText: 'Pia Peer' });
    await expect(row.getByText('Present')).toBeVisible();
    await expect(row.getByText('Corrected')).toBeVisible();
    await expect(row.getByText('09:15')).toBeVisible();
    const [rec] = sql<{ correctionReason: string }>(`select "correctionReason" from hr.attendance_records`);
    expect(rec!.correctionReason).toBe('Kiosk was down');
    expect(sql(`select action from hr.audit_logs where action='attendance.manual_correction'`)).toHaveLength(1);
  });

  test('the server refuses a manual correction for a future date and writes nothing', async ({ page }) => {
    await signIn(page, 'hr');
    const res = await apiCall(page, 'POST', '/attendance/manual-corrections', { employeeId: empId('peer'), date: companyDate(2), checkInAt: new Date().toISOString(), reason: 'x' });
    expect(res.status).toBe(400);
    expect(sql(`select count(*)::int n from hr.attendance_records`)[0]).toEqual({ n: 0 });
  });
});

test.describe('manager team attendance and correction approval (ATT-003, ATT-005, ATT-006)', () => {
  test('a Manager sees their report, not a peer; the report requests a correction and the Manager approves it', async ({ browser }) => {
    const empCtx = await browser.newContext();
    const employee = await empCtx.newPage();
    await signIn(employee, 'team');
    await employee.goto('/attendance');
    await employee.getByRole('button', { name: 'Request correction' }).click();
    const dlg = employee.getByRole('dialog');
    await dlg.getByLabel(/^Date/).fill(companyDate(-1));
    await dlg.getByLabel('Check in').fill('09:00');
    await dlg.getByLabel('Check out').fill('17:30');
    await dlg.getByLabel(/Reason/).fill('Forgot to punch');
    await dlg.getByRole('button', { name: 'Submit request' }).click();
    await expect(employee.getByText('Forgot to punch')).toBeVisible();

    const mgrCtx = await browser.newContext();
    const mgr = await mgrCtx.newPage();
    await signIn(mgr, 'mgr');
    await mgr.goto('/attendance');
    await expect(mgr.getByRole('region', { name: 'Attendance overview' })).toHaveCount(0); // HR-only
    const picker = mgr.getByLabel('Employee');
    await expect(picker.locator('option', { hasText: 'Ravi Reddy' })).toHaveCount(1); // direct report
    await expect(picker.locator('option', { hasText: 'Pia Peer' })).toHaveCount(0); // not in the team
    const row = mgr.locator('tr', { hasText: 'Forgot to punch' });
    await row.getByRole('button', { name: 'Approve' }).click();
    await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(row.getByText('Approved')).toBeVisible();
    expect(sql(`select count(*)::int n from hr.attendance_records where "checkInAt" is not null`)[0]).toEqual({ n: 1 });
    await empCtx.close();
    await mgrCtx.close();
  });

  test('a request older than 7 days is refused by the API even if the browser is bypassed', async ({ page }) => {
    await signIn(page, 'team');
    const day = companyDate(-8);
    const res = await apiCall(page, 'POST', '/attendance/corrections', { date: day, proposedCheckInAt: `${day}T04:00:00.000Z`, proposedCheckOutAt: `${day}T12:00:00.000Z`, reason: 'late' });
    expect(res.status).toBe(400);
    expect(res.json.error.details.code).toBe('CORRECTION_WINDOW_EXPIRED');
    const ok = companyDate(-7);
    expect((await apiCall(page, 'POST', '/attendance/corrections', { date: ok, proposedCheckInAt: `${ok}T04:00:00.000Z`, proposedCheckOutAt: `${ok}T12:00:00.000Z`, reason: 'edge' })).status).toBe(201);
  });
});
