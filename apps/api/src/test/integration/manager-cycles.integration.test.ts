import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bindTenant, connect, failure, sleep, track } from './helpers';
import { insertCompany, insertEmployee, resetData } from './seed';

/**
 * Real PostgreSQL connections, authenticated as the least-privilege runtime role (hr_app).
 * Sessions deliberately keep the DEFAULT search_path, which proves the trigger function does not
 * depend on the caller's search_path (it is schema-qualified and pins its own).
 */
let admin: pg.Client; // hr_migrator: seeding / cleanup only
const clients: pg.Client[] = [];

const newApp = async () => {
  const c = await connect('TEST_DATABASE_URL');
  await bindTenant(c, 'c1'); // RLS: every connection acts for company c1 (the one these tests use)
  clients.push(c);
  return c;
};
const setManager = (c: pg.Client, employee: string, manager: string | null) =>
  c.query('UPDATE hr.employees SET "managerId" = $2 WHERE id = $1', [employee, manager]);

async function hasCycle(): Promise<boolean> {
  const { rows } = await admin.query(`
    WITH RECURSIVE walk(start, cur, depth) AS (
      SELECT id, "managerId", 1 FROM hr.employees WHERE "managerId" IS NOT NULL
      UNION ALL
      SELECT w.start, e."managerId", w.depth + 1 FROM walk w JOIN hr.employees e ON e.id = w.cur
      WHERE e."managerId" IS NOT NULL AND w.depth < 50
    ) SELECT 1 FROM walk WHERE cur = start LIMIT 1`);
  return rows.length > 0;
}

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
});
afterAll(async () => {
  await Promise.allSettled(clients.map((c) => c.end()));
  await admin.end();
});
beforeEach(async () => {
  await Promise.allSettled(clients.splice(0).map((c) => c.query('ROLLBACK').then(() => c.end())));
  await resetData(admin);
  await insertCompany(admin, 'c1');
  await insertCompany(admin, 'c2');
  for (const id of ['A', 'B', 'C']) await insertEmployee(admin, { id, companyId: 'c1' });
  await insertEmployee(admin, { id: 'X', companyId: 'c2' });
  await insertEmployee(admin, { id: 'Y', companyId: 'c2' });
});

describe('sequential cycle prevention (real connection)', () => {
  it('rejects a self-manager on INSERT and UPDATE', async () => {
    const app = await newApp();
    const ins = await failure(() =>
      app.query(
        `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","managerId","updatedAt") VALUES ('S','c1','S','a','b','S',now())`,
      ),
    );
    expect([ins.code, ins.constraint]).toEqual(['23514', 'employees_no_self_manager']);
    const upd = await failure(() => setManager(app, 'A', 'A'));
    expect(upd.code).toBe('23514');
  });

  it('rejects a two-person cycle (A -> B, then B -> A)', async () => {
    const app = await newApp();
    await setManager(app, 'A', 'B');
    const err = await failure(() => setManager(app, 'B', 'A'));
    expect([err.code, err.constraint]).toEqual(['23514', 'employees_no_manager_cycle']);
    expect(await hasCycle()).toBe(false);
  });

  it('rejects a three-person cycle (A -> B -> C, then C -> A)', async () => {
    const app = await newApp();
    await setManager(app, 'A', 'B');
    await setManager(app, 'B', 'C');
    const err = await failure(() => setManager(app, 'C', 'A'));
    expect([err.code, err.constraint]).toEqual(['23514', 'employees_no_manager_cycle']);
    expect(await hasCycle()).toBe(false);
  });

  it('allows valid re-parenting and clearing a manager', async () => {
    const app = await newApp();
    await setManager(app, 'A', 'B');
    await setManager(app, 'B', 'C');
    await setManager(app, 'A', 'C'); // re-parent
    await setManager(app, 'A', null);
    await setManager(app, 'C', 'A'); // legal once A no longer reports into C's chain
    expect(await hasCycle()).toBe(false);
  });

  it('rejects a manager from another company at the database (composite FK)', async () => {
    const app = await newApp();
    const err = await failure(() => setManager(app, 'A', 'X'));
    expect([err.code, err.constraint]).toEqual(['23503', 'employees_companyId_managerId_fkey']);
  });
});

describe('concurrent manager changes (two and three real connections)', () => {
  it('two-person race: the second transaction blocks, then fails once the first commits', async () => {
    const [t1, t2] = [await newApp(), await newApp()];
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await setManager(t1, 'A', 'B'); // takes the per-company lock, uncommitted
    const second = track(setManager(t2, 'B', 'A')); // would close A <-> B
    await sleep(400);
    expect(second.state()).toBe('pending'); // genuinely blocked on the advisory lock

    await t1.query('COMMIT');
    const err = await failure(() => second.promise);
    expect([err.code, err.constraint]).toEqual(['23514', 'employees_no_manager_cycle']);
    await t2.query('ROLLBACK');
    expect(await hasCycle()).toBe(false);
    const { rows } = await admin.query(
      "SELECT id, \"managerId\" FROM hr.employees WHERE id IN ('A','B') ORDER BY id",
    );
    expect(rows).toEqual([
      { id: 'A', managerId: 'B' },
      { id: 'B', managerId: null },
    ]);
  });

  it('three-person race: A->B, B->C, C->A in three transactions; exactly one fails and no cycle survives', async () => {
    const [t1, t2, t3] = [await newApp(), await newApp(), await newApp()];
    for (const t of [t1, t2, t3]) await t.query('BEGIN');
    await setManager(t1, 'A', 'B'); // holds the lock
    const second = track(setManager(t2, 'B', 'C'));
    await sleep(150);
    const third = track(setManager(t3, 'C', 'A'));
    await sleep(300);
    expect([second.state(), third.state()]).toEqual(['pending', 'pending']);

    await t1.query('COMMIT');
    // Whichever queued transaction gets the lock next runs; commit/rollback it to release the lock.
    const settle = async (t: pg.Client, p: ReturnType<typeof track>) => {
      await Promise.race([p.promise.catch(() => undefined), sleep(1500)]);
      await t.query(p.state() === 'rejected' ? 'ROLLBACK' : 'COMMIT');
    };
    const results: PromiseSettledResult<unknown>[] = [];
    const first = await Promise.race([
      second.promise.then(
        () => 'second',
        () => 'second',
      ),
      third.promise.then(
        () => 'third',
        () => 'third',
      ),
    ]);
    if (first === 'second') {
      await settle(t2, second);
      await settle(t3, third);
    } else {
      await settle(t3, third);
      await settle(t2, second);
    }
    results.push(...(await Promise.allSettled([second.promise, third.promise])));

    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1); // exactly one of B->C / C->A is refused
    expect((rejected[0]!.reason as { code?: string }).code).toBe('23514');
    expect(await hasCycle()).toBe(false);
  });

  it('different companies do not block each other (lock is per company)', async () => {
    const [t1, t2] = [await newApp(), await newApp()];
    await t1.query('BEGIN');
    await t2.query('BEGIN');
    await setManager(t1, 'A', 'B'); // lock for c1 held, uncommitted
    const other = track(setManager(t2, 'X', 'Y')); // company c2
    await sleep(300);
    expect(other.state()).toBe('resolved');
    await t1.query('COMMIT');
    await t2.query('COMMIT');
  });
});

describe('negative control: the advisory lock is what makes the race safe', () => {
  it('without the lock the same two-person race DOES create a cycle (so the tests above are sensitive)', async () => {
    const original = (
      await admin.query<{ def: string }>(
        `SELECT pg_get_functiondef('hr.employees_prevent_manager_cycle'::regproc) AS def`,
      )
    ).rows[0]!.def;
    const lockFree = original.replace(
      /PERFORM pg_advisory_xact_lock\([^;]*\);/,
      '-- lock removed for control experiment',
    );
    expect(lockFree).not.toBe(original);
    try {
      await admin.query(lockFree);
      const [t1, t2] = [await newApp(), await newApp()];
      await t1.query('BEGIN');
      await t2.query('BEGIN');
      await setManager(t1, 'A', 'B');
      await setManager(t2, 'B', 'A'); // does not block, and sees no cycle in its snapshot
      await t1.query('COMMIT');
      await t2.query('COMMIT');
      expect(await hasCycle()).toBe(true);
    } finally {
      await admin.query(original); // restore the real function
    }
    const restored = (
      await admin.query<{ def: string }>(
        `SELECT pg_get_functiondef('hr.employees_prevent_manager_cycle'::regproc) AS def`,
      )
    ).rows[0]!.def;
    expect(restored).toBe(original);
  });
});
