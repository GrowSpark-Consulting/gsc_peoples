import { z } from 'zod';

/** ORG-004: holiday calendar. Dates are company-local calendar dates (YYYY-MM-DD), not instants. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real calendar date');

const holidayName = z.string().trim().min(1, 'Name is required').max(120);

export const createHolidaySchema = z.object({ date: isoDate, name: holidayName });
export type CreateHoliday = z.infer<typeof createHolidaySchema>;

export const updateHolidaySchema = z
  .object({ date: isoDate.optional(), name: holidayName.optional() })
  .refine((v) => v.date !== undefined || v.name !== undefined, 'Nothing to update');
export type UpdateHoliday = z.infer<typeof updateHolidaySchema>;

export const holidayIdParamSchema = z.object({ id: z.string().uuid() });

export const holidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type HolidayListQuery = z.infer<typeof holidayListQuerySchema>;

export const holidaySchema = z.object({ id: z.string(), date: isoDate, name: z.string() });
export type Holiday = z.infer<typeof holidaySchema>;
