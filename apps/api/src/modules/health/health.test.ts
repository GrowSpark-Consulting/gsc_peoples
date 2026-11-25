import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@gsc/contracts';
import { createApp } from '../../app';
import { DevAuthProvider } from '../../integrations/central-auth/dev.provider';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('returns a valid health payload without requiring auth', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.dependencies.redis).toBe('not_configured');
  });

  it('readiness is not ok without a reachable database (503), liveness stays 200, and API responses are not cacheable', async () => {
    const ready = await request(app).get('/api/v1/health/ready');
    expect(ready.status).toBe(503); // no database is configured in unit tests
    expect(ready.body.status).toBe('degraded');
    expect(ready.headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/v1/health')).headers['cache-control']).toBe('no-store');
  });

  it('sends the standard security headers and does not advertise the framework', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('answers a malformed cookie, an oversized body and broken JSON with client errors, never 500', async () => {
    expect((await request(app).get('/api/v1/me').set('cookie', 'gsc_session=%E0%A4%A')).status).toBe(401);
    const tooLarge = await request(app).post('/api/v1/anything').set('content-type', 'application/json').send(`{"a":"${'x'.repeat(1_100_000)}"}`);
    expect(tooLarge.status).toBe(413);
    const broken = await request(app).post('/api/v1/anything').set('content-type', 'application/json').send('{"password":"hunter2"');
    expect(broken.status).toBe(400);
    expect(JSON.stringify(broken.body)).not.toContain('hunter2');
  });

  it('rejects unauthenticated requests to non-public routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('fails closed by default in tests: no token is accepted without explicit dev auth', async () => {
    const res = await request(app).get('/api/v1/nope').set('authorization', 'Bearer dev:dev-hr-admin');
    expect(res.status).toBe(401);
  });

  it('rejects the development token format when malformed', async () => {
    const res = await request(app).get('/api/v1/nope').set('authorization', 'Bearer bad');
    expect(res.status).toBe(401);
  });

  it('accepts a provisioned development token (when dev auth is injected) and then 404s on unknown routes', async () => {
    const devApp = createApp({ authProvider: new DevAuthProvider('c1') });
    const res = await request(devApp).get('/api/v1/nope').set('authorization', 'Bearer dev:dev-hr-admin');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
