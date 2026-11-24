import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'E2e-Scratch-Pass-1!';
export const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT ?? 4400}`;
export const API = `${API_ORIGIN}/api/v1`;
const apiDir = path.resolve(__dirname, '../../api');
const tsx = path.join(apiDir, 'node_modules/tsx/dist/cli.mjs');
const script = (...args: string[]) =>
  execFileSync(process.execPath, [tsx, 'scripts/e2e-scratch-db.ts', ...args], { cwd: apiDir, encoding: 'utf8' }).trim();

/** Truncate and re-seed the scratch database (new ids, same emails and password). */
export const resetDb = () => script('reset');
/** Run one statement against the scratch database (as its owner) and get the rows. */
export const sql = <T = Record<string, unknown>>(statement: string): T[] => JSON.parse(script('query', statement)) as T[];

export type Who = 'sa' | 'hr' | 'mgr' | 'team' | 'peer' | 'hrb' | 'empb';

const ROLE_LABEL: Record<Who, string> = { sa: 'Super Admin', hr: 'HR Admin', mgr: 'Manager', team: 'Employee', peer: 'Employee', hrb: 'HR Admin', empb: 'Employee' };

export async function signIn(page: Page, who: Who) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@e2e.local`);
  await page.getByLabel('Role').selectOption({ label: ROLE_LABEL[who] });
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 45_000 });
}

export const empId = (who: Who) => sql<{ id: string }>(`select e.id from hr.employees e join hr.company_memberships m on m."employeeId"=e.id join hr.users u on u.id=m."userId" where u.email='${who}@e2e.local'`)[0]!.id;
export const userId = (who: Who) => sql<{ id: string }>(`select id from hr.users where email='${who}@e2e.local'`)[0]!.id;

/** Calls the API from the signed-in browser context (session cookie + CSRF header, like the app does). */
export async function apiCall(page: Page, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const csrf = decodeURIComponent((await page.context().cookies(API)).find((c) => c.name === 'gsc_csrf')?.value ?? '');
  const res = await page.request.fetch(`${API}${url}`, {
    method,
    headers: { 'X-CSRF-Token': csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status(), json: (await res.json().catch(() => undefined)) as any };
}

/** Calendar date in the company time zone (Asia/Kolkata in the seed), `YYYY-MM-DD`, n days from today. */
export function companyDate(offset = 0, tz = 'Asia/Kolkata') {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** `YYYY-MM-DD` n days from today in UTC. */
export function utcDay(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
