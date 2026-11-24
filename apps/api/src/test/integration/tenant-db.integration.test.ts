/* eslint-disable @typescript-eslint/no-explicit-any -- the facade injects companyId at runtime, so create inputs are intentionally loosely typed in tests */
import { AsyncLocalStorage } from 'node:async_hooks';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../database/client';
import type { PrismaClient } from '../../database/generated/client';
import { createIdentityStore } from '../../database/identity';
import { createTenantRunner, TenantViolationError, type TenantDb } from '../../database/tenant';
import { ValidationError } from '../../shared/errors';
import { connect, sleep, testUrl } from './helpers';
import {
  insertCompany,
  insertDepartment,
  insertEmployee,
  insertMembership,
  insertRole,
  insertUser,
  resetData,
} from './seed';

const A = { companyId: 'cA' };
const B = { companyId: 'cB' };

let admin: pg.Client;
let prisma: PrismaClient; // pool of 1 => every unit of work reuses the SAME physical connection
let wide: PrismaClient; // pool of 6 => real concurrency
const url = () => testUrl('TEST_DATABASE_URL');

// Lets a test run raw SQL on the transaction that withTenant opened (never exposed to app code).
const openTx = new AsyncLocalStorage<any>();
const probing = (client: PrismaClient) =>
  ({
    $transaction: (cb: (tx: any) => Promise<unknown>, opts: unknown) =>
      (client as any).$transaction((tx: any) => openTx.run(tx, () => cb(tx)), opts),
  }) as unknown as PrismaClient;

const readSetting = async () => {
  const [row] = await openTx.getStore()
    .$queryRaw`SELECT current_setting('app.company_id', true) AS v, pg_backend_pid() AS pid`;
  return row as { v: string | null; pid: number };
};

async function seed() {
  await resetData(admin);
  await insertCompany(admin, 'cA');
  await insertCompany(admin, 'cB');
  await insertUser(admin, 'u1');
  await insertUser(admin, 'u2');
  await insertUser(admin, 'u3'); // no memberships
  await insertRole(admin, 'rA', 'cA');
  await insertRole(admin, 'rB', 'cB');
  await insertDepartment(admin, 'dA', 'cA');
  await insertDepartment(admin, 'dB', 'cB');
  await insertEmployee(admin, { id: 'eA1', companyId: 'cA', number: 'A-001', departmentId: 'dA' });
  await insertEmployee(admin, { id: 'eA2', companyId: 'cA', number: 'A-002', managerId: 'eA1' });
  await insertEmployee(admin, { id: 'eB1', companyId: 'cB', number: 'B-001', departmentId: 'dB' });
  await insertMembership(admin, {
    id: 'mA1',
    companyId: 'cA',
    userId: 'u1',
    roleId: 'rA',
    employeeId: 'eA1',
  });
  await insertMembership(admin, {
    id: 'mB1',
    companyId: 'cB',
    userId: 'u1',
    roleId: 'rB',
    employeeId: 'eB1',
  });
  await insertMembership(admin, { id: 'mA2', companyId: 'cA', userId: 'u2', roleId: 'rA' });
}

const count = async (table: string, where = 'true') =>
  Number((await admin.query(`SELECT count(*) FROM hr.${table} WHERE ${where}`)).rows[0].count);

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  prisma = createPrismaClient(url(), { max: 1 });
  wide = createPrismaClient(url(), { max: 6 });
});
afterAll(async () => {
  await prisma.$disconnect();
  await wide.$disconnect();
  await admin.end();
});
beforeEach(seed);

describe('pooled connection reuse across tenant contexts', () => {
  it('SET LOCAL context never survives the transaction: A, then outside, then B on the same connection', async () => {
    const withTenant = createTenantRunner(probing(prisma));

    const a = await withTenant(A, async () => readSetting());
    expect(a.v).toBe('cA');

    const [outside] = await prisma.$queryRaw<
      { v: string | null; pid: number }[]
    >`SELECT current_setting('app.company_id', true) AS v, pg_backend_pid() AS pid`;
    expect(outside!.pid).toBe(a.pid); // same physical connection was reused...
    expect(outside!.v ?? '').toBe(''); // ...and carries NO tenant id

    const b = await withTenant(B, async () => readSetting());
    expect(b.pid).toBe(a.pid);
    expect(b.v).toBe('cB'); // never 'cA'
  });

  it('a failed (rolled back) tenant transaction does not leak its context either', async () => {
    const withTenant = createTenantRunner(probing(prisma));
    await expect(
      withTenant(A, async () => {
        expect((await readSetting()).v).toBe('cA');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [after] = await prisma.$queryRaw<
      { v: string | null }[]
    >`SELECT current_setting('app.company_id', true) AS v`;
    expect(after!.v ?? '').toBe('');
    expect((await withTenant(B, async () => readSetting())).v).toBe('cB');
  });

  it('data access follows the same context as the setting while the connection is reused', async () => {
    const withTenant = createTenantRunner(probing(prisma));
    const seenA = await withTenant(A, async (db) => ({
      n: await db.employee.count(),
      v: (await readSetting()).v,
    }));
    const seenB = await withTenant(B, async (db) => ({
      n: await db.employee.count(),
      v: (await readSetting()).v,
    }));
    expect([seenA, seenB]).toEqual([
      { n: 2, v: 'cA' },
      { n: 1, v: 'cB' },
    ]);
  });

  it('24 interleaved A/B units of work on a pool of 6 never see each other', async () => {
    const withTenant = createTenantRunner(probing(wide));
    const jobs = Array.from({ length: 24 }, (_, i) => {
      const ctx = i % 2 === 0 ? A : B;
      return withTenant(ctx, async (db) => {
        const before = (await readSetting()).v;
        await sleep(30 + (i % 5) * 10);
        const n = await db.employee.count();
        const after = (await readSetting()).v;
        return { want: ctx.companyId, before, after, n };
      });
    });
    for (const r of await Promise.all(jobs)) {
      expect(r.before).toBe(r.want);
      expect(r.after).toBe(r.want);
      expect(r.n).toBe(r.want === 'cA' ? 2 : 1);
    }
  });
});

describe('tenant layer inside interactive transactions (real hr_app connection)', () => {
  const withTenant: ReturnType<typeof createTenantRunner> = (ctx, fn) =>
    createTenantRunner(prisma)(ctx, fn);

  it('reads are isolated: other company ids are simply not found', async () => {
    await withTenant(A, async (db: any) => {
      expect(await db.employee.findMany({ orderBy: { employeeNumber: 'asc' } })).toHaveLength(2);
      expect(await db.employee.findUnique({ where: { id: 'eB1' } })).toBeNull();
      expect(await db.employee.findFirst({ where: { id: 'eB1' } })).toBeNull();
      await expect(db.employee.findUniqueOrThrow({ where: { id: 'eB1' } })).rejects.toThrow();
      await expect(db.employee.findFirstOrThrow({ where: { companyId: 'cB' } })).rejects.toThrow(); // caller filter cannot widen
      expect(
        await db.employee.count({ where: { OR: [{ companyId: 'cB' }, { companyId: 'cA' }] } }),
      ).toBe(2);
      expect((await db.employee.aggregate({ _count: { _all: true } }))._count._all).toBe(2);
      const grouped = await db.employee.groupBy({ by: ['companyId'], _count: { _all: true } });
      expect(grouped).toEqual([{ companyId: 'cA', _count: { _all: 2 } }]);
      expect(await db.department.findMany()).toEqual([expect.objectContaining({ id: 'dA' })]);
      expect(await db.role.findMany()).toEqual([expect.objectContaining({ id: 'rA' })]);
      expect(await db.company.findMany()).toEqual([expect.objectContaining({ id: 'cA' })]);
      expect(await db.company.findUnique({ where: { id: 'cA' } })).not.toBeNull();
    });
  });

  it('cursor pagination cannot start from a row of another company', async () => {
    await withTenant(A, async (db: any) => {
      const page = await db.employee
        .findMany({ cursor: { id: 'eB1' }, take: 5, orderBy: { id: 'asc' } })
        .catch((e: Error) => e);
      // either an error or an empty page, never company B data
      if (Array.isArray(page)) expect(page.every((e: any) => e.companyId === 'cA')).toBe(true);
    });
  });

  it("nested access through global User cannot expose another company's memberships", async () => {
    await withTenant(A, async (db: any) => {
      // u1 belongs to BOTH companies; from company A only the A membership is visible.
      const memberships = await db.companyMembership.findMany({
        where: { userId: 'u1' },
        include: { user: { include: { memberships: true, _count: true } } },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].companyId).toBe('cA');
      expect(memberships[0].user.memberships.map((m: any) => m.id)).toEqual(['mA1']);
      expect(memberships[0].user._count.memberships).toBe(1);

      const viaSelect = await db.companyMembership.findMany({
        where: { userId: 'u1' },
        select: { user: { select: { memberships: { select: { id: true } } } } },
      });
      expect(viaSelect[0].user.memberships).toEqual([{ id: 'mA1' }]);

      // existence/ordering oracles are refused outright
      await expect(
        db.companyMembership.findMany({
          where: { user: { memberships: { some: { companyId: 'cB' } } } },
        }),
      ).rejects.toThrow(TenantViolationError);
      await expect(
        db.companyMembership.findMany({ orderBy: { user: { memberships: { _count: 'asc' } } } }),
      ).rejects.toThrow(TenantViolationError);
    });
    // and from company B the answer is the B membership only
    await withTenant(B, async (db: any) => {
      const m = await db.companyMembership.findMany({
        include: { user: { include: { memberships: true } } },
      });
      expect(m.map((x: any) => x.id)).toEqual(['mB1']);
      expect(m[0].user.memberships.map((x: any) => x.id)).toEqual(['mB1']);
    });
  });

  it('nested relations stay within the tenant (to-many injection, composite FKs for to-one)', async () => {
    await withTenant(A, async (db: any) => {
      const e = await db.employee.findUnique({
        where: { id: 'eA1' },
        include: { reports: true, department: true, manager: true, membership: true },
      });
      expect(e.reports.map((r: any) => r.id)).toEqual(['eA2']);
      expect(e.department.id).toBe('dA');
      expect(e.membership.id).toBe('mA1');
      const dep = await db.department.findMany({ include: { employees: true, _count: true } });
      expect(dep).toHaveLength(1);
      expect(dep[0]._count.employees).toBe(1);
      const company = await db.company.findUnique({
        where: { id: 'cA' },
        include: { employees: true, memberships: true, roles: true },
      });
      expect(company.employees).toHaveLength(2);
      expect(company.memberships).toHaveLength(2);
    });
  });

  it('writes: create/createMany/createManyAndReturn force companyId; update/delete cannot cross companies', async () => {
    await withTenant(A, async (db: any) => {
      const one = await db.department.create({ data: { name: 'Ops' } });
      expect(one.companyId).toBe('cA');
      expect(
        await db.department.createMany({ data: [{ name: 'Fin' }, { name: 'Legal' }] }),
      ).toEqual({ count: 2 });
      const many = await db.department.createManyAndReturn({ data: [{ name: 'IT' }] });
      expect(many[0].companyId).toBe('cA');

      await expect(
        db.employee.update({ where: { id: 'eB1' }, data: { jobTitle: 'x' } }),
      ).rejects.toMatchObject({ code: 'P2025' });
      expect(
        await db.employee.updateMany({ where: { id: 'eB1' }, data: { jobTitle: 'x' } }),
      ).toEqual({ count: 0 });
      expect(await db.employee.updateMany({ data: { jobTitle: 'Staff' } })).toEqual({ count: 2 }); // no where => still only A
      const returned = await db.employee.updateManyAndReturn({ data: { jobTitle: 'Lead' } });
      expect(returned.map((r: any) => r.companyId)).toEqual(['cA', 'cA']);
      await expect(db.employee.delete({ where: { id: 'eB1' } })).rejects.toMatchObject({
        code: 'P2025',
      });
      expect(await db.employee.deleteMany({ where: { companyId: 'cB' } })).toEqual({ count: 0 });
      expect(await db.department.deleteMany({ where: { name: { in: ['Fin', 'Legal'] } } })).toEqual(
        { count: 2 },
      );
    });
    expect(await count('employees', `"companyId" = 'cB' AND "jobTitle" IS NULL`)).toBe(1); // B untouched
    expect(await count('departments', `"companyId" = 'cB'`)).toBe(1);
  });

  it('upsert: creates in own company, never touches the same key in another company', async () => {
    await withTenant(A, async (db: any) => {
      // 'B-001' exists only in company B; per-company uniqueness means A creates its own row.
      const created = await db.employee.upsert({
        where: { companyId_employeeNumber: { companyId: 'cA', employeeNumber: 'B-001' } },
        create: { employeeNumber: 'B-001', firstName: 'New', lastName: 'InA' },
        update: { firstName: 'Changed' },
      });
      expect(created.companyId).toBe('cA');
      const updated = await db.employee.upsert({
        where: { companyId_employeeNumber: { companyId: 'cA', employeeNumber: 'B-001' } },
        create: { employeeNumber: 'B-001', firstName: 'x', lastName: 'y' },
        update: { firstName: 'Changed' },
      });
      expect(updated.id).toBe(created.id);
      await expect(
        db.employee.upsert({
          where: { id: 'eB1', companyId: 'cB' },
          create: { employeeNumber: 'Z', firstName: 'x', lastName: 'y' },
          update: {},
        }),
      ).rejects.toThrow(TenantViolationError);
      await expect(
        db.employee.upsert({
          where: { id: 'eB1' },
          create: { id: 'eB1', employeeNumber: 'Z', firstName: 'x', lastName: 'y' },
          update: {},
        }),
      ).rejects.toThrow(TenantViolationError);
    });
    const { rows } = await admin.query(
      `SELECT "firstName", "companyId" FROM hr.employees WHERE id = 'eB1'`,
    );
    expect(rows).toEqual([{ firstName: 'First', companyId: 'cB' }]); // company B's row untouched
  });

  it('cross-company ids in scalar foreign keys are rejected by the database', async () => {
    const attempts: [string, (db: any) => Promise<unknown>][] = [
      [
        'department',
        (db) =>
          db.employee.create({
            data: { employeeNumber: 'X1', firstName: 'a', lastName: 'b', departmentId: 'dB' },
          }),
      ],
      [
        'manager',
        (db) =>
          db.employee.create({
            data: { employeeNumber: 'X2', firstName: 'a', lastName: 'b', managerId: 'eB1' },
          }),
      ],
      [
        'role',
        (db) =>
          db.companyMembership.create({ data: { userId: 'u3', roleId: 'rB', status: 'ACTIVE' } }),
      ],
      [
        'employee link',
        (db) => db.companyMembership.update({ where: { id: 'mA2' }, data: { employeeId: 'eB1' } }),
      ],
    ];
    for (const [name, attempt] of attempts) {
      await expect(withTenant(A, attempt), name).rejects.toMatchObject({ code: 'P2003' });
    }
    expect(await count('employees', `"employeeNumber" IN ('X1','X2')`)).toBe(0);
  });

  it('is atomic: an error after a successful write rolls the whole unit of work back', async () => {
    await expect(
      withTenant(A, async (db: any) => {
        await db.department.create({ data: { name: 'WillRollBack' } });
        await db.employee.update({ where: { id: 'eB1' }, data: { jobTitle: 'x' } }); // not found => throws
      }),
    ).rejects.toThrow();
    expect(await count('departments', `name = 'WillRollBack'`)).toBe(0);
  });

  it('commits when the unit of work succeeds, scoped to the tenant', async () => {
    await withTenant(B, async (db: any) => db.department.create({ data: { name: 'BOnly' } }));
    expect(await count('departments', `name = 'BOnly' AND "companyId" = 'cB'`)).toBe(1);
  });

  it('the facade has no raw SQL, no User delegate and refuses unknown operations', async () => {
    await withTenant(A, async (db: any) => {
      expect(db.$queryRaw).toBeUndefined();
      expect(db.$executeRaw).toBeUndefined();
      expect(db.$transaction).toBeUndefined();
      expect(db.user).toBeUndefined();
      expect(() => db.employee.findRaw).toThrow(TenantViolationError);
      expect(() => db.employee.$queryRaw).toThrow(TenantViolationError);
    });
  });

  it('a missing company context is refused before any query runs', async () => {
    await expect(withTenant({ companyId: '' }, async () => 1)).rejects.toThrow(
      TenantViolationError,
    );
  });
});

describe('email normalisation happens before the database write', () => {
  const withTenant: ReturnType<typeof createTenantRunner> = (ctx, fn) =>
    createTenantRunner(prisma)(ctx, fn);

  it('employee workEmail is stored trimmed and lower-case (create, createMany, update, upsert)', async () => {
    await withTenant(A, async (db: any) => {
      await db.employee.create({
        data: {
          employeeNumber: 'N1',
          firstName: 'a',
          lastName: 'b',
          workEmail: '  Jane.Doe@EXAMPLE.com ',
        },
      });
      await db.employee.createMany({
        data: [{ employeeNumber: 'N2', firstName: 'a', lastName: 'b', workEmail: 'ALICE@X.COM' }],
      });
      await db.employee.update({ where: { id: 'eA2' }, data: { workEmail: ' Bob@X.COM' } });
      await db.employee.upsert({
        where: { companyId_employeeNumber: { companyId: 'cA', employeeNumber: 'N3' } },
        create: { employeeNumber: 'N3', firstName: 'a', lastName: 'b', workEmail: 'CARL@X.COM' },
        update: {},
      });
    });
    const { rows } = await admin.query(
      `SELECT "employeeNumber", "workEmail" FROM hr.employees WHERE "workEmail" IS NOT NULL ORDER BY "employeeNumber", id`,
    );
    expect(rows).toEqual([
      { employeeNumber: 'A-002', workEmail: 'bob@x.com' },
      { employeeNumber: 'N1', workEmail: 'jane.doe@example.com' },
      { employeeNumber: 'N2', workEmail: 'alice@x.com' },
      { employeeNumber: 'N3', workEmail: 'carl@x.com' },
    ]);
  });

  it('a blank email is rejected before reaching the database (no row written)', async () => {
    await expect(
      withTenant(A, async (db: any) =>
        db.employee.create({
          data: { employeeNumber: 'N9', firstName: 'a', lastName: 'b', workEmail: '   ' },
        }),
      ),
    ).rejects.toThrow(ValidationError);
    expect(await count('employees', `"employeeNumber" = 'N9'`)).toBe(0);
  });

  it('user email is normalised by the identity store; a differently-cased login updates the same user', async () => {
    const identity = createIdentityStore(prisma);
    const first = await identity.upsertUser({
      externalId: 'ext-1',
      email: '  Mixed.Case@Example.COM ',
    });
    expect(first.email).toBe('mixed.case@example.com');
    const again = await identity.upsertUser({
      externalId: 'ext-1',
      email: 'MIXED.CASE@EXAMPLE.COM',
      name: 'Mixed',
    });
    expect(again.id).toBe(first.id);
    expect(again.email).toBe('mixed.case@example.com');
    await expect(identity.upsertUser({ externalId: 'ext-2', email: '  ' })).rejects.toThrow();
    expect(await count('users', `"externalId" = 'ext-2'`)).toBe(0);
  });

  it('un-normalised values that bypass the application are still stopped by the CHECK constraint', async () => {
    await expect(
      admin.query(
        `INSERT INTO hr.users (id,"externalId",email,"updatedAt") VALUES ('raw','raw','RAW@X.COM',now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('identity store scope', () => {
  it('listMembershipsForUser returns only the caller\'s own ACTIVE memberships (the "which companies" screen)', async () => {
    const rows = await createIdentityStore(prisma).listMembershipsForUser('u1');
    expect(rows.map((r) => r.companyId).sort()).toEqual(['cA', 'cB']);
    expect(
      (await createIdentityStore(prisma).listMembershipsForUser('u2')).map((r) => r.companyId),
    ).toEqual(['cA']);
  });
});

export type { TenantDb };
