import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../shared/errors';
import { tenantMeta as meta } from './meta.generated';
import { scopeOperation, TenantViolationError } from './scope';
import type { TenantContext } from './types';

const A: TenantContext = { companyId: 'company-A' };
const B: TenantContext = { companyId: 'company-B' };
const A_FILTER = { companyId: 'company-A' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const run = (op: string, model: string, args?: unknown, ctx = A): Any =>
  scopeOperation(meta, ctx, model, op, args);
const violates = (fn: () => unknown) => expect(fn).toThrow(TenantViolationError);

describe('metadata', () => {
  it('knows which models are company-owned and which relations are to-many', () => {
    expect(meta.User?.hasCompanyId).toBe(false);
    for (const m of ['Role', 'RolePermission', 'Department', 'CompanyMembership', 'Employee']) {
      expect(meta[m]?.hasCompanyId, m).toBe(true);
    }
    expect(meta.User?.relations.memberships).toEqual({ target: 'CompanyMembership', list: true });
    expect(meta.CompanyMembership?.relations.user).toEqual({ target: 'User', list: false });
    expect(meta.Employee?.relations.reports).toEqual({ target: 'Employee', list: true });
  });
});

describe('direct reads (two companies)', () => {
  it('findMany ANDs the tenant filter, so a caller OR on companyId cannot widen it', () => {
    const r = run('findMany', 'Employee', {
      where: { OR: [{ companyId: 'company-B' }, { status: 'ACTIVE' }] },
    });
    expect(r.where).toEqual({
      AND: [{ OR: [{ companyId: 'company-B' }, { status: 'ACTIVE' }] }, A_FILTER],
    });
  });
  it('every many-read gets scoped even with no where', () => {
    for (const op of [
      'findMany',
      'findFirst',
      'findFirstOrThrow',
      'count',
      'aggregate',
      'groupBy',
    ]) {
      expect(run(op, 'Department').where, op).toEqual({ AND: [{}, A_FILTER] });
    }
  });
  it('findUnique / findUniqueOrThrow add companyId to the unique where (cross-company id => not found)', () => {
    expect(run('findUnique', 'Employee', { where: { id: 'emp-of-B' } }).where).toEqual({
      id: 'emp-of-B',
      companyId: 'company-A',
    });
    expect(
      run('findUniqueOrThrow', 'Role', {
        where: { companyId_key: { companyId: 'company-A', key: 'HR_ADMIN' } },
      }).where,
    ).toEqual({
      companyId_key: { companyId: 'company-A', key: 'HR_ADMIN' },
      companyId: 'company-A',
    });
  });
  it('an explicit foreign companyId in a unique where is a programming error', () => {
    violates(() => run('findUnique', 'Employee', { where: { id: 'x', companyId: 'company-B' } }));
    violates(() =>
      run('update', 'Employee', {
        where: { id: 'x', companyId: 'company-B' },
        data: { jobTitle: 'x' },
      }),
    );
    violates(() => run('delete', 'Employee', { where: { id: 'x', companyId: 'company-B' } }));
  });
  it('cursor pagination cannot start from another company row', () => {
    expect(run('findMany', 'Employee', { cursor: { id: 'emp-of-B' }, take: 10 }).cursor).toEqual({
      id: 'emp-of-B',
      companyId: 'company-A',
    });
    violates(() => run('findMany', 'Employee', { cursor: { id: 'x', companyId: 'company-B' } }));
  });
  it('Company is scoped by id and is read/update only', () => {
    expect(run('findMany', 'Company').where).toEqual({ AND: [{}, { id: 'company-A' }] });
    expect(run('findUnique', 'Company', { where: { id: 'company-A' } }).where).toEqual({
      id: 'company-A',
    });
    violates(() => run('findUnique', 'Company', { where: { id: 'company-B' } }));
    for (const op of ['create', 'createMany', 'upsert', 'delete', 'deleteMany', 'updateMany']) {
      violates(() => run(op, 'Company', { data: {}, where: {} }));
    }
  });
});

describe('nested relations and the global User model', () => {
  it('User is not a delegate on the tenant client', () => {
    for (const op of ['findMany', 'findUnique', 'create', 'update', 'delete', 'count'])
      violates(() => run(op, 'User', { where: {} }));
  });
  it('membership -> user -> memberships is filtered to the tenant at every depth', () => {
    const r = run('findMany', 'CompanyMembership', {
      include: { user: { include: { memberships: true } } },
    });
    expect(r.include.user.include.memberships.where).toEqual({ AND: [{}, A_FILTER] });
  });
  it('select form is scoped as well, including a caller where and deeper nesting', () => {
    const r = run('findMany', 'CompanyMembership', {
      select: {
        user: {
          select: {
            memberships: {
              where: { status: 'ACTIVE' },
              select: { role: { select: { permissions: true } } },
            },
          },
        },
      },
    });
    const m = r.select.user.select.memberships;
    expect(m.where).toEqual({ AND: [{ status: 'ACTIVE' }, A_FILTER] });
    expect(m.select.role.select.permissions.where).toEqual({ AND: [{}, A_FILTER] });
  });
  it('a caller cannot override the injected filter with their own companyId in a nested where', () => {
    const r = run('findMany', 'CompanyMembership', {
      include: { user: { include: { memberships: { where: { companyId: 'company-B' } } } } },
    });
    expect(r.include.user.include.memberships.where).toEqual({
      AND: [{ companyId: 'company-B' }, A_FILTER],
    });
  });
  it('_count on User.memberships is rewritten to a filtered count (true and select forms)', () => {
    const t = run('findMany', 'CompanyMembership', {
      include: { user: { include: { _count: true } } },
    });
    expect(t.include.user.include._count.select.memberships.where).toEqual({ AND: [{}, A_FILTER] });
    const s = run('findMany', 'CompanyMembership', {
      include: { user: { include: { _count: { select: { memberships: true } } } } },
    });
    expect(s.include.user.include._count.select.memberships.where).toEqual({ AND: [{}, A_FILTER] });
  });
  it('relation filters that reach User.memberships are rejected (existence oracle)', () => {
    violates(() =>
      run('findMany', 'CompanyMembership', {
        where: { user: { memberships: { some: { companyId: 'company-B' } } } },
      }),
    );
    violates(() =>
      run('findMany', 'CompanyMembership', {
        where: { user: { is: { memberships: { none: {} } } } },
      }),
    );
    violates(() =>
      run('count', 'CompanyMembership', {
        where: { NOT: [{ user: { memberships: { some: {} } } }] },
      }),
    );
    violates(() =>
      run('findMany', 'CompanyMembership', {
        include: {
          user: { include: { memberships: { where: { user: { memberships: { some: {} } } } } } },
        },
      }),
    );
  });
  it('scalar filters on the user are still allowed', () => {
    expect(
      run('findMany', 'CompanyMembership', { where: { user: { email: 'a@x.com' } } }).where,
    ).toEqual({
      AND: [{ user: { email: 'a@x.com' } }, A_FILTER],
    });
  });
  it('ordering by User.memberships (count) is rejected; scalar ordering is fine', () => {
    violates(() =>
      run('findMany', 'CompanyMembership', {
        orderBy: { user: { memberships: { _count: 'asc' } } },
      }),
    );
    expect(() =>
      run('findMany', 'CompanyMembership', { orderBy: { user: { email: 'asc' } } }),
    ).not.toThrow();
  });
  it('to-one relations take no where; to-many relations of company-owned models are scoped', () => {
    violates(() => run('findMany', 'Employee', { include: { manager: { where: {} } } }));
    const r = run('findMany', 'Employee', {
      include: { reports: true, department: true, manager: { include: { reports: true } } },
    });
    expect(r.include.reports.where).toEqual({ AND: [{}, A_FILTER] });
    expect(r.include.manager.include.reports.where).toEqual({ AND: [{}, A_FILTER] });
    expect(r.include.department).toBe(true);
  });
  it('Company.employees (to-many from the root) is scoped by companyId too', () => {
    const r = run('findUnique', 'Company', {
      where: { id: 'company-A' },
      include: { employees: true, memberships: { include: { user: true } } },
    });
    expect(r.include.employees.where).toEqual({ AND: [{}, A_FILTER] });
    expect(r.include.memberships.where).toEqual({ AND: [{}, A_FILTER] });
  });
  it('nested include/select on write operations is scoped as well', () => {
    const r = run('create', 'Employee', {
      data: { employeeNumber: '1', firstName: 'a', lastName: 'b' },
      include: { reports: true },
    });
    expect(r.include.reports.where).toEqual({ AND: [{}, A_FILTER] });
  });
});

describe('bulk operations', () => {
  it('createMany / createManyAndReturn force companyId on every row', () => {
    for (const op of ['createMany', 'createManyAndReturn']) {
      expect(
        run(op, 'Department', { data: [{ name: 'a' }, { name: 'b', companyId: 'company-A' }] })
          .data,
      ).toEqual([
        { name: 'a', companyId: 'company-A' },
        { name: 'b', companyId: 'company-A' },
      ]);
    }
  });
  it('a row naming another company, or a client id, rejects the whole batch', () => {
    violates(() =>
      run('createMany', 'Department', {
        data: [{ name: 'a' }, { name: 'b', companyId: 'company-B' }],
      }),
    );
    violates(() => run('createMany', 'Department', { data: [{ id: 'chosen', name: 'a' }] }));
  });
  it('updateMany / updateManyAndReturn / deleteMany are scoped, even with no where', () => {
    for (const op of ['updateMany', 'updateManyAndReturn']) {
      expect(run(op, 'Employee', { data: { status: 'ACTIVE' } }).where).toEqual({
        AND: [{}, A_FILTER],
      });
    }
    expect(run('deleteMany', 'Employee').where).toEqual({ AND: [{}, A_FILTER] });
    expect(
      run('deleteMany', 'Employee', { where: { OR: [{ companyId: 'company-B' }] } }).where,
    ).toEqual({
      AND: [{ OR: [{ companyId: 'company-B' }] }, A_FILTER],
    });
  });
  it('companyId and id are immutable in updates', () => {
    violates(() => run('updateMany', 'Employee', { data: { companyId: 'company-B' } }));
    violates(() =>
      run('update', 'Employee', { where: { id: 'x' }, data: { companyId: 'company-A' } }),
    );
    violates(() => run('update', 'Employee', { where: { id: 'x' }, data: { id: 'y' } }));
  });
  it('nested relation writes are rejected in create and update', () => {
    violates(() =>
      run('create', 'Employee', {
        data: {
          employeeNumber: '1',
          firstName: 'a',
          lastName: 'b',
          manager: { connect: { id: 'emp-of-B' } },
        },
      }),
    );
    violates(() =>
      run('update', 'Employee', {
        where: { id: 'x' },
        data: { department: { connect: { id: 'dept-of-B' } } },
      }),
    );
    violates(() =>
      run('create', 'Department', { data: { name: 'x', employees: { create: [{}] } } }),
    );
  });
});

describe('upsert', () => {
  const base = {
    create: { employeeNumber: '7', firstName: 'a', lastName: 'b' },
    update: { jobTitle: 'x' },
  };
  it('scopes where, forces companyId on create, forbids it on update', () => {
    const r = run('upsert', 'Employee', {
      ...base,
      where: { companyId_employeeNumber: { companyId: 'company-A', employeeNumber: '7' } },
    });
    expect(r.where.companyId).toBe('company-A');
    expect(r.create.companyId).toBe('company-A');
  });
  it('cannot target, create or move a row of another company', () => {
    violates(() =>
      run('upsert', 'Employee', { ...base, where: { id: 'x', companyId: 'company-B' } }),
    );
    violates(() =>
      run('upsert', 'Employee', {
        ...base,
        where: { id: 'x' },
        create: { ...base.create, companyId: 'company-B' },
      }),
    );
    violates(() =>
      run('upsert', 'Employee', {
        ...base,
        where: { id: 'x' },
        update: { companyId: 'company-B' },
      }),
    );
    violates(() =>
      run('upsert', 'Employee', {
        ...base,
        where: { id: 'emp-of-B' },
        create: { ...base.create, id: 'emp-of-B' },
      }),
    ); // id probe
  });
});

describe('cross-company ids in scalar foreign keys', () => {
  it('keeps (companyId=A, departmentId=<B id>) so the composite FK rejects it at the database', () => {
    const r = run('create', 'Employee', {
      data: {
        employeeNumber: '9',
        firstName: 'a',
        lastName: 'b',
        departmentId: 'dept-of-B',
        managerId: 'emp-of-B',
      },
    });
    expect([r.data.companyId, r.data.departmentId, r.data.managerId]).toEqual([
      'company-A',
      'dept-of-B',
      'emp-of-B',
    ]);
  });
  it('same for membership role / employee links', () => {
    expect(
      run('create', 'CompanyMembership', {
        data: { userId: 'u', roleId: 'role-of-B', employeeId: 'emp-of-B' },
      }).data.companyId,
    ).toBe('company-A');
  });
});

describe('email normalisation happens before any write', () => {
  const emp = { employeeNumber: '1', firstName: 'a', lastName: 'b' };
  it('create / createMany / createManyAndReturn lower-case and trim workEmail', () => {
    expect(
      run('create', 'Employee', { data: { ...emp, workEmail: '  Jane.Doe@Example.COM ' } }).data
        .workEmail,
    ).toBe('jane.doe@example.com');
    for (const op of ['createMany', 'createManyAndReturn']) {
      const rows = run(op, 'Employee', {
        data: [
          { ...emp, workEmail: 'A@X.COM' },
          { ...emp, employeeNumber: '2', workEmail: null },
        ],
      }).data;
      expect(rows.map((r: Any) => r.workEmail)).toEqual(['a@x.com', null]);
    }
  });
  it('update / updateMany / upsert (both branches) / { set } form are normalised', () => {
    expect(
      run('update', 'Employee', { where: { id: 'x' }, data: { workEmail: ' B@X.com' } }).data
        .workEmail,
    ).toBe('b@x.com');
    expect(run('updateMany', 'Employee', { data: { workEmail: 'C@X.com' } }).data.workEmail).toBe(
      'c@x.com',
    );
    expect(
      run('update', 'Employee', { where: { id: 'x' }, data: { workEmail: { set: 'D@X.COM' } } })
        .data.workEmail,
    ).toEqual({ set: 'd@x.com' });
    const u = run('upsert', 'Employee', {
      where: { id: 'x' },
      create: { ...emp, workEmail: 'E@X.com' },
      update: { workEmail: 'F@X.com' },
    });
    expect([u.create.workEmail, u.update.workEmail]).toEqual(['e@x.com', 'f@x.com']);
  });
  it('blank emails are rejected with a validation error, never written', () => {
    expect(() => run('create', 'Employee', { data: { ...emp, workEmail: '   ' } })).toThrow(
      ValidationError,
    );
    expect(() =>
      run('update', 'Employee', { where: { id: 'x' }, data: { workEmail: '' } }),
    ).toThrow(ValidationError);
  });
  it('null clears the email and other fields are untouched', () => {
    const d = run('update', 'Employee', {
      where: { id: 'x' },
      data: { workEmail: null, jobTitle: 'Keep Case' },
    }).data;
    expect(d).toEqual({ workEmail: null, jobTitle: 'Keep Case' });
  });
});

describe('guards', () => {
  it('rejects a missing tenant context and unsupported operations', () => {
    violates(() => run('findMany', 'Employee', {}, { companyId: '' }));
    violates(() => run('executeRaw', 'Employee', {}));
  });
  it('does not mutate caller arguments', () => {
    const input = { where: { status: 'ACTIVE' }, include: { reports: true } };
    const copy = structuredClone(input);
    run('findMany', 'Employee', input);
    expect(input).toEqual(copy);
  });
  it('the second tenant gets its own filter', () => {
    expect(run('findMany', 'Employee', {}, B).where).toEqual({
      AND: [{}, { companyId: 'company-B' }],
    });
  });
});
