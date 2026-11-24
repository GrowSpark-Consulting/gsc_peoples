import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@gsc/contracts';
import { env } from '../../config/env';
import { AppError, NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/utils/logger';

export const notFoundHandler: RequestHandler = (req) => {
  throw new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;

  // Malformed JSON bodies surface from express.json() as a SyntaxError with status 400.
  const isBadJson = err instanceof SyntaxError && 'status' in err && err.status === 400;

  const appError = err instanceof AppError ? err : undefined;
  const statusCode = appError?.statusCode ?? (isBadJson ? 400 : 500);

  if (statusCode >= 500) logger.error({ err, requestId }, 'Unhandled error');

  const body: ApiError = {
    error: {
      code: appError?.code ?? (isBadJson ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
      message:
        appError || isBadJson
          ? (err as Error).message
          : env.NODE_ENV === 'production'
            ? 'Internal server error'
            : (err as Error).message,
      details: appError?.details,
      requestId,
    },
  };
  res.status(statusCode).json(body);
};
