import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetDb, signIn, sql, userId } from './support';

/**
 * Responsive verification at 360, 375, 768, 1024 and 1440 px for every application page.
 * Automated checks per page and width (a screenshot of every combination is saved to test-results/responsive/):
 *   1. no horizontal scroll of the page itself (document width <= viewport width);
 *   2. no visible element sticks out past the right edge unless it sits inside a container that scrolls
 *      horizontally on purpose (data tables);
 *   3. the primary content is reachable: the page heading / main landmark is visible and not clipped away;
 *   4. interactive elements are not zero-size or hidden behind the sidebar (the page has a main landmark inside the viewport).
 * These checks find layout defects; they do not judge visual quality, which still needs a human look at the screenshots.
 */

// 360 px is the PRD's stated minimum; the other four are the release checklist widths.
const WIDTHS = [360, 375, 768, 1024, 1440] as const;
const HEIGHT = 900;
const OUT = path.resolve(__dirname, '../test-results/responsive');

const PAGES: { name: string; path: string; as: 'sa' | 'hr' | 'mgr' | 'team'; ready: RegExp | string }[] = [
  { name: 'settings-sa', path: '/settings', as: 'sa', ready: 'Audit log' },
  { name: 'dashboard-manager', path: '/dashboard', as: 'mgr', ready: 'Team members' },
  { name: 'leave-manager', path: '/leave', as: 'mgr', ready: 'Leave calendar' },
  { name: 'employees-hr', path: '/employees', as: 'hr', ready: 'All employees' },
  { name: 'employee-new', path: '/employees/new', as: 'hr', ready: 'Designation' },
  { name: 'reports', path: '/reports', as: 'hr', ready: 'Attendance report' },
  { name: 'employees-directory', path: '/employees', as: 'team', ready: 'Company directory' },
  { name: 'profile', path: '/profile', as: 'team', ready: 'My contact details' },
  { name: 'dashboard-hr', path: '/dashboard', as: 'hr', ready: 'Total employees' },
  { name: 'dashboard-employee', path: '/dashboard', as: 'team', ready: 'Leave balances' },
  { name: 'attendance-hr', path: '/attendance', as: 'hr', ready: 'Attendance by date' },
  { name: 'attendance-employee', path: '/attendance', as: 'team', ready: 'Attendance history' },
  { name: 'leave-hr', path: '/leave', as: 'hr', ready: 'Leave requests' },
  { name: 'leave-employee', path: '/leave', as: 'team', ready: 'Leave requests' },
  { name: 'departments', path: '/departments', as: 'hr', ready: /Departments/ },
  { name: 'onboarding', path: '/onboarding', as: 'hr', ready: /Nobody is onboarding|Default checklist|Pending|In progress/ },
  { name: 'documents-hr', path: '/documents', as: 'hr', ready: /Employee documents/ },
  { name: 'documents-employee', path: '/documents', as: 'team', ready: /Employee documents/ },
];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollsX = (el: Element | null) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth) return true;
        if (/(auto|scroll)/.test(s.overflowX)) return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none' || s.position === 'fixed') continue;
      if (r.right > vw + 1 && !scrollsX(el.parentElement)) {
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(' ').slice(0, 3).join('.')} right=${Math.round(r.right)} (vw ${vw})`);
        if (offenders.length >= 8) break;
      }
    }
    return { pageScrollWidth: document.documentElement.scrollWidth, vw, offenders };
  });
}

test.beforeAll(() => {
  resetDb();
  fs.mkdirSync(OUT, { recursive: true });
});

for (const who of ['sa', 'hr', 'mgr', 'team'] as const) {
  test.describe(`responsive as ${who}`, () => {
    for (const width of WIDTHS) {
      test(`${width}px`, async ({ page }) => {
        test.setTimeout(240_000);
        await page.setViewportSize({ width, height: HEIGHT });
        await signIn(page, who);
        const failures: string[] = [];
        for (const p of PAGES.filter((x) => x.as === who)) {
          await page.goto(p.path);
          await expect(page.locator('main').getByText(p.ready).first()).toBeVisible({ timeout: 45_000 }); // scoped to main: the sidebar repeats page names but is collapsed on narrow screens
          await page.waitForLoadState('networkidle').catch(() => undefined);
          await page.screenshot({ path: path.join(OUT, `${p.name}-${width}.png`), fullPage: true });
          const o = await overflow(page);
          if (o.pageScrollWidth > o.vw + 1) failures.push(`${p.name}@${width}: page scrolls horizontally (${o.pageScrollWidth} > ${o.vw})`);
          if (o.offenders.length) failures.push(`${p.name}@${width}: overflow ${o.offenders.join(' | ')}`);
          const main = await page.locator('main').first().boundingBox();
          if (!main || main.x + main.width > width + 1 || main.width < 200) failures.push(`${p.name}@${width}: main area is ${main ? `${Math.round(main.width)}px wide at x=${Math.round(main.x)}` : 'missing'}`);
        }
        expect(failures, failures.join('\n')).toEqual([]);
      });
    }
  });
}

test.describe('notifications panel', () => {
  for (const width of WIDTHS) {
    test(`${width}px: the panel opens fully inside the viewport and can be closed`, async ({ page }) => {
      sql(`delete from hr.notifications returning id`);
      const user = userId('team');
      const company = sql<{ id: string }>(`select "companyId" id from hr.company_memberships where "userId"='${user}'`)[0]!.id;
      for (const t of ['A fairly long notification title that has to wrap on a phone screen without overflowing', 'Second']) {
        sql(`insert into hr.notifications (id,"companyId","userId",type,title,message,"updatedAt") values (gen_random_uuid(),'${company}','${user}','TEST','${t}','Some message text that also wraps on narrow screens',now()) returning id`);
      }
      await page.setViewportSize({ width, height: HEIGHT });
      await signIn(page, 'team');
      await page.getByRole('button', { name: /^Notifications/ }).click();
      const panel = page.locator('[aria-label="Notifications"]').last();
      await expect(panel).toBeVisible();
      await expect(panel.getByText('Second')).toBeVisible();
      const box = (await panel.boundingBox())!;
      await page.screenshot({ path: path.join(OUT, `notifications-${width}.png`) });
      expect(box.x, `panel left edge at ${width}px`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `panel right edge at ${width}px`).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height, `panel bottom at ${width}px`).toBeLessThanOrEqual(HEIGHT + 1);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });
  }
});
