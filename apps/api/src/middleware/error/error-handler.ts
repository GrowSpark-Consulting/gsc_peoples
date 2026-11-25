import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@gsc/contracts';
import { env } from '../../config/env';
import { AppError, NotFoundError } from '../../shared/errors';
import { logger } from '../../shared/utils/logger';

export const notFoundHandler: RequestHandler = (req) => {
  // The query string is not echoed back.
  throw new NotFoundError(`Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`);
};

/** Client errors raised by the body parser (malformed JSON, body too large, unsupported charset). */
function bodyError(err: unknown): { status: number; code: string; message: string } | undefined {
  const e = err as { type?: unknown; status?: unknown } | null;
  if (!e || typeof e.type !== 'string' || typeof e.status !== 'number' || e.status < 400 || e.status >= 500) return undefined;
  if (e.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large' };
  // Never echo the parser message: it can quote part of the request body.
  return { status: e.status, code: 'BAD_REQUEST', message: 'The request body could not be read' };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : undefined;

  const appError = err instanceof AppError ? err : undefined;
  const parse = appError ? undefined : bodyError(err);
  const statusCode = appError?.statusCode ?? parse?.status ?? 500;

  if (statusCode >= 500) logger.error({ err, requestId }, 'Unhandled error');

  const body: ApiError = {
    error: {
      code: appError?.code ?? parse?.code ?? 'INTERNAL_ERROR',
      message:
        appError?.message ??
        parse?.message ??
        (env.NODE_ENV === 'production' ? 'Internal server error' : (err as Error).message),
      details: appError?.details,
      requestId,
    },
  };
  res.status(statusCode).json(body);
};
