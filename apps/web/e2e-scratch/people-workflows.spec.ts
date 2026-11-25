import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { apiCall, clearMail, companyDate, emailedLink, empId, PASSWORD, resetDb, signIn, sql } from './support';

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeEach(async () => {
  resetDb();
  await clearMail();
});

const NEW_PASSWORD = 'Joiner-Pass-2026!';

test.describe('departments, designations, hiring, invitation and onboarding (ORG-002, EMP-001, AUTH-004, ONB)', () => {
  test('HR sets up the organisation, hires someone, invites them; they activate by email and complete a task', async ({ browser }) => {
    test.setTimeout(180_000);
    const hrCtx = await browser.newContext();
    const hr = await hrCtx.newPage();
    await signIn(hr, 'hr');

    await hr.goto('/departments');
    await hr.getByRole('button', { name: 'Add department' }).click();
    await hr.getByRole('dialog').getByLabel(/^Name/).fill('Finance');
    await hr.getByRole('dialog').getByRole('button', { name: 'Add department' }).click();
    await expect(hr.getByRole('dialog')).toBeHidden();
    await hr.getByRole('tab', { name: 'Designations' }).click();
    await hr.getByRole('button', { name: 'Add designation' }).click();
    await hr.getByRole('dialog').getByLabel(/^Name/).fill('Accountant');
    await hr.getByRole('dialog').getByRole('button', { name: 'Add designation' }).click();
    await expect(hr.getByRole('dialog')).toBeHidden();

    await hr.goto('/employees/new');
    await hr.getByLabel(/^First name/).fill('Nina');
    await hr.getByLabel(/^Last name/).fill('Joiner');
    await hr.getByLabel(/^Work email/).fill('nina@e2e.local');
    await hr.getByLabel(/^Hire date/).fill(companyDate(0));
    await hr.getByLabel(/^Department/).selectOption({ label: 'Finance' });
    await hr.getByLabel(/^Designation/).selectOption({ label: 'Accountant' });
    await hr.getByRole('button', { name: 'Create employee' }).click();
    await expect(hr).toHaveURL(/\/employees\/[0-9a-f-]{36}/);
    const [nina] = sql<{ id: string; employeeNumber: string; status: string }>(`select id,"employeeNumber",status from hr.employees where "workEmail"='nina@e2e.local'`);
    expect(nina).toMatchObject({ status: 'ONBOARDING' });
    expect(nina!.employeeNumber).toMatch(/^EMP-\d{4}$/);

    await hr.goto(`/employees/${nina!.id}`);
    await hr.getByRole('button', { name: 'Send invitation' }).click();
    await expect(hr.getByRole('region', { name: 'Login access' }).getByText(/An invitation has been sent\./)).toBeVisible();
    const link = await emailedLink('nina@e2e.local');
    expect(link).toContain('/accept-invitation?token=');

    const joinerCtx = await browser.newContext();
    const joiner = await joinerCtx.newPage();
    await joiner.goto(link);
    await joiner.getByLabel('Password').fill(NEW_PASSWORD);
    await joiner.getByRole('button', { name: 'Activate account' }).click();
    await expect(joiner).toHaveURL(/\/dashboard$/, { timeout: 45_000 });

    await joiner.goto('/onboarding');
    const task = joiner.locator('tr', { hasText: 'Upload your ID proof' });
    await task.getByRole('button', { name: 'Mark done' }).click();
    await expect(task.getByText('Done')).toBeVisible();

    // the link cannot be used a second time
    const replayCtx = await browser.newContext();
    const replay = await replayCtx.newPage();
    await replay.goto(link);
    await replay.getByLabel('Password').fill('Another-Pass-2026!');
    await replay.getByRole('button', { name: 'Activate account' }).click();
    await expect(replay.locator('form [role="alert"]')).toContainText(/invalid|expired|already used/i);

    await hr.goto('/onboarding');
    const row = hr.locator('tr', { hasText: 'Nina Joiner' });
    await expect(row.getByText('Completed')).toBeVisible();
    await expect(row.getByText('Activated')).toBeVisible();
    await hr.getByRole('button', { name: /^Notifications/ }).click();
    await expect(hr.getByText(/Onboarding completed for Nina Joiner/)).toBeVisible();
    await hrCtx.close();
    await joinerCtx.close();
    await replayCtx.close();
  });
});

test.describe('password reset by email (AUTH-002)', () => {
  test('requests a link, sets a new password once, and signs in with it', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('team@e2e.local');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('If the account exists');
    const link = await emailedLink('team@e2e.local');
    await page.goto(link);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill('team@e2e.local');
    await page.getByLabel('Role').selectOption({ label: 'Employee' });
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form [role="alert"]')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 45_000 });
  });
});

test.describe('profile privacy, self-edit and timeline (EMP-004, EMP-008, EMP-009)', () => {
  test('an employee edits own contact details; HR sees them in the timeline; the manager never sees the address', async ({ browser }) => {
    const empCtx = await browser.newContext();
    const employee = await empCtx.newPage();
    await signIn(employee, 'team');
    await employee.goto('/profile');
    await employee.getByLabel('Phone').fill('+91 98765 00000');
    await employee.getByLabel('Address').fill('12 Hidden Lane');
    await employee.getByRole('button', { name: 'Save contact details' }).click();
    await expect(employee.getByText('Contact details saved.')).toBeVisible();

    const hrCtx = await browser.newContext();
    const hr = await hrCtx.newPage();
    await signIn(hr, 'hr');
    await hr.goto(`/employees/${empId('team')}`);
    await expect(hr.getByRole('region', { name: 'Activity' }).getByText(/Address: — → 12 Hidden Lane/)).toBeVisible();

    const mgrCtx = await browser.newContext();
    const mgr = await mgrCtx.newPage();
    await signIn(mgr, 'mgr');
    await mgr.goto(`/employees/${empId('team')}`);
    await expect(mgr.getByText('+91 98765 00000').first()).toBeVisible();
    await expect(mgr.getByText('12 Hidden Lane')).toHaveCount(0);
    expect(JSON.stringify((await apiCall(mgr, 'GET', `/employees/${empId('team')}/timeline`)).json)).not.toContain('Hidden Lane');
    await empCtx.close();
    await hrCtx.close();
    await mgrCtx.close();
  });
});

test.describe('offboarding (EMP-007, W10)', () => {
  test('HR makes an employee inactive: their session ends and they cannot sign in', async ({ browser }) => {
    const empCtx = await browser.newContext();
    const employee = await empCtx.newPage();
    await signIn(employee, 'team');

    const hrCtx = await browser.newContext();
    const hr = await hrCtx.newPage();
    await signIn(hr, 'hr');
    await hr.goto(`/employees/${empId('team')}`);
    const form = hr.getByRole('form', { name: 'Change employment status' });
    await form.getByLabel('Status').selectOption('INACTIVE');
    await form.getByLabel(/^Exit date/).fill(companyDate(0));
    await form.getByRole('button', { name: 'Update status' }).click();
    await expect.poll(() => sql<{ status: string }>(`select status from hr.employees where id='${empId('team')}'`)[0]!.status).toBe('INACTIVE');

    await employee.goto('/leave');
    await expect(employee).toHaveURL(/\/login/);
    await employee.getByLabel('Email').fill('team@e2e.local');
    await employee.getByLabel('Role').selectOption({ label: 'Employee' });
    await employee.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await employee.getByRole('button', { name: 'Sign in' }).click();
    await expect(employee.locator('form [role="alert"]')).toBeVisible();
    await empCtx.close();
    await hrCtx.close();
  });
});

test.describe('audit log, settings access, reports and calendar (SET-004, ATT-008, LEAVE-008)', () => {
  test('the Super Admin filters the audit log; HR has no audit log; others have no settings or reports', async ({ browser }) => {
    const hrCtx = await browser.newContext();
    const hr = await hrCtx.newPage();
    await signIn(hr, 'hr');
    await apiCall(hr, 'POST', '/organization/departments', { name: 'Audited Department' });
    await hr.goto('/settings');
    await expect(hr.getByRole('region', { name: 'Audit log' })).toHaveCount(0);
    await expect(hr.getByText('Only a Super Admin can change company settings.')).toBeVisible();
    await expect(hr.getByRole('button', { name: 'Save settings' })).toHaveCount(0);

    const saCtx = await browser.newContext();
    const sa = await saCtx.newPage();
    await signIn(sa, 'sa');
    await sa.goto('/settings');
    const audit = sa.getByRole('region', { name: 'Audit log' });
    await audit.getByLabel('Record type').selectOption('Department');
    await expect(audit.locator('tr', { hasText: 'department.created' })).toBeVisible();
    await audit.getByLabel('From').fill(companyDate(1));
    await expect(audit.getByText('Nothing matches these filters.')).toBeVisible();

    const empCtx = await browser.newContext();
    const employee = await empCtx.newPage();
    await signIn(employee, 'team');
    for (const path of ['/settings', '/reports']) {
      await employee.goto(path);
      await expect(employee.locator('main').getByText('No access')).toBeVisible();
    }
    expect((await apiCall(employee, 'GET', '/settings/audit-logs')).status).toBe(403);
    await hrCtx.close();
    await saCtx.close();
    await empCtx.close();
  });

  test('HR downloads the attendance report as CSV', async ({ page }) => {
    await signIn(page, 'hr');
    await page.goto('/reports');
    await expect(page.getByRole('region', { name: 'Attendance report' }).getByText('Ravi Reddy')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^attendance-\d{4}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv).toContain('Employee ID,Name');
    expect(csv).toContain('Ravi Reddy');
    expect(csv).not.toContain('Hugo');
  });

  test('the leave calendar shows a pending half day on its date', async ({ page }) => {
    await signIn(page, 'team');
    const day = companyDate(0);
    const type = sql<{ id: string }>(`select id from hr.leave_types limit 1`)[0]!.id;
    expect((await apiCall(page, 'POST', '/leave/requests', { leaveTypeId: type, startDate: day, endDate: day, dayType: 'HALF_DAY', halfDaySession: 'FIRST_HALF', reason: 'Half' })).status).toBe(201);
    await page.goto('/leave');
    const calendar = page.getByRole('region', { name: 'Leave calendar' });
    await expect(calendar.getByText(/Casual Leave · ½ first half · pending/).filter({ visible: true })).toBeVisible();
  });
});
