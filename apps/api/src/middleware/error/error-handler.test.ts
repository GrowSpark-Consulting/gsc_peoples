import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type * as EnvModule from '../../config/env';

// Production behaviour: no internal message is ever returned to the client.
vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, env: { ...actual.env, NODE_ENV: 'production' } };
});

const { errorHandler } = await import('./error-handler');
const { UnauthorizedError } = await import('../../shared/errors');

const prismaError = (code: string, message: string, meta?: Record<string, unknown>) =>
  Object.assign(new Error(message), { name: 'PrismaClientKnownRequestError', code, meta });

function appThrowing(err: unknown) {
  const app = express();
  app.get('/x', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler (production)', () => {
  it.each([
    ['connection refused', prismaError('ECONNREFUSED', 'Invalid `prisma.user.findFirst()` invocation: connect ECONNREFUSED 10.0.0.5:5432')],
    ['pool acquire timeout', new Error('timeout exceeded when trying to connect')],
    ['connect timeout', new Error('Connection terminated due to connection timeout')],
    ['query timeout', new Error('Query read timeout')],
    ['unreachable host', prismaError('P1001', "Can't reach database server at db.internal.example:5432")],
  ])('%s -> 503 + Retry-After with a generic body', async (_label, err) => {
    const res = await request(appThrowing(err)).get('/x').set('x-request-id', 'req-123');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again shortly.', requestId: undefined },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|ECONN|5432|timeout|db\.internal/i);
  });

  it('invalid credentials stay 401 (an AppError is never reclassified)', async () => {
    const res = await request(appThrowing(new UnauthorizedError('Invalid email or password'))).get('/x');
    expect(res.status).toBe(401);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('an ordinary Prisma/SQL error is a 500 with a masked message, not a 503', async () => {
    const res = await request(appThrowing(prismaError('P2002', 'Unique constraint failed on the fields: (`email`) person@example.com'))).get('/x');
    expect(res.status).toBe(500);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('person@example.com');
  });
});
