import { expect, test, type Page } from '@playwright/test';
import { buildDemoRows, demoUuid, type DemoRow } from '../src/modules/employees/adapters/demo/demo-data';

/**
 * Employee Directory browser checks. They run against `next dev` in DEMO mode (the default): fictional
 * in-memory data, no API, no database. Demo data resets on every full page load, so each test starts
 * from the same 36 people (GS-0001..GS-0036): 25 on page 1, 11 on page 2.
 *
 * Personas ("Demo: view as"): HR Admin = Meera Nair, Manager = Kavya Menon (6 direct reports),
 * Employee = Rohan Iyer (reports to Kavya).
 *
 * The HTTP-mode checks only run when E2E_HTTP_BASE_URL points at a server started with
 * NEXT_PUBLIC_EMPLOYEES_ADAPTER=http.
 */

const WIDTHS = [1440, 1280, 1024, 820, 390] as const;

/** Expected values are derived from the very data the demo adapter serves, never hard-coded. */
const ROWS = buildDemoRows();
const PAGE_SIZE = 25;
const fullName = (r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`;
const byOrder = (a: DemoRow, b: DemoRow) =>
  a.lastName < b.lastName ? -1 : a.lastName > b.lastName ? 1 : a.firstName < b.firstName ? -1 : a.firstName > b.firstName ? 1 : a.id < b.id ? -1 : 1;
const SORTED = [...ROWS].sort(byOrder);
const ids = (rs: DemoRow[]) => rs.map((r) => r.id);
const MANAGER_ID = demoUuid(3); // Kavya Menon
const TEAM = ROWS.filter((r) => r.managerId === MANAGER_ID || r.id === MANAGER_ID);
const NEHA_REPORTS = ROWS.filter((r) => r.managerId === demoUuid(13)).length;

// ---------- helpers ----------

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

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Rows in whichever presentation is visible (table from 768px, cards below). */
const rows = (page: Page) => {
  const width = page.viewportSize()!.width;
  return width >= 768
    ? page.getByTestId('employee-table').locator('tbody tr')
    : page.getByTestId('employee-cards').locator('li');
};

const resultsLoaded = (page: Page) =>
  expect(page.getByText(/^\d+ employees? on this page$/)).toBeAttached();

async function openDirectory(page: Page, persona?: 'hr' | 'manager' | 'employee', url = '/employees') {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Employees' })).toBeVisible();
  if (persona && persona !== 'hr') await page.getByLabel('Demo: view as').selectOption(persona);
  await resultsLoaded(page);
}

/** Names shown in the visible rows (first line of the Employee cell). */
async function names(page: Page): Promise<string[]> {
  const links = page.getByTestId(page.viewportSize()!.width >= 768 ? 'employee-table' : 'employee-cards').locator('a[href^="/employees/"]');
  return (await links.allInnerTexts()).map((t) => t.trim());
}

/** Profile ids shown in the visible rows, in order. Unique, unlike names (the demo data has namesakes). */
async function shownIds(page: Page): Promise<string[]> {
  const links = page.getByTestId(page.viewportSize()!.width >= 768 ? 'employee-table' : 'employee-cards').locator('a[href^="/employees/"]');
  return (await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')!.split('/').pop()!)));
}

/** Client-side navigation (keeps in-memory demo state and the chosen persona). */
async function clientNavigate(page: Page, path: string) {
  const ok = await page.evaluate((p) => {
    const router = (window as unknown as { next?: { router?: { push: (u: string) => void } } }).next?.router;
    if (!router) return false;
    router.push(p);
    return true;
  }, path);
  expect(ok, 'window.next.router must be available in next dev').toBe(true);
}

/** Opens a multi-select filter ("Status", "Employment type") and toggles the given options. */
async function toggleFilter(page: Page, filter: string, ...labels: string[]) {
  const button = page.getByRole('button', { name: filter, exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  for (const label of labels) await page.getByRole('checkbox', { name: label, exact: true }).click();
}
const filterButton = (page: Page, filter: string) => page.getByRole('button', { name: filter, exact: true });

const drawerOf = (page: Page) => page.getByRole('dialog', { name: 'Employee profile' });

// ---------- layout at every width ----------

for (const width of WIDTHS) {
  test.describe(`directory @ ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('loads page 1 of 2 (25 rows), demo banner, no overflow, no console errors', async ({ page }) => {
      const problems = trackProblems(page);
      await openDirectory(page);
      await expect(page.getByText('Demo mode.')).toBeVisible();
      await expect(rows(page)).toHaveCount(PAGE_SIZE);
      await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText(`Page 1 · ${PAGE_SIZE} employees`);
      await expect(page.getByRole('link', { name: 'Add employee' })).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      expect(problems).toEqual([]);
    });

    test('cursor pagination: page 2 has the remaining 11, no repeats, focus moves to results', async ({ page }) => {
      const rest = ROWS.length - PAGE_SIZE;
      await openDirectory(page);
      const first = await shownIds(page);
      const nav = page.getByRole('navigation', { name: 'Pagination' });
      await expect(nav.getByRole('button', { name: /Previous/ })).toBeDisabled();

      await nav.getByRole('button', { name: /Next/ }).click();
      await expect(nav).toContainText(`Page 2 · ${rest} employees`);
      await expect(page.getByRole('heading', { name: 'Employee results, page 2' })).toBeFocused();
      await expect(nav.getByRole('button', { name: /Next/ })).toBeDisabled();
      const second = await shownIds(page);
      expect(second).toHaveLength(rest);
      // every person exactly once across the two pages (namesakes included)
      expect(new Set([...first, ...second]).size).toBe(ROWS.length);

      await nav.getByRole('button', { name: /Previous/ }).click();
      await expect(nav).toContainText(`Page 1 · ${PAGE_SIZE} employees`);
      expect(await shownIds(page)).toEqual(first);
      expect(await noOverflow(page)).toBe(true);
    });
  });
}

test.describe('stable ordering', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('rows are ordered by last name, first name, then id, across both pages (namesakes stay stable)', async ({ page }) => {
    await openDirectory(page);
    const all = [...(await shownIds(page))];
    await page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: /Next/ }).click();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('Page 2');
    all.push(...(await shownIds(page)));
    expect(all).toEqual(ids(SORTED));
    // the demo data really does contain two people with the same full name
    const dupes = ROWS.filter((r, i) => ROWS.findIndex((o) => fullName(o) === fullName(r)) !== i);
    expect(dupes.length).toBeGreaterThan(0);
  });
});

// ---------- permissions ----------

test.describe('permissions by persona', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('HR Admin: sees everyone, org filters, Add, Edit and status controls', async ({ page }) => {
    await openDirectory(page, 'hr');
    await expect(page.getByRole('region', { name: 'Employee directory' }).getByText('All employees', { exact: true }).first()).toBeVisible();
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    await expect(page.getByLabel('Department')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Manager' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add employee' })).toBeVisible();

    await page.getByRole('link', { name: 'Meera Nair' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Meera Nair' })).toBeVisible();
    await expect(page.getByText('You', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Change employment status' })).toBeVisible();
  });

  test('Manager: direct reports and self only, read-only, no org filters', async ({ page }) => {
    const problems = trackProblems(page);
    await openDirectory(page, 'manager');
    await expect(page.getByText('Your direct reports and your own profile')).toBeVisible();
    await expect(rows(page)).toHaveCount(TEAM.length); // direct reports + self, nothing deeper
    expect(TEAM.length).toBeGreaterThan(2);
    expect([...(await shownIds(page))].sort()).toEqual(ids(TEAM).sort());
    const shown = await names(page);
    expect(shown).toContain('Kavya Menon');
    expect(shown).toContain('Rohan Iyer');
    expect(shown).not.toContain('Arjun Rao'); // her manager
    expect(shown).not.toContain('Sanjay Kumar'); // another team

    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByLabel('Employment type')).toBeVisible();
    await expect(page.getByLabel('Department')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Manager' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Rohan Iyer' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Rohan Iyer' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Change employment status' })).toHaveCount(0);

    // Typing the edit/new URLs is refused by the UI (and the API enforces it independently).
    await clientNavigate(page, '/employees/new');
    await expect(page.getByText('Only HR Admins can add employees.')).toBeVisible();
    await clientNavigate(page, `/employees/${demoUuid(4)}/edit`);
    await expect(page.getByText('Only HR Admins can edit employees.')).toBeVisible();
    // Someone outside the team looks exactly like a record that does not exist.
    await clientNavigate(page, `/employees/${demoUuid(14)}`);
    await expect(page.getByText('Employee not found')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('Employee: own profile only, read-only', async ({ page }) => {
    const problems = trackProblems(page);
    await openDirectory(page, 'employee');
    await expect(page.getByText('Your own profile')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    expect(await names(page)).toEqual(['Rohan Iyer']);
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Rohan Iyer' }).click();
    await expect(page.getByRole('article', { name: 'Profile of Rohan Iyer' })).toBeVisible();
    await expect(page.getByText('You', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Change employment status' })).toHaveCount(0);

    await clientNavigate(page, `/employees/${demoUuid(1)}`);
    await expect(page.getByText('Employee not found')).toBeVisible();
    await clientNavigate(page, '/employees/new');
    await expect(page.getByText('Only HR Admins can add employees.')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('switching persona reloads the list under the new permissions', async ({ page }) => {
    await openDirectory(page, 'hr');
    await expect(rows(page)).toHaveCount(25);
    await page.getByLabel('Demo: view as').selectOption('employee');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Add employee' })).toHaveCount(0);
    await page.getByLabel('Demo: view as').selectOption('hr');
    await expect(rows(page)).toHaveCount(25);
  });
});

// ---------- search, filters, URL, pagination reset ----------

test.describe('search and filters', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('search by name, employee number and work email; URL follows after the debounce', async ({ page }) => {
    await openDirectory(page);
    const search = page.getByRole('searchbox', { name: 'Search employees' });

    await search.fill('kavya');
    await expect.poll(() => names(page)).toEqual(['Kavya Menon']);
    await expect(page).toHaveURL(/[?&]q=kavya/);

    await search.fill('GS-0013');
    await expect.poll(() => names(page)).toEqual(['Neha Gupta']); // poll: the old single row can still be on screen

    await search.fill('');
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);

    const email = (await page.getByTestId('employee-table').locator('tbody tr').first().locator('td').nth(1).innerText()).trim();
    expect(email).toContain('@');
    await search.fill(email);
    await expect(rows(page)).toHaveCount(1);
  });

  test('typing is never overwritten while the debounced value round-trips through the URL', async ({ page }) => {
    await openDirectory(page);
    const search = page.getByRole('searchbox', { name: 'Search employees' });
    await search.pressSequentially('sharma', { delay: 140 });
    await page.waitForTimeout(900);
    await expect(search).toHaveValue('sharma');
    const expected = SORTED.filter((r) => r.lastName.toLowerCase().includes('sharma')).map(fullName);
    expect(expected.length).toBeGreaterThan(1); // two Sharmas in the data
    await expect.poll(() => names(page)).toEqual(expected);
  });

  test('leaving the page during the search debounce is not undone by a late URL update', async ({ page }) => {
    await openDirectory(page);
    await page.getByRole('searchbox', { name: 'Search employees' }).fill('Rohan'); // debounce pending
    await page.getByRole('link', { name: 'Add employee' }).first().click(); // real navigation, before it fires
    await expect(page.getByRole('form', { name: 'Add employee' })).toBeVisible();
    await page.waitForTimeout(900); // longer than the debounce
    await expect(page).toHaveURL(/\/employees\/new$/);
    await expect(page.getByRole('form', { name: 'Add employee' })).toBeVisible();
  });

  test('opening the drawer during the search debounce keeps the search (it does not leave the page)', async ({ page }) => {
    await openDirectory(page);
    const rohan = ROWS.find((r) => r.firstName === 'Rohan')!;
    await page.getByRole('searchbox', { name: 'Search employees' }).fill('Rohan'); // debounce pending
    await page.locator(`a[href="/employees/${rohan.id}"]:visible`).click(); // opens the drawer in place
    await expect(drawerOf(page)).toBeVisible();
    await expect(page).toHaveURL(/q=Rohan/); // the pending search was applied, not dropped
    await expect(page).toHaveURL(new RegExp(`view=${rohan.id}`));
    await expect.poll(() => names(page)).toEqual(['Rohan Iyer']);
  });

  test('status filter is multi-select, with URL persistence', async ({ page }) => {
    await openDirectory(page);
    await toggleFilter(page, 'Status', 'On leave');
    await expect(page).toHaveURL(/status=ON_LEAVE(&|$)/);
    await expect(rows(page)).toHaveCount(ROWS.filter((r) => r.status === 'ON_LEAVE').length);
    await expect(filterButton(page, 'Status')).toContainText('On leave');

    await toggleFilter(page, 'Status', 'Onboarding'); // add a second value: any of the two
    await expect(page).toHaveURL(/status=ONBOARDING%2CON_LEAVE/);
    const either = ROWS.filter((r) => r.status === 'ON_LEAVE' || r.status === 'ONBOARDING').length;
    await expect(rows(page)).toHaveCount(either);
    await expect(filterButton(page, 'Status')).toContainText('Status: 2 selected');

    await page.getByRole('checkbox', { name: 'On leave', exact: true }).click(); // untick one
    await expect(rows(page)).toHaveCount(ROWS.filter((r) => r.status === 'ONBOARDING').length);

    await page.getByRole('button', { name: 'Clear status' }).click();
    await toggleFilter(page, 'Status', 'Terminated');
    await expect.poll(() => names(page)).toEqual(['Amit Shah']);
  });

  test('employment type is multi-select too', async ({ page }) => {
    await openDirectory(page);
    await toggleFilter(page, 'Employment type', 'Intern', 'Contract');
    await expect(page).toHaveURL(/type=CONTRACT%2CINTERN/);
    const expected = ROWS.filter((r) => r.employmentType === 'INTERN' || r.employmentType === 'CONTRACT').length;
    await expect(rows(page)).toHaveCount(expected);
    const types = await page.getByTestId('employee-table').locator('tbody tr td:nth-child(5)').allInnerTexts();
    expect(types.every((t) => ['Intern', 'Contract'].includes(t.trim()))).toBe(true);
  });

  test('employment type and department filters narrow every visible row', async ({ page }) => {
    await openDirectory(page);
    await toggleFilter(page, 'Employment type', 'Contract');
    await expect(page).toHaveURL(/type=CONTRACT/);
    const column = (n: number) =>
      page.getByTestId('employee-table').locator(`tbody tr td:nth-child(${n})`).allInnerTexts().then((t) => t.map((s) => s.trim()));
    // poll: the previous (unfiltered) rows can still be on screen for a moment
    const contract = ROWS.filter((r) => r.employmentType === 'CONTRACT').length;
    await expect.poll(async () => (await column(5)).length).toBe(contract);
    expect((await column(5)).every((t) => t === 'Contract')).toBe(true);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/type=/);
    await expect(filterButton(page, 'Employment type')).toContainText('All types'); // wait for the UI state, not just the URL
    await page.getByLabel('Department').selectOption({ label: 'Engineering' });
    await expect(page).toHaveURL(/dept=/);
    const engineering = ROWS.filter((r) => r.departmentId === demoUuid(1001)).length;
    await expect.poll(async () => (await column(3)).filter((t) => t === 'Engineering').length).toBe(Math.min(engineering, PAGE_SIZE));
    expect((await column(3)).every((t) => t === 'Engineering')).toBe(true);
  });

  test('manager filter (combobox) lists that manager’s direct reports', async ({ page }) => {
    await openDirectory(page);
    const manager = page.getByRole('combobox', { name: 'Manager' });
    await manager.fill('Neha');
    await page.getByRole('option', { name: /Neha Gupta/ }).click();
    await expect(page).toHaveURL(/manager=/);
    await expect(page).toHaveURL(/managerName=/);
    await expect(rows(page)).toHaveCount(NEHA_REPORTS);
    // poll on content: while loading, skeleton rows can coincide with the expected row count
    await expect
      .poll(async () => (await page.getByTestId('employee-table').locator('tbody tr td:nth-child(4)').allInnerTexts()).map((t) => t.trim()))
      .toEqual(Array(NEHA_REPORTS).fill('Neha Gupta'));
    await page.getByRole('button', { name: 'Clear manager' }).click();
    await expect(rows(page)).toHaveCount(25);
  });

  test('keyboard: the status filter opens with Enter, ticks with Space, closes with Escape', async ({ page }) => {
    await openDirectory(page);
    const button = filterButton(page, 'Status');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab'); // first checkbox: Onboarding
    await expect(page.getByRole('checkbox', { name: 'Onboarding', exact: true })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/status=ONBOARDING/);
    await expect(rows(page)).toHaveCount(ROWS.filter((r) => r.status === 'ONBOARDING').length);
    // focus must stay on the control the user is operating (it used to jump to the results heading)
    await expect(page.getByRole('checkbox', { name: 'Onboarding', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(filterButton(page, 'Employment type')).toBeFocused();
  });

  test('a filter panel closes on an outside click', async ({ page }) => {
    await openDirectory(page);
    await filterButton(page, 'Status').click();
    await expect(page.getByRole('group', { name: 'Status' })).toBeVisible();
    await page.getByRole('heading', { level: 1, name: 'Employees' }).click();
    await expect(page.getByRole('group', { name: 'Status' })).toHaveCount(0);
  });

  test('no results shows the empty-filter state and Clear filters restores everything', async ({ page }) => {
    await openDirectory(page);
    await page.getByRole('searchbox', { name: 'Search employees' }).fill('zzzzzz');
    await expect(page.getByText('No employees match')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(rows(page)).toHaveCount(25);
    await expect(page.getByRole('searchbox', { name: 'Search employees' })).toHaveValue('');
    expect(new URL(page.url()).search).toBe('');
  });

  test('changing a filter resets pagination to page 1', async ({ page }) => {
    await openDirectory(page);
    const nav = page.getByRole('navigation', { name: 'Pagination' });
    await nav.getByRole('button', { name: /Next/ }).click();
    await expect(nav).toContainText('Page 2');
    await toggleFilter(page, 'Status', 'Onboarding');
    await expect(rows(page)).toHaveCount(3);
    await expect(nav).toContainText('Page 1 · 3 employees');
    // and clearing returns to the first page of everyone, not page 2
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(nav).toContainText('Page 1 · 25 employees');
  });

  test('filters live in the URL: deep link, reload and back-navigation keep them', async ({ page }) => {
    await openDirectory(page, undefined, '/employees?status=ACTIVE&q=a');
    await expect(filterButton(page, 'Status')).toContainText('Active');
    await expect(page.getByRole('searchbox', { name: 'Search employees' })).toHaveValue('a');
    const statuses = await page.getByTestId('employee-table').locator('tbody tr td:nth-child(6)').allInnerTexts();
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((t) => t.includes('Active'))).toBe(true);

    await page.reload();
    await resultsLoaded(page);
    await expect(filterButton(page, 'Status')).toContainText('Active');

    // a real navigation (full profile page) and back keeps the filters
    const href = await page.getByTestId('employee-table').locator('a[href^="/employees/"]').first().getAttribute('href');
    await page.goto(href!);
    await expect(page.getByRole('article')).toBeVisible();
    await page.goBack();
    await resultsLoaded(page);
    await expect(filterButton(page, 'Status')).toContainText('Active');
    await expect(page.getByRole('searchbox', { name: 'Search employees' })).toHaveValue('a');
  });

  test('a multi-value filter and an open drawer survive a deep link and a reload', async ({ page }) => {
    const rohan = ROWS.find((r) => r.firstName === 'Rohan')!;
    await openDirectory(page, undefined, `/employees?status=ACTIVE,ON_LEAVE&type=FULL_TIME,INTERN&view=${rohan.id}`);
    await expect(filterButton(page, 'Status')).toContainText('Status: 2 selected');
    await expect(filterButton(page, 'Employment type')).toContainText('Employment type: 2 selected');
    await expect(drawerOf(page)).toBeVisible();
    await expect(drawerOf(page).getByRole('article', { name: 'Profile of Rohan Iyer' })).toBeVisible();
    await page.reload();
    await expect(drawerOf(page).getByRole('article', { name: 'Profile of Rohan Iyer' })).toBeVisible();
    await expect(filterButton(page, 'Status')).toContainText('Status: 2 selected');
  });

  test('unknown or malformed URL params are ignored rather than breaking the page', async ({ page }) => {
    const problems = trackProblems(page);
    await openDirectory(page, undefined, '/employees?status=NOPE&type=XYZ&dept=not-a-uuid&manager=bad&view=nope');
    await expect(filterButton(page, 'Status')).toContainText('All statuses');
    await expect(filterButton(page, 'Employment type')).toContainText('All types');
    await expect(drawerOf(page)).toHaveCount(0); // a view id that is not a UUID is ignored
    await expect(rows(page)).toHaveCount(PAGE_SIZE);
    expect(problems.filter((p) => !p.includes('400'))).toEqual([]);
  });
});

// ---------- profile and status change ----------

for (const width of [1280, 390] as const) {
  test.describe(`profile @ ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    const FIELDS = ['Job title', 'Employment type', 'Department', 'Manager', 'Hire date', 'Termination date', 'Work email', 'Employee number', 'Created', 'Last updated'];

    test('a click opens the profile in the right-side drawer (list stays), supported fields only', async ({ page }) => {
      const problems = trackProblems(page);
      await openDirectory(page);
      const link = page.locator(`a[href="/employees/${demoUuid(3)}"]:visible`);
      await link.click();

      const drawer = drawerOf(page);
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute('aria-modal', 'true');
      await expect(page).toHaveURL(new RegExp(`[?&]view=${demoUuid(3)}`));
      await expect(page).toHaveURL(/\/employees\?/); // still the directory, not the profile page
      const profile = drawer.getByRole('article', { name: 'Profile of Kavya Menon' });
      await expect(profile).toBeVisible();
      for (const label of FIELDS) await expect(profile.getByText(label, { exact: true })).toBeVisible();
      await expect(profile.getByText('Arjun Rao')).toBeVisible(); // manager summary
      await expect(profile.getByText('Engineering', { exact: true })).toBeVisible(); // department summary
      for (const forbidden of ['Salary', 'Phone', 'Address', 'Date of birth']) {
        await expect(profile.getByText(forbidden, { exact: false })).toHaveCount(0);
      }

      // right-side panel: 640px max (design system 480-640), full width on phones; list still rendered
      const w = await drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width));
      expect(w).toBe(Math.min(640, width));
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      expect(await noOverflow(page)).toBe(true);
      expect(await rows(page).count()).toBeGreaterThan(5);
      expect(problems).toEqual([]);
    });

    test('drawer: focus is trapped, Escape closes it, focus returns to the name, URL is cleaned', async ({ page }) => {
      await openDirectory(page);
      const link = page.locator(`a[href="/employees/${demoUuid(3)}"]:visible`);
      await link.focus();
      await page.keyboard.press('Enter');
      const drawer = drawerOf(page);
      await expect(drawer.getByRole('article', { name: 'Profile of Kavya Menon' })).toBeVisible();
      expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press('Tab');
        expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press('Shift+Tab');
        expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(link).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      expect(new URL(page.url()).searchParams.has('view')).toBe(false);
    });

    test('drawer closes from the Close button and (where there is room) the backdrop', async ({ page }) => {
      await openDirectory(page);
      await page.locator(`a[href="/employees/${demoUuid(3)}"]:visible`).click();
      await expect(drawerOf(page)).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(drawerOf(page)).toHaveCount(0);
      if (width >= 700) {
        await page.locator(`a[href="/employees/${demoUuid(3)}"]:visible`).click();
        await expect(drawerOf(page)).toBeVisible();
        await page.mouse.click(10, 400);
        await expect(drawerOf(page)).toHaveCount(0);
      }
    });

    test('the manager link switches the drawer to the manager; "Open full page" goes to the profile page', async ({ page }) => {
      await openDirectory(page);
      await page.locator(`a[href="/employees/${demoUuid(4)}"]:visible`).click(); // Rohan Iyer
      const drawer = drawerOf(page);
      await expect(drawer.getByRole('article', { name: 'Profile of Rohan Iyer' })).toBeVisible();
      await drawer.getByRole('link', { name: 'Kavya Menon' }).click();
      await expect(drawer.getByRole('article', { name: 'Profile of Kavya Menon' })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`view=${demoUuid(3)}`));
      await drawer.getByRole('link', { name: /Open full page/ }).click();
      await expect(page).toHaveURL(new RegExp(`/employees/${demoUuid(3)}$`));
      await expect(page.getByRole('article', { name: 'Profile of Kavya Menon' })).toBeVisible();
    });

    test('Ctrl-click keeps the real link: opens the full profile page in a new tab, no drawer', async ({ page, context }) => {
      await openDirectory(page);
      const [popup] = await Promise.all([
        context.waitForEvent('page'),
        page.locator(`a[href="/employees/${demoUuid(3)}"]:visible`).click({ modifiers: ['Control'] }),
      ]);
      await popup.waitForLoadState();
      expect(new URL(popup.url()).pathname).toBe(`/employees/${demoUuid(3)}`);
      await expect(drawerOf(page)).toHaveCount(0);
    });

    test('the full profile page is still deep-linkable: breadcrumb, fields, back to the list', async ({ page }) => {
      const problems = trackProblems(page);
      await page.goto(`/employees/${demoUuid(3)}`);
      const profile = page.getByRole('article', { name: 'Profile of Kavya Menon' });
      await expect(profile).toBeVisible();
      for (const label of FIELDS) await expect(profile.getByText(label, { exact: true })).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Employees' }).click();
      await expect(page).toHaveURL(/\/employees(\?.*)?$/);
      expect(problems).toEqual([]);
    });

    test('unknown employee id shows not-found with a way back', async ({ page }) => {
      await openDirectory(page);
      await clientNavigate(page, `/employees/${demoUuid(9999)}`);
      await expect(page.getByText('Employee not found')).toBeVisible();
      await page.getByRole('link', { name: 'Back to employees' }).click();
      await expect(page.getByRole('searchbox', { name: 'Search employees' })).toBeVisible();
    });

    test('HR changes status; terminating requires a date; reactivating clears it', async ({ page }) => {
      await openDirectory(page);
      await page.getByRole('searchbox', { name: 'Search employees' }).fill('Rohan');
      await expect(rows(page)).toHaveCount(1);
      await page.getByRole('link', { name: 'Rohan Iyer' }).click();
      const form = page.getByRole('form', { name: 'Change employment status' });
      await expect(form).toBeVisible();
      const submit = form.getByRole('button', { name: 'Update status' });
      await expect(submit).toBeDisabled(); // nothing changed yet

      await form.getByLabel('Status').selectOption('TERMINATED');
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(form.getByText('Enter the termination date')).toBeVisible(); // client-side rule

      await form.getByLabel('Termination date').fill('2026-11-30');
      await submit.click();
      const profile = page.getByRole('article', { name: 'Profile of Rohan Iyer' });
      await expect(profile.getByText('Terminated').first()).toBeVisible();
      await expect(profile.getByText('30 Nov 2026')).toBeVisible();

      await form.getByLabel('Status').selectOption('ACTIVE');
      await submit.click();
      await expect(profile.getByText('Active').first()).toBeVisible();
      await expect(profile.getByText('30 Nov 2026')).toHaveCount(0);
    });

    test('a termination date before the hire date is rejected with a message', async ({ page }) => {
      await openDirectory(page);
      await page.getByRole('searchbox', { name: 'Search employees' }).fill('Rohan');
      await page.getByRole('link', { name: 'Rohan Iyer' }).click();
      const form = page.getByRole('form', { name: 'Change employment status' });
      await form.getByLabel('Status').selectOption('TERMINATED');
      await form.getByLabel('Termination date').fill('2000-01-01'); // hired 2021
      await form.getByRole('button', { name: 'Update status' }).click();
      await expect(form.getByText(/before the hire date/i)).toBeVisible();
    });
  });
}

// ---------- create and edit ----------

for (const width of [1280, 390] as const) {
  test.describe(`create and edit @ ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('required fields are validated, duplicate number is a 409 under the field', async ({ page }) => {
      const problems = trackProblems(page);
      await openDirectory(page);
      await page.getByRole('link', { name: 'Add employee' }).first().click();
      await expect(page).toHaveURL(/\/employees\/new$/);
      const form = page.getByRole('form', { name: 'Add employee' });
      await expect(form).toBeVisible();
      expect(await noOverflow(page)).toBe(true);

      await form.getByRole('button', { name: 'Create employee' }).click();
      await expect(form.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
      for (const label of ['Employee number', 'First name', 'Last name']) {
        await expect(form.getByLabel(label, { exact: false }).first()).toHaveAttribute('aria-invalid', 'true');
      }

      await form.getByLabel('Employee number').fill('gs-0003'); // exists (Kavya Menon)
      await form.getByLabel('First name').fill('Dup');
      await form.getByLabel('Last name').fill('Licate');
      await form.getByRole('button', { name: 'Create employee' }).click();
      const number = form.getByLabel('Employee number');
      await expect(number).toHaveAttribute('aria-invalid', 'true');
      await expect(form.getByText(/already exists/i)).toBeVisible();
      await expect(page).toHaveURL(/\/employees\/new$/); // not saved
      expect(problems).toEqual([]);
    });

    test('create, then edit: values round-trip through the profile', async ({ page }) => {
      const problems = trackProblems(page);
      await openDirectory(page);
      await page.getByRole('link', { name: 'Add employee' }).first().click();
      const form = page.getByRole('form', { name: 'Add employee' });

      await form.getByLabel('Employee number').fill('gs-0100');
      await form.getByLabel('Work email').fill('Test.Newhire@example.test');
      await form.getByLabel('First name').fill('Test');
      await form.getByLabel('Last name').fill('Newhire');
      await form.getByLabel('Job title').fill('QA Analyst');
      await form.getByLabel('Employment type').selectOption('CONTRACT');
      await form.getByLabel('Hire date').fill('2026-11-02');
      await form.getByLabel('Department').selectOption({ label: 'Sales' });
      const manager = form.getByRole('combobox', { name: 'Manager' });
      await manager.fill('Neha');
      await page.getByRole('option', { name: /Neha Gupta/ }).click();
      await form.getByRole('button', { name: 'Create employee' }).click();

      await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/);
      const profile = page.getByRole('article', { name: 'Profile of Test Newhire' });
      await expect(profile).toBeVisible();
      await expect(profile.getByText('GS-0100').first()).toBeVisible(); // stored upper-case
      await expect(profile.getByText('test.newhire@example.test')).toBeVisible(); // email normalised
      await expect(profile.getByText('Contract')).toBeVisible();
      await expect(profile.getByText('Sales')).toBeVisible();
      await expect(profile.getByText('Neha Gupta')).toBeVisible();
      await expect(profile.getByText('2 Nov 2026')).toBeVisible();
      await expect(profile.getByText('Onboarding').first()).toBeVisible(); // new employees start ONBOARDING

      // edit
      await profile.getByRole('link', { name: 'Edit' }).click();
      const edit = page.getByRole('form', { name: 'Edit employee' });
      await expect(edit.getByLabel('First name')).toHaveValue('Test');
      await expect(edit.getByLabel('Employee number')).toHaveValue('GS-0100');
      await edit.getByLabel('Job title').fill('Senior QA Analyst');
      await edit.getByLabel('Department').selectOption({ label: 'Finance' });
      await edit.getByRole('button', { name: 'Save changes' }).click();
      await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/);
      const updated = page.getByRole('article', { name: 'Profile of Test Newhire' });
      await expect(updated.getByText('Senior QA Analyst').first()).toBeVisible();
      await expect(updated.getByText('Finance')).toBeVisible();

      // the new person is findable in the directory (client navigation keeps demo state)
      await updated.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Employees' }).click();
      await page.getByRole('searchbox', { name: 'Search employees' }).fill('Newhire');
      await expect(rows(page)).toHaveCount(1);
      expect(problems).toEqual([]);
    });

    test('edit form rejects a manager cycle and an employee number that is taken', async ({ page }) => {
      await openDirectory(page);
      await page.getByRole('searchbox', { name: 'Search employees' }).fill('Arjun');
      await page.getByRole('link', { name: 'Arjun Rao' }).click();
      await page.getByRole('link', { name: 'Edit' }).click();
      const edit = page.getByRole('form', { name: 'Edit employee' });

      // Arjun manages Kavya; making Kavya Arjun's manager would be a cycle
      await edit.getByRole('combobox', { name: 'Manager' }).fill('Kavya');
      await page.getByRole('option', { name: /Kavya Menon/ }).click();
      await edit.getByRole('button', { name: 'Save changes' }).click();
      await expect(edit.getByText(/report, directly or indirectly, to themselves|cycle/i)).toBeVisible();
      await expect(page).toHaveURL(/\/edit$/);

      await edit.getByRole('button', { name: 'Clear manager' }).click();
      await edit.getByLabel('Employee number').fill('GS-0001'); // Meera's
      await edit.getByRole('button', { name: 'Save changes' }).click();
      await expect(edit.getByText(/already exists/i)).toBeVisible();
    });

    test('Cancel returns without saving', async ({ page }) => {
      await openDirectory(page);
      await page.getByRole('link', { name: 'Add employee' }).first().click();
      const form = page.getByRole('form', { name: 'Add employee' });
      await form.getByLabel('First name').fill('Nobody');
      await form.getByRole('button', { name: 'Cancel' }).click();
      await expect(page).toHaveURL(/\/employees$/);
      await page.getByRole('searchbox', { name: 'Search employees' }).fill('Nobody');
      await expect(page.getByText('No employees match')).toBeVisible();
    });
  });
}

// ---------- keyboard / accessibility ----------

test.describe('keyboard and accessibility', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('every control on the list and the create form has an accessible name', async ({ page }) => {
    const unnamed = (p: Page) =>
      p.evaluate(() =>
        Array.from(document.querySelectorAll('main input, main select, main textarea'))
          .filter((el) => {
            const e = el as HTMLInputElement;
            return !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.labels && e.labels.length > 0));
          })
          .map((el) => el.outerHTML.slice(0, 90)),
      );
    await openDirectory(page);
    expect(await unnamed(page)).toEqual([]);
    await page.getByRole('link', { name: 'Add employee' }).first().click();
    await expect(page.getByRole('form', { name: 'Add employee' })).toBeVisible();
    expect(await unnamed(page)).toEqual([]);
  });

  test('manager combobox: arrow keys and Enter choose, Escape closes', async ({ page }) => {
    await openDirectory(page);
    const manager = page.getByRole('combobox', { name: 'Manager' });
    await manager.focus();
    await manager.fill('Neha');
    // Suggestions load asynchronously and the list is empty ("Searching…") while a new search runs, so
    // wait for the settled list (Neha Gupta and Sneha Kulkarni both contain "neha") before using the keys.
    const suggestions = page.getByRole('listbox', { name: 'Manager suggestions' }).getByRole('option');
    await expect(suggestions).toHaveCount(2);
    await expect(suggestions.first()).toHaveText(/Neha Gupta/);
    await page.keyboard.press('ArrowDown');
    await expect(manager).toHaveAttribute('aria-activedescendant', /-opt-0$/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/manager=/);
    await expect(rows(page)).toHaveCount(NEHA_REPORTS);

    await manager.fill('Ar');
    await expect(page.getByRole('listbox', { name: 'Manager suggestions' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Manager suggestions' })).toHaveCount(0);
  });

  test('pagination is operable from the keyboard', async ({ page }) => {
    await openDirectory(page);
    const next = page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: /Next/ });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('Page 2');
    await expect(page.getByRole('heading', { name: 'Employee results, page 2' })).toBeFocused();
  });

  test('profile name links are reachable by Tab and open with Enter', async ({ page }) => {
    await openDirectory(page);
    const link = page.getByTestId('employee-table').locator('a[href^="/employees/"]').first();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('article')).toBeVisible();
  });
});

// ---------- dark theme ----------

test('dark theme: directory and form render and do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('gs-theme', 'dark'));
  await openDirectory(page);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(await noOverflow(page)).toBe(true);
  await page.getByRole('link', { name: 'Add employee' }).first().click();
  await expect(page.getByRole('form', { name: 'Add employee' })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

// ---------- HTTP mode must never fall back to demo data ----------

test.describe('HTTP adapter mode (needs E2E_HTTP_BASE_URL)', () => {
  test.skip(!process.env.E2E_HTTP_BASE_URL, 'start a dev server with NEXT_PUBLIC_EMPLOYEES_ADAPTER=http and set E2E_HTTP_BASE_URL');

  test('shows an explicit "not available" message: no demo records, no demo banner, no API calls', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(':4000')) apiCalls.push(r.url());
    });
    await page.goto(`${process.env.E2E_HTTP_BASE_URL}/employees`);
    await expect(page.getByText('Live API mode is not available yet.')).toBeVisible();
    await expect(page.getByText('Demo mode.')).toHaveCount(0);
    await expect(page.getByTestId('employee-table')).toHaveCount(0);
    await expect(page.getByText('Meera Nair')).toHaveCount(0);
    await expect(page.getByLabel('Demo: view as')).toHaveCount(0);
    expect(apiCalls).toEqual([]);
  });
});
