import { expect, test } from '@playwright/test';
import { API_ORIGIN, apiCall, empId, resetDb, signIn, sql, userId } from './support';

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeEach(() => resetDb());

test.describe('notifications (NOTIF-001)', () => {
  test('the bell shows the unread count, lists the items and marks them read', async ({ page }) => {
    // NOTE: nothing in the API creates notifications yet (NOTIF-002 gap), so the rows are inserted directly.
    const user = userId('team');
    const company = sql<{ id: string }>(`select "companyId" id from hr.company_memberships where "userId"='${user}'`)[0]!.id;
    for (const [i, title] of ['Leave approved', 'Correction rejected'].entries()) {
      sql(`insert into hr.notifications (id,"companyId","userId",type,title,message,"updatedAt") values (gen_random_uuid(),'${company}','${user}','TEST','${title}','m${i}',now()) returning id`);
    }
    await signIn(page, 'team');
    const bell = page.getByRole('button', { name: 'Notifications, 2 unread' });
    await expect(bell).toBeVisible();
    await bell.click();
    const panel = page.getByRole('dialog', { name: 'Notifications' }).or(page.locator('[aria-label="Notifications"]').last());
    await expect(panel.getByText('Leave approved')).toBeVisible();
    await expect(panel.getByText('Correction rejected')).toBeVisible();
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
    expect(sql(`select count(*)::int n from hr.notifications where "isRead"=false`)[0]).toEqual({ n: 0 });
  });

  test('a user never sees another user\'s notifications', async ({ page }) => {
    const other = userId('peer');
    const company = sql<{ id: string }>(`select "companyId" id from hr.company_memberships where "userId"='${other}'`)[0]!.id;
    sql(`insert into hr.notifications (id,"companyId","userId",type,title,"updatedAt") values (gen_random_uuid(),'${company}','${other}','TEST','Peer only',now()) returning id`);
    await signIn(page, 'team');
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible(); // 0 unread
    const list = await apiCall(page, 'GET', '/notifications');
    expect(JSON.stringify(list.json)).not.toContain('Peer only');
  });
});

test.describe('tenant isolation and unauthorized access', () => {
  test('HR of another company sees only their own people and gets 404/empty for company A data', async ({ page }) => {
    await signIn(page, 'hrb');
    await page.goto('/attendance');
    const overview = page.getByRole('region', { name: 'Attendance overview' });
    await expect(overview.getByText('Hugo Otherco')).toBeVisible();
    await expect(overview.getByText('Ravi Reddy')).toHaveCount(0);
    await expect(overview.getByText('Pia Peer')).toHaveCount(0);

    expect((await apiCall(page, 'GET', `/employees/${empId('team')}`)).status).toBe(404);
    const history = await apiCall(page, 'GET', `/attendance/history?employeeId=${empId('team')}`);
    expect(history.json?.data ?? []).toHaveLength(0);
    const manual = await apiCall(page, 'POST', '/attendance/manual-corrections', { employeeId: empId('team'), date: '2026-01-02', checkInAt: '2026-01-02T04:00:00.000Z', reason: 'x' });
    expect(manual.status).toBe(404);
    expect(sql(`select count(*)::int n from hr.attendance_records`)[0]).toEqual({ n: 0 });
    const leave = await apiCall(page, 'GET', '/leave/requests');
    expect(leave.json.data).toHaveLength(0);
  });

  test('another company\'s document cannot be listed, downloaded or deleted', async ({ browser }) => {
    const aCtx = await browser.newContext();
    const a = await aCtx.newPage();
    await signIn(a, 'team');
    await a.goto('/documents');
    await a.getByRole('button', { name: 'Upload document' }).click();
    await a.getByRole('dialog').getByLabel('File').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a') });
    await a.getByRole('dialog').getByRole('button', { name: 'Upload' }).click();
    await expect(a.locator('tr', { hasText: 'a.pdf' })).toBeVisible();
    const id = sql<{ id: string }>(`select id from hr.employee_documents`)[0]!.id;

    const bCtx = await browser.newContext();
    const b = await bCtx.newPage();
    await signIn(b, 'hrb');
    expect((await apiCall(b, 'GET', `/documents/${id}/download`)).status).toBe(404);
    expect((await apiCall(b, 'DELETE', `/documents/${id}`)).status).toBe(404);
    expect((await apiCall(b, 'GET', '/documents')).json.data).toHaveLength(0);
    expect(sql(`select "deletedAt" from hr.employee_documents where id='${id}'`)[0]).toEqual({ deletedAt: null });
    await aCtx.close();
    await bCtx.close();
  });

  test('an Employee is refused every HR-only endpoint (403) and a Manager too', async ({ browser }) => {
    for (const who of ['team', 'mgr'] as const) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await signIn(page, who);
      for (const [method, url] of [
        ['GET', '/attendance/overview?date=2026-01-02'],
        ['POST', '/attendance/manual-corrections'],
        ['GET', '/settings/audit-logs'],
        ['POST', '/documents/company'],
      ] as const) {
        const res = await apiCall(page, method, url, method === 'POST' ? {} : undefined);
        expect([401, 403, 415], `${who} ${method} ${url}`).toContain(res.status);
        expect(res.status, `${who} ${method} ${url}`).not.toBe(200);
      }
      await ctx.close();
    }
  });

  test('unauthenticated API calls and tampered CSRF are refused', async ({ page, request }) => {
    expect((await request.get(`${API_ORIGIN}/api/v1/attendance/today`)).status()).toBe(401);
    await signIn(page, 'team');
    const noCsrf = await page.request.post(`${API_ORIGIN}/api/v1/attendance/check-in`);
    expect(noCsrf.status()).toBe(403);
    expect(sql(`select count(*)::int n from hr.attendance_records`)[0]).toEqual({ n: 0 });
  });
});
