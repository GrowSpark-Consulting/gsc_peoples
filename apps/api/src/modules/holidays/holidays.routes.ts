import { Router } from 'express';
import {
  createHolidaySchema,
  holidayIdParamSchema,
  holidayListQuerySchema,
  updateHolidaySchema,
} from '@gsc/contracts';
import { requireCan } from '../../middleware/authorization/authorize';
import { validate } from '../../middleware/validation/validate';
import { UnauthorizedError } from '../../shared/errors';
import type { HolidayRepository } from './holidays.repository';

/**
 * Holiday calendar (PRD ORG-004). Mounted at /api/v1/holidays after `authenticate` and `resolveTenant`.
 * Everyone may view (matrix: SA/HR full, MGR/EMP view); only SA/HR write. Company comes from the
 * validated membership, never from the request.
 */
export function createHolidaysRouter(repository: HolidayRepository): Router {
  const router = Router();
  const ctx = (req: Express.Request) => {
    if (!req.user) throw new UnauthorizedError();
    return { companyId: req.user.companyId, userId: req.user.userId };
  };

  router.get('/', requireCan('org.read'), validate({ query: holidayListQuerySchema }), async (req, res) => {
    const { companyId } = ctx(req);
    res.json({ data: await repository.list({ companyId }, req.query as { year?: number }) });
  });

  router.post('/', requireCan('org.write'), validate({ body: createHolidaySchema }), async (req, res) => {
    const { companyId, userId } = ctx(req);
    res.status(201).json({ data: await repository.create({ companyId }, userId, req.body) });
  });

  router.patch(
    '/:id',
    requireCan('org.write'),
    validate({ params: holidayIdParamSchema, body: updateHolidaySchema }),
    async (req, res) => {
      const { companyId, userId } = ctx(req);
      res.json({ data: await repository.update({ companyId }, userId, String(req.params.id), req.body) });
    },
  );

  router.delete('/:id', requireCan('org.write'), validate({ params: holidayIdParamSchema }), async (req, res) => {
    const { companyId, userId } = ctx(req);
    await repository.remove({ companyId }, userId, String(req.params.id));
    res.status(204).end();
  });

  return router;
}
