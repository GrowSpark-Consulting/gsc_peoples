import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../../shared/errors';

interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Validates (and replaces) body/query/params with the parsed Zod output. */
export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        throw new ValidationError(`Invalid request ${key}`, result.error.issues);
      }
      // req.query is a getter in Express 5, so redefine instead of assigning.
      Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true });
    }
    next();
  };
