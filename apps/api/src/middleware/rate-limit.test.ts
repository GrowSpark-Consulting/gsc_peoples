import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './error/error-handler';
import { rateLimit } from './rate-limit';

function app(limit: ReturnType<typeof rateLimit>) {
  const a = express();
  a.set('trust proxy', 1);
  a.use('/api', limit);
  a.get('/api/ping', (_req, res) => void res.json({ ok: true }));
  a.get('/api/health', (_req, res) => void res.json({ ok: true }));
  a.use(errorHandler);
  return a;
}

describe('rateLimit', () => {
  it('allows `max` requests per window, then answers 429 with Retry-After, and recovers when the window ends', async () => {
    let t = 1_000_000;
    const a = app(rateLimit({ windowMs: 60_000, max: 3, now: () => t }));
    for (let i = 1; i <= 3; i += 1) {
      const r = await request(a).get('/api/ping');
      expect(r.status).toBe(200);
      expect(r.headers['ratelimit-remaining']).toBe(String(3 - i));
    }
    const blocked = await request(a).get('/api/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    t += 59_999;
    expect((await request(a).get('/api/ping')).status).toBe(429);
    t += 2;
    expect((await request(a).get('/api/ping')).status).toBe(200);
  });

  it('counts each client separately (X-Forwarded-For behind one trusted proxy) and never limits skipped paths', async () => {
    const a = app(rateLimit({ windowMs: 60_000, max: 1, skip: (r) => r.path === '/health' }));
    expect((await request(a).get('/api/ping').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
    expect((await request(a).get('/api/ping').set('X-Forwarded-For', '203.0.113.1')).status).toBe(429);
    expect((await request(a).get('/api/ping').set('X-Forwarded-For', '203.0.113.2')).status).toBe(200);
    for (let i = 0; i < 5; i += 1) expect((await request(a).get('/api/health').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
  });

  it('sweeps expired entries so memory stays bounded', async () => {
    let t = 0;
    const limit = rateLimit({ windowMs: 1_000, max: 5, now: () => t });
    const a = app(limit);
    for (let i = 0; i < 20; i += 1) await request(a).get('/api/ping').set('X-Forwarded-For', `198.51.100.${i}`);
    expect(limit.size()).toBe(20);
    t += 5_000;
    await request(a).get('/api/ping').set('X-Forwarded-For', '198.51.100.250');
    expect(limit.size()).toBe(1);
  });

  it('a custom key limits per account instead of per address', async () => {
    const a = express();
    a.use(express.json());
    a.post('/login', rateLimit({ windowMs: 60_000, max: 2, key: (r) => String(r.body?.email ?? '') }), (_req, res) => void res.json({ ok: true }));
    a.use(errorHandler);
    expect((await request(a).post('/login').send({ email: 'a@x.test' })).status).toBe(200);
    expect((await request(a).post('/login').send({ email: 'a@x.test' })).status).toBe(200);
    expect((await request(a).post('/login').send({ email: 'a@x.test' })).status).toBe(429);
    expect((await request(a).post('/login').send({ email: 'b@x.test' })).status).toBe(200);
  });
});
