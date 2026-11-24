import type { CreateHoliday, Holiday, HolidayListQuery, UpdateHoliday } from '@gsc/contracts';
import type { Prisma } from '../../database/generated/client';
import type { TenantDb } from '../../database/tenant';
import type { TenantContext } from '../../database/tenant/types';
import { ConflictError, NotFoundError } from '../../shared/errors';

type TenantRunner = <T>(ctx: TenantContext, fn: (db: TenantDb) => Promise<T>) => Promise<T>;

const SELECT = { id: true, date: true, name: true } as const;
type Row = { id: string; date: Date; name: string };

const toDay = (v: string) => new Date(`${v}T00:00:00.000Z`);
const toDto = (r: Row): Holiday => ({ id: r.id, date: r.date.toISOString().slice(0, 10), name: r.name });

function isPrismaCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}
const rethrow = (err: unknown): never => {
  if (isPrismaCode(err, 'P2002')) throw new ConflictError('A holiday already exists on this date');
  if (isPrismaCode(err, 'P2025')) throw new NotFoundError('Holiday not found');
  throw err;
};

/** Every state change writes an audit_logs row in the same transaction (PRD global rule). */
async function audit(
  db: TenantDb,
  actorUserId: string,
  action: 'CREATED' | 'UPDATED' | 'DELETED',
  holidayId: string,
  oldValue: Holiday | null,
  newValue: Holiday | null,
): Promise<void> {
  // `companyId` is injected by the tenant layer.
  const data = {
    actorId: actorUserId,
    action,
    entity: 'holiday',
    entityId: holidayId,
    ...(oldValue ? { oldValue: oldValue as unknown as Prisma.InputJsonObject } : {}),
    ...(newValue ? { newValue: newValue as unknown as Prisma.InputJsonObject } : {}),
  } as Prisma.AuditLogUncheckedCreateInput;
  await db.auditLog.create({ data });
}

export function createHolidayRepository(run: TenantRunner) {
  return {
    list(ctx: TenantContext, query: HolidayListQuery): Promise<Holiday[]> {
      const where = query.year
        ? { date: { gte: toDay(`${query.year}-01-01`), lte: toDay(`${query.year}-12-31`) } }
        : {};
      return run(ctx, async (db) => {
        const rows = (await db.holiday.findMany({ where, orderBy: [{ date: 'asc' }], select: SELECT })) as Row[];
        return rows.map(toDto);
      });
    },

    create(ctx: TenantContext, actorUserId: string, input: CreateHoliday): Promise<Holiday> {
      return run(ctx, async (db) => {
        const row = (await db.holiday
          .create({ data: { date: toDay(input.date), name: input.name } as never, select: SELECT })
          .catch(rethrow)) as Row;
        const dto = toDto(row);
        await audit(db, actorUserId, 'CREATED', dto.id, null, dto);
        return dto;
      });
    },

    update(ctx: TenantContext, actorUserId: string, id: string, patch: UpdateHoliday): Promise<Holiday> {
      return run(ctx, async (db) => {
        const before = (await db.holiday.findFirst({ where: { id }, select: SELECT })) as Row | null;
        if (!before) throw new NotFoundError('Holiday not found');
        const row = (await db.holiday
          .update({
            where: { id },
            data: {
              ...(patch.date !== undefined ? { date: toDay(patch.date) } : {}),
              ...(patch.name !== undefined ? { name: patch.name } : {}),
            },
            select: SELECT,
          })
          .catch(rethrow)) as Row;
        await audit(db, actorUserId, 'UPDATED', id, toDto(before), toDto(row));
        return toDto(row);
      });
    },

    remove(ctx: TenantContext, actorUserId: string, id: string): Promise<void> {
      return run(ctx, async (db) => {
        const before = (await db.holiday.findFirst({ where: { id }, select: SELECT })) as Row | null;
        if (!before) throw new NotFoundError('Holiday not found');
        await db.holiday.deleteMany({ where: { id } });
        await audit(db, actorUserId, 'DELETED', id, toDto(before), null);
      });
    },
  };
}
export type HolidayRepository = ReturnType<typeof createHolidayRepository>;
