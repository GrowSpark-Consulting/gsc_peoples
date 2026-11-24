import { expect, test } from '@playwright/test';
import { PASSWORD, resetDb, signIn, sql, type Who } from './support';

test.use({ viewport: { width: 1280, height: 900 } });
test.beforeAll(() => resetDb());

test.describe('login and role-specific content', () => {
  test('anonymous visitors are sent to /login and see no page content', async ({ page }) => {
    await page.goto('/attendance');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('a wrong password is refused with an error and no session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('hr@e2e.local');
    await page.getByLabel('Role').selectOption({ label: 'HR Admin' });
    await page.getByLabel('Password', { exact: true }).fill(`${PASSWORD}-wrong`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form [role="alert"]')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  const dashboards: [Who, RegExp, RegExp | null][] = [
    ['hr', /Total employees/, /Team members/],
    ['sa', /Total employees/, /Team members/],
    ['mgr', /Team members/, /Total employees/],
    ['team', /Leave balances/, /Total employees|Team members/],
  ];
  for (const [who, shows, hides] of dashboards) {
    test(`${who} signs in and gets the dashboard for their role`, async ({ page }) => {
      await signIn(page, who);
      await expect(page.getByText(shows).first()).toBeVisible();
      if (hides) await expect(page.getByText(hides)).toHaveCount(0);
    });
  }

  test('role decides what the attendance page offers', async ({ page }) => {
    await signIn(page, 'team');
    await page.goto('/attendance');
    await expect(page.getByRole('region', { name: 'Attendance records' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Attendance overview' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Correct attendance' })).toHaveCount(0);
    await page.context().clearCookies();
    await signIn(page, 'hr');
    await page.goto('/attendance');
    await expect(page.getByRole('region', { name: 'Attendance overview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correct attendance' })).toBeVisible();
  });

  test('sign-out ends the session: protected pages redirect again', async ({ page }) => {
    await signIn(page, 'team');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/leave');
    await expect(page).toHaveURL(/\/login/);
    expect(sql(`select count(*)::int n from hr.user_sessions where "revokedAt" is not null`)[0]).toBeTruthy();
  });
});
