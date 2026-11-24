import { expect, test, type Page } from '@playwright/test';

/** Verifies the shared feature-page patterns on /showcase/patterns (sample content only). */

const URL = '/showcase/patterns';
const WIDTHS = [1440, 1280, 1024, 820, 390] as const;

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const bodyRows = (page: Page) => page.getByRole('region', { name: 'Sample items' }).locator('tbody tr');

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

for (const width of WIDTHS) {
  test.describe(`patterns @ ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('layout, toolbar order, no overflow, no console errors', async ({ page }) => {
      const problems = trackProblems(page);
      await page.goto(URL);
      await expect(page.getByRole('heading', { level: 1, name: 'Feature page patterns' })).toBeVisible();
      expect(await overflow(page)).toBe(false);

      // Toolbar order: search, filter, secondary action, primary action
      const order = await page
        .getByRole('search', { name: 'Sample filters' })
        .locator('input, select, button')
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute('aria-label') ?? (e as HTMLInputElement).labels?.[0]?.textContent ?? e.textContent?.trim()),
        );
      expect(order).toEqual(['Search sample items', 'Status', 'Export', 'Add item']);
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]')).toHaveText('Sample list');
      expect(problems).toEqual([]);
    });

    test('every form control has an accessible name', async ({ page }) => {
      await page.goto(URL);
      await page.getByRole('button', { name: 'Add item' }).first().click();
      const unnamed = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input, select, textarea'))
          .filter((el) => {
            const e = el as HTMLInputElement;
            return !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.labels && e.labels.length > 0));
          })
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      expect(unnamed).toEqual([]);
    });
  });
}

test.describe('list behaviour', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('search, filter, no-results and clear', async ({ page }) => {
    await page.goto(URL);
    await expect(bodyRows(page)).toHaveCount(3);
    await page.getByLabel('Search sample items').fill('item 5');
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();

    await page.getByLabel('Search sample items').fill('zzz');
    await expect(page.getByText('No items match')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(bodyRows(page)).toHaveCount(3);

    await page.getByLabel('Status').selectOption('Done');
    await expect(bodyRows(page)).toHaveCount(2);
  });

  test('cursor pagination: Previous disabled first, Next disabled last, rows differ per page', async ({ page }) => {
    await page.goto(URL);
    const nav = page.getByRole('navigation', { name: 'Pagination' });
    const prev = nav.getByRole('button', { name: /Previous/ });
    const next = nav.getByRole('button', { name: /Next/ });
    await expect(prev).toBeDisabled();
    const first = await bodyRows(page).first().innerText();
    await next.click();
    await expect(nav).toContainText('Page 2');
    expect(await bodyRows(page).first().innerText()).not.toBe(first);
    await next.click();
    await expect(nav).toContainText('Page 3');
    await expect(next).toBeDisabled();
    await expect(bodyRows(page)).toHaveCount(1);
    await prev.click();
    await expect(nav).toContainText('Page 2');
  });

  test('loading, error (with retry), empty and access-denied states', async ({ page }) => {
    await page.goto(URL);
    const states = page.getByRole('group', { name: 'List state' });
    await states.getByRole('button', { name: 'Loading' }).click();
    await expect(bodyRows(page)).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Sample items' }).locator('tbody tr[aria-hidden="true"]')).toHaveCount(3);

    await states.getByRole('button', { name: 'Error' }).click();
    // scope to <main>: Next's route announcer also has role="alert"
    await expect(page.locator('main').getByRole('alert')).toContainText('The server could not be reached.');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(bodyRows(page)).toHaveCount(3);

    await states.getByRole('button', { name: 'Empty' }).click();
    await expect(page.getByText('Nothing here yet')).toBeVisible();

    await states.getByRole('button', { name: 'Denied' }).click();
    await expect(page.getByText('No access')).toBeVisible();
  });

  test('keyboard: toolbar controls are reachable in order and operable', async ({ page }) => {
    await page.goto(URL);
    await page.getByLabel('Search sample items').focus();
    await page.keyboard.type('sample');
    await page.keyboard.press('Tab'); // clear button
    await page.keyboard.press('Tab'); // status select
    await expect(page.getByLabel('Status')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Export' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add item' }).first()).toBeFocused();
  });
});

for (const width of [1280, 390] as const) {
  test.describe(`drawer & dialog @ ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('drawer: labelled modal, width, focus trap, Escape, scroll lock, focus return', async ({ page }) => {
      const problems = trackProblems(page);
      await page.goto(URL);
      const opener = page.getByRole('button', { name: 'Add item' }).first();
      await opener.focus();
      await page.keyboard.press('Enter');

      const drawer = page.getByRole('dialog', { name: 'Add sample item' });
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute('aria-modal', 'true');
      const w = await drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width));
      expect(w).toBe(width >= 640 ? 520 : width); // design system: 480-640px; full width on phones
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Shift+Tab');
        expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }

      // field error is exposed to assistive tech
      const ref = drawer.getByLabel('Reference');
      await expect(ref).toHaveAttribute('aria-invalid', 'true');
      await expect(drawer.getByRole('alert').filter({ hasText: 'Enter a reference' })).toBeVisible();

      // submitting shows the loading state, then a form-level error
      await drawer.getByRole('button', { name: 'Save item' }).click();
      await expect(drawer.getByRole('button', { name: 'Saving...' })).toBeDisabled();
      await expect(drawer.getByRole('alert').filter({ hasText: 'Could not save.' })).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      expect(problems).toEqual([]);
    });

    test('drawer closes from the backdrop and the Close button', async ({ page }) => {
      await page.goto(URL);
      const drawer = page.getByRole('dialog', { name: 'Add sample item' });
      await page.getByRole('button', { name: 'Add item' }).first().click();
      await expect(drawer).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(drawer).toBeHidden();
      if (width >= 640) {
        await page.getByRole('button', { name: 'Add item' }).first().click();
        await page.mouse.click(10, 400);
        await expect(drawer).toBeHidden();
      }
    });

    test('dialog opens from a row, traps focus, closes with Escape and returns focus', async ({ page }) => {
      await page.goto(URL);
      const trigger = page.getByRole('button', { name: 'Sample item 1' });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Change status' });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });
}

test('dark theme keeps patterns readable (no overflow, drawer renders)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gs-theme', 'dark'));
  await page.goto(URL);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.getByRole('button', { name: 'Add item' }).first().click();
  const bg = await page.getByRole('dialog', { name: 'Add sample item' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(34, 32, 29)'); // --surface (dark) #22201d
  expect(await overflow(page)).toBe(false);
});
