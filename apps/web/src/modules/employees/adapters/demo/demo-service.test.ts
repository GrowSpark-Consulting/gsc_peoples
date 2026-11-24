import type { Employee } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors';
import type { Session } from '../../permissions';
import type { EmployeesService } from '../../service';
import { DEMO_IDS, DEPT, demoUuid } from './demo-data';
import { DEMO_PERSONAS } from './demo-sessions';
import { createDemoEmployeesService, createDemoStore } from './demo-service';

function setup(initial: Session = DEMO_PERSONAS.hr) {
  const store = createDemoStore();
  let session = initial;
  const service = createDemoEmployeesService(store, () => session, {
    latencyMs: 0,
    now: () => new Date('2026-11-19T10:00:00.000Z'),
  });
  return { store, service, as: (s: Session) => void (session = s) };
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected rejection');
};

async function allPages(service: EmployeesService, query: Record<string, unknown> = {}, limit = 7) {
  const pages: Employee[][] = [];
  let cursor: string | undefined;
  do {
    const r = await service.list({ ...query, limit, cursor });
    pages.push(r.data);
    cursor = r.page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

describe('read scope (mirrors the API)', () => {
  it('HR Admin sees every employee', async () => {
    const { service, store } = setup();
    expect((await allPages(service, {}, 100)).flat()).toHaveLength(store.rows.length);
  });

  it('Manager sees direct reports and self only', async () => {
    const { service, store } = setup(DEMO_PERSONAS.manager);
    const rows = (await allPages(service, {}, 100)).flat();
    const expected = store.rows.filter(
      (r) => r.managerId === DEMO_IDS.manager || r.id === DEMO_IDS.manager,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
    expect(rows.some((r) => r.id === DEMO_IDS.otherTeamMember)).toBe(false);
  });

  it('Employee sees only their own profile', async () => {
    const { service } = setup(DEMO_PERSONAS.employee);
    const rows = (await allPages(service, {}, 100)).flat();
    expect(rows.map((r) => r.id)).toEqual([DEMO_IDS.employee]);
  });

  it('out-of-scope ids are 404, never 403 (existence is not revealed)', async () => {
    const { service } = setup(DEMO_PERSONAS.manager);
    const err = await failure(service.get(DEMO_IDS.otherTeamMember));
    expect([err.status, err.code]).toEqual([404, 'NOT_FOUND']);
    expect((await service.get(DEMO_IDS.employee)).id).toBe(DEMO_IDS.employee); // direct report
    expect((await service.get(DEMO_IDS.manager)).id).toBe(DEMO_IDS.manager); // own profile
  });

  it('a user with no read permission gets 403', async () => {
    const { service } = setup({
      displayName: 'x',
      roleKey: 'EMPLOYEE',
      employeeId: null,
      permissions: [],
    });
    expect((await failure(service.list({}))).status).toBe(403);
  });

  it('a manager filter cannot widen scope', async () => {
    const { service } = setup(DEMO_PERSONAS.employee);
    expect((await service.list({ managerId: demoUuid(13) })).data).toEqual([]);
  });
});

describe('search', () => {
  it('matches first name, last name, employee number and work email, case-insensitively', async () => {
    const { service } = setup();
    const ids = async (q: string) => (await service.list({ q })).data.map((e) => e.employeeNumber);
    expect(await ids('kavya')).toEqual(['GS-0003']);
    expect(await ids('MENON')).toEqual(['GS-0003']);
    expect(await ids('gs-0014')).toEqual(['GS-0014']);
    expect(await ids('sanjay.kumar@growspark')).toEqual(['GS-0014']);
  });

  it('requires every word to match (first + last name together)', async () => {
    const { service } = setup();
    expect((await service.list({ q: 'rahul verma' })).data).toHaveLength(2);
    expect((await service.list({ q: 'rahul nair' })).data).toHaveLength(0);
  });

  it('ignores blank search', async () => {
    const { service, store } = setup();
    expect((await allPages(service, { q: '   ' }, 100)).flat()).toHaveLength(store.rows.length);
  });
});

describe('filters', () => {
  it('status, employment type, department and manager', async () => {
    const { service } = setup();
    const nums = async (q: Record<string, unknown>) =>
      (await allPages(service, q, 100)).flat().map((e) => e.employeeNumber);
    expect(await nums({ status: ['TERMINATED'] })).toEqual(['GS-0012']);
    expect((await nums({ status: ['ON_LEAVE', 'ONBOARDING'] })).length).toBe(5);
    expect((await nums({ employmentType: ['INTERN'] })).sort()).toEqual(['GS-0009', 'GS-0036']);
    expect((await nums({ departmentId: DEPT.finance })).length).toBe(5);
    expect((await nums({ managerId: demoUuid(13) })).length).toBe(6);
  });

  it('filters combine with search (AND)', async () => {
    const { service } = setup();
    const r = await service.list({ q: 'rahul', departmentId: DEPT.operations });
    expect(r.data.map((e) => e.employeeNumber)).toEqual(['GS-0025']);
  });

  it('rejects unknown filter values with a validation error', async () => {
    const { service } = setup();
    const err = await failure(service.list({ status: ['NOPE'] } as never));
    expect([err.status, err.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
});

describe('cursor pagination with stable sorting', () => {
  it('orders by last name, first name, then id', async () => {
    const { service } = setup();
    const all = (await allPages(service, {}, 100)).flat();
    const keys = all.map((e) => [e.lastName, e.firstName, e.id]);
    expect(keys).toEqual(
      [...keys].sort((a, b) =>
        a[0]! < b[0]!
          ? -1
          : a[0]! > b[0]!
            ? 1
            : a[1]! < b[1]!
              ? -1
              : a[1]! > b[1]!
                ? 1
                : a[2]! < b[2]!
                  ? -1
                  : 1,
      ),
    );
  });

  it('pages are complete, disjoint and identical to a single big page', async () => {
    const { service } = setup();
    const paged = (await allPages(service, {}, 7)).flat().map((e) => e.id);
    const whole = (await allPages(service, {}, 100)).flat().map((e) => e.id);
    expect(paged).toEqual(whole);
    expect(new Set(paged).size).toBe(paged.length);
  });

  it('same name on two employees: the id tie-break keeps order stable across page boundaries', async () => {
    const { service } = setup();
    // The two "Rahul Verma" rows are adjacent; force a page boundary between them.
    const whole = (await allPages(service, {}, 100)).flat();
    const first = whole.findIndex((e) => e.lastName === 'Verma' && e.firstName === 'Rahul');
    const paged = (await allPages(service, {}, first + 1)).flat().map((e) => e.id);
    expect(paged).toEqual(whole.map((e) => e.id));
  });

  it('last page has no cursor; an exact-multiple boundary does not emit a phantom page', async () => {
    const { service, store } = setup();
    const pages = await allPages(service, {}, store.rows.length);
    expect(pages).toHaveLength(1);
    const last = await service.list({ limit: store.rows.length });
    expect(last.page.nextCursor).toBeNull();
  });

  it('is stable when new rows are inserted between pages (keyset, not offset)', async () => {
    const { service } = setup();
    const first = await service.list({ limit: 5 });
    await service.create({ employeeNumber: 'GS-9000', firstName: 'Aaron', lastName: 'Abbott', workEmail: 'aaron.abbott@growspark.example', joiningDate: '2026-01-05', departmentId: DEPT.engineering }); // sorts before everything
    const second = await service.list({ limit: 5, cursor: first.page.nextCursor! });
    const overlap = second.data.filter((e) => first.data.some((f) => f.id === e.id));
    expect(overlap).toEqual([]);
  });

  it('rejects a malformed cursor', async () => {
    const { service } = setup();
    const err = await failure(service.list({ cursor: 'not-a-cursor' }));
    expect([err.status, err.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
});

describe('writes', () => {
  const valid = {
    employeeNumber: 'gs-0500',
    firstName: ' Test ',
    lastName: 'Person',
    workEmail: 'TEST.Person@growspark.example',
    employmentType: 'CONTRACT' as const,
    joiningDate: '2026-01-05', // required with workEmail and departmentId (PRD EMP-001)
    departmentId: DEPT.engineering,
  };

  it('HR Admin creates an employee: normalised fields, ONBOARDING status', async () => {
    const { service } = setup();
    const e = await service.create({
      ...valid,
      departmentId: DEPT.sales,
      managerId: demoUuid(13),
      joiningDate: '2026-12-01',
    });
    expect(e).toMatchObject({
      employeeNumber: 'GS-0500',
      firstName: 'Test',
      workEmail: 'test.person@growspark.example',
      status: 'ONBOARDING',
      department: { name: 'Sales' },
      manager: { firstName: 'Neha' },
    });
    expect((await service.get(e.id)).id).toBe(e.id);
  });

  it('Manager and Employee cannot create, edit or change status (403)', async () => {
    for (const persona of [DEMO_PERSONAS.manager, DEMO_PERSONAS.employee]) {
      const { service } = setup(persona);
      expect((await failure(service.create(valid))).status).toBe(403);
      expect((await failure(service.update(DEMO_IDS.employee, { jobTitle: 'x' }))).status).toBe(
        403,
      );
      expect(
        (await failure(service.changeStatus(DEMO_IDS.employee, { status: 'ACTIVE' }))).status,
      ).toBe(403);
    }
  });

  it('validates input with the shared contract (field errors per path)', async () => {
    const { service } = setup();
    const err = await failure(
      service.create({
        employeeNumber: '',
        firstName: '',
        lastName: 'x',
        workEmail: 'nope',
      } as never),
    );
    expect(err.status).toBe(400);
    // joiningDate and departmentId are required by the contract too (PRD EMP-001), and were not sent
    expect(Object.keys(err.fieldErrors).sort()).toEqual([
      'departmentId',
      'employeeNumber',
      'firstName',
      'joiningDate',
      'workEmail',
    ]);
  });

  it('duplicate employee number or work email is a 409 naming the field', async () => {
    const { service } = setup();
    const a = await failure(service.create({ ...valid, employeeNumber: 'gs-0003' }));
    expect([a.status, a.fieldErrors.employeeNumber]).toEqual([
      409,
      'An employee with this employee number already exists',
    ]);
    const b = await failure(
      service.create({ ...valid, workEmail: 'KAVYA.MENON@growspark.example' }),
    );
    expect([b.status, Object.keys(b.fieldErrors)]).toEqual([409, ['workEmail']]);
  });

  it('unknown department or manager is a 404', async () => {
    const { service } = setup();
    expect((await failure(service.create({ ...valid, departmentId: demoUuid(777) }))).message).toBe(
      'Department not found',
    );
    expect((await failure(service.create({ ...valid, managerId: demoUuid(777) }))).message).toBe(
      'Manager not found',
    );
  });

  it('a terminated employee cannot be a manager (same rule as the API)', async () => {
    const { service } = setup();
    const terminated = demoUuid(12); // GS-0012 Amit Shah, TERMINATED in the demo data
    const err = await failure(service.create({ ...valid, managerId: terminated }));
    expect(err.status).toBe(400);
    expect(err.fieldErrors.managerId).toBeDefined();
    expect((await failure(service.update(DEMO_IDS.employee, { managerId: terminated }))).status).toBe(400);
  });

  it('assigns department and manager through update, and can clear them', async () => {
    const { service } = setup();
    const moved = await service.update(DEMO_IDS.employee, {
      departmentId: DEPT.sales,
      managerId: demoUuid(13),
    });
    expect(moved).toMatchObject({
      department: { name: 'Sales' },
      manager: { employeeNumber: 'GS-0013' },
    });
    const cleared = await service.update(DEMO_IDS.employee, {
      departmentId: null,
      managerId: null,
    });
    expect([cleared.department, cleared.manager]).toEqual([null, null]);
  });

  it('prevents direct and indirect reporting cycles', async () => {
    const { service } = setup();
    // Arjun(2) <- Kavya(3) <- Rohan(4). Making Arjun report to Rohan closes a loop.
    const err = await failure(service.update(demoUuid(2), { managerId: DEMO_IDS.employee }));
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/report, directly or indirectly/);
    expect(
      (await failure(service.update(DEMO_IDS.employee, { managerId: DEMO_IDS.employee }))).status,
    ).toBe(400);
  });

  it('status: TERMINATED needs a date on/after hire; other statuses clear it', async () => {
    const { service } = setup();
    expect(
      (await failure(service.changeStatus(DEMO_IDS.employee, { status: 'TERMINATED' } as never)))
        .status,
    ).toBe(400);
    expect(
      (
        await failure(
          service.changeStatus(DEMO_IDS.employee, {
            status: 'TERMINATED',
            terminationDate: '2000-01-01',
          }),
        )
      ).message,
    ).toMatch(/before the hire date/);
    const t = await service.changeStatus(DEMO_IDS.employee, {
      status: 'TERMINATED',
      terminationDate: '2026-12-31',
    });
    expect([t.status, t.terminationDate]).toEqual(['TERMINATED', '2026-12-31']);
    const back = await service.changeStatus(DEMO_IDS.employee, { status: 'ACTIVE' });
    expect([back.status, back.terminationDate]).toEqual(['ACTIVE', null]);
  });

  it('rejects unknown properties such as companyId (strict contract)', async () => {
    const { service } = setup();
    expect((await failure(service.create({ ...valid, companyId: 'x' } as never))).status).toBe(400);
  });

  it('returns copies: callers cannot mutate the store', async () => {
    const { service } = setup();
    const e = await service.get(DEMO_IDS.employee);
    e.firstName = 'Hacked';
    expect((await service.get(DEMO_IDS.employee)).firstName).toBe('Rohan');
  });
});

describe('departments', () => {
  it('HR Admin gets them sorted by name; Manager and Employee get 403', async () => {
    const { service, as } = setup();
    expect((await service.listDepartments()).map((d) => d.name)).toEqual([
      'Engineering',
      'Finance',
      'Operations',
      'People & Culture',
      'Sales',
    ]);
    for (const p of [DEMO_PERSONAS.manager, DEMO_PERSONAS.employee]) {
      as(p);
      expect((await failure(service.listDepartments())).status).toBe(403);
    }
  });
});
