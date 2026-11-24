import { expect, test, type Page } from '@playwright/test';

const NAV = [
  ['Dashboard', '/dashboard'],
  ['Employees', '/employees'],
  ['Departments', '/departments'],
  ['Attendance', '/attendance'],
  ['Leave', '/leave'],
  ['Onboarding', '/onboarding'],
  ['Documents', '/documents'],
  ['Reports', '/reports'],
  ['Settings', '/settings'],
] as const;

const WIDTHS = [1440, 1280, 1024, 820, 390] as const;

function trackProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return problems;
}

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const sidebarWidth = (page: Page) =>
  page.locator('aside').first().evaluate((el) => Math.round(el.getBoundingClientRect().width));

for (const width of WIDTHS) {
  const mode = width >= 1280 ? 'desktop' : width >= 1024 ? 'tablet' : 'mobile';

  test.describe(`shell @ ${width}px (${mode})`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('layout, active navigation, no overflow, no console errors', async ({ page }) => {
      const problems = trackProblems(page);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);

      if (mode === 'mobile') {
        await expect(page.locator('aside')).toBeHidden(); // in-flow sidebar is display:none, overlay closed
        await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
      } else {
        // Poll: the server render assumes desktop, so tablet settles at 64px once hydrated.
        await expect.poll(() => sidebarWidth(page)).toBe(mode === 'desktop' ? 240 : 64);
        await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeHidden();
        const nav = page.getByRole('navigation', { name: 'Primary' });
        await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
        await expect(nav.getByRole('link')).toHaveCount(NAV.length);
        // navigate and confirm active state + title follow the route
        await nav.getByRole('link', { name: 'Employees' }).click();
        // Generous timeout: the first visit to a route in `next dev` includes its on-demand compile.
        await expect(page).toHaveURL(/\/employees$/, { timeout: 30_000 });
        await expect(page.getByRole('heading', { level: 1, name: 'Employees' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Employees' })).toHaveAttribute('aria-current', 'page');
        await expect(nav.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current', 'page');
      }

      // main content: max 1440px, consistent padding
      const main = await page.locator('main').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { w: el.getBoundingClientRect().width, pl: cs.paddingLeft, pt: cs.paddingTop };
      });
      expect(main.w).toBeLessThanOrEqual(1440);
      expect(main.pl).toBe(mode === 'mobile' ? (width >= 640 ? '24px' : '16px') : '24px');
      if (mode !== 'mobile') expect(main.pt).toBe('24px');

      expect(problems).toEqual([]);
    });

    test('top bar placeholders are marked and keyboard operable', async ({ page }) => {
      await page.goto('/dashboard');
      // The "User menu" placeholder was replaced by a real Sign out button (commit 13ff401). It is
      // keyboard-reachable but not clicked here: it ends the session and navigates to /login.
      const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
      await signOut.focus();
      await expect(signOut).toBeFocused();
      for (const label of ['Company switcher', 'Notifications']) {
        const trigger = page.getByRole('button', { name: label, exact: true });
        await trigger.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: label, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Placeholder', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
      if (width >= 640) {
        await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
      } else {
        await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeHidden();
      }
      expect(await noHorizontalOverflow(page)).toBe(true);
    });

    if (mode === 'mobile') {
      test('overlay: open, focus trap, Escape, backdrop, scroll lock, link navigation', async ({ page }) => {
        const problems = trackProblems(page);
        await page.goto('/dashboard');
        const opener = page.getByRole('button', { name: 'Open navigation menu' });
        const dialog = page.getByRole('dialog', { name: 'Navigation menu' });

        await expect(opener).toHaveAttribute('aria-expanded', 'false');
        await opener.click();
        await expect(dialog).toBeVisible();
        await expect(opener).toHaveAttribute('aria-expanded', 'true');
        expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        await expect(dialog.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
        await expect(dialog.getByRole('link')).toHaveCount(NAV.length);
        await expect(dialog.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
        expect(await dialog.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(240);

        // Focus stays inside while tabbing forwards and backwards
        for (let i = 0; i < NAV.length + 8; i++) {
          await page.keyboard.press('Tab');
          expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        }
        for (let i = 0; i < NAV.length + 8; i++) {
          await page.keyboard.press('Shift+Tab');
          expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        }

        // Escape closes, restores focus and scroll
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        await expect(opener).toHaveAttribute('aria-expanded', 'false');
        expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

        // Backdrop closes
        await opener.click();
        await expect(dialog).toBeVisible();
        await page.mouse.click(width - 8, 400);
        await expect(dialog).toBeHidden();
        expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

        // Navigating via a link closes the menu and updates the page
        await opener.click();
        await dialog.getByRole('link', { name: 'Leave' }).click();
        await expect(page).toHaveURL(/\/leave$/);
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('heading', { level: 1, name: 'Leave' })).toBeVisible();
        expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

        // Re-open: active item follows the route
        await opener.click();
        await expect(dialog.getByRole('link', { name: 'Leave' })).toHaveAttribute('aria-current', 'page');

        // Growing to desktop width closes the overlay and shows the sidebar
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(dialog).toBeHidden();
        expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
        expect(await sidebarWidth(page)).toBe(240);

        expect(problems).toEqual([]);
      });

      test('every route title fits in the top bar', async ({ page }) => {
        for (const [label, href] of NAV) {
          await page.goto(href);
          const h1 = page.getByRole('heading', { level: 1, name: label });
          await expect(h1).toBeVisible();
          const clipped = await h1.evaluate((el) => el.scrollWidth > el.clientWidth);
          expect(clipped, `${label} title clipped at ${width}px`).toBe(false);
          expect(await noHorizontalOverflow(page)).toBe(true);
        }
      });
    } else {
      test('every route is reachable and marks its nav item active', async ({ page }) => {
        const nav = page.getByRole('navigation', { name: 'Primary' });
        for (const [label, href] of NAV) {
          await page.goto(href);
          await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
          await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
          expect(await noHorizontalOverflow(page)).toBe(true);
        }
      });

      test('keyboard: skip link first, then navigation links', async ({ page }) => {
        await page.goto('/dashboard');
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link').first()).toBeFocused();
        await page.keyboard.press('Enter'); // activate Dashboard link: stays on route
        await expect(page).toHaveURL(/\/dashboard$/);
      });
    }

    if (mode === 'desktop') {
      test('desktop sidebar collapses to 64px and expands back via keyboard', async ({ page }) => {
        await page.goto('/dashboard');
        const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => sidebarWidth(page)).toBe(64);
        await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
        // labels remain available to assistive tech via accessible names
        await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Employees' })).toBeVisible();
        await page.getByRole('button', { name: 'Expand sidebar' }).click();
        await expect.poll(() => sidebarWidth(page)).toBe(240);
        expect(await noHorizontalOverflow(page)).toBe(true);
      });
    }

    if (mode === 'desktop') {
      test('sidebar preference persists across reloads (localStorage)', async ({ page }) => {
        await page.goto('/dashboard');
        await page.getByRole('button', { name: 'Collapse sidebar' }).click();
        await expect.poll(() => sidebarWidth(page)).toBe(64);
        expect(await page.evaluate(() => localStorage.getItem('gs-sidebar-collapsed'))).toBe('1');

        await page.reload();
        await expect.poll(() => sidebarWidth(page)).toBe(64);
        await page.goto('/employees');
        await expect.poll(() => sidebarWidth(page)).toBe(64);

        await page.getByRole('button', { name: 'Expand sidebar' }).click();
        await expect.poll(() => sidebarWidth(page)).toBe(240);
        await page.reload();
        await expect.poll(() => sidebarWidth(page)).toBe(240);
      });

      test('group headings are preserved', async ({ page }) => {
        await page.goto('/dashboard');
        await expect(page.getByRole('heading', { level: 2, name: 'Insights' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Workspace' })).toBeVisible();
      });
    }

    if (mode === 'tablet') {
      test('tablet sidebar is auto-collapsed with no manual toggle', async ({ page }) => {
        await page.goto('/dashboard');
        await expect.poll(() => sidebarWidth(page)).toBe(64);
        await expect(page.getByRole('button', { name: /sidebar/i })).toHaveCount(0);
      });
    }
  });
}

test.describe('shell @ 1920px', () => {
  test.use({ viewport: { width: 1920, height: 900 } });
  test('main content is capped at 1440px and centred', async ({ page }) => {
    await page.goto('/dashboard');
    const w = await page.locator('main').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(w).toBe(1440);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});

test('/showcase is preserved and still renders without console errors', async ({ page }) => {
  const problems = trackProblems(page);
  await page.goto('/showcase');
  await expect(page.getByRole('heading', { level: 1, name: 'Component showcase' })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(problems).toEqual([]);
});
