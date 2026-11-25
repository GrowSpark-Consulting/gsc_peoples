import { Writable } from 'node:stream';
import express from 'express';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { redactUrl } from '../../middleware/request-logger';
import { LOG_REDACT_PATHS } from './logger';

/** Real pino-http output captured in memory: no credential may be written to the log. */
async function logRequest(redact: string[]): Promise<string> {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = express();
  app.use(pinoHttp({ logger: pino({ redact }, sink) }));
  app.post('/login', (_req, res) => {
    res.cookie('gsc_session', 'SECRET-SESSION-VALUE', { httpOnly: true });
    res.cookie('gsc_csrf', 'SECRET-CSRF-COOKIE');
    res.setHeader('X-Development-Reset-Token', 'SECRET-RESET-TOKEN');
    res.json({ ok: true });
  });
  await request(app)
    .post('/login')
    .set('Cookie', 'gsc_session=SECRET-INCOMING-COOKIE')
    .set('Authorization', 'Bearer SECRET-BEARER')
    .set('X-CSRF-Token', 'SECRET-CSRF-HEADER')
    .send({ password: 'SECRET-BODY-PASSWORD' });
  return lines.join('\n');
}

describe('request URLs in logs', () => {
  it('drops query strings (searches carry names and emails) and signed file tokens', () => {
    expect(redactUrl('/api/v1/employees?q=jane.doe@example.com')).toBe('/api/v1/employees?[redacted]');
    expect(redactUrl('/api/v1/documents/local-file/abc.def')).toBe('/api/v1/documents/local-file/[redacted]');
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
  });
});

describe('request logging redaction', () => {
  it('negative control: the previous redact list (authorization + cookie only) DID leak response and CSRF secrets', async () => {
    const logged = await logRequest(['req.headers.authorization', 'req.headers.cookie']);
    expect(logged).toContain('SECRET-SESSION-VALUE'); // Set-Cookie in the response headers
    expect(logged).toContain('SECRET-RESET-TOKEN');
    expect(logged).toContain('SECRET-CSRF-HEADER');
  });

  it('never logs session cookies, CSRF tokens, bearer tokens or reset tokens (request or response)', async () => {
    const logged = await logRequest(LOG_REDACT_PATHS);

    expect(logged).toContain('"statusCode":200'); // it did log the request
    for (const secret of [
      'SECRET-SESSION-VALUE',
      'SECRET-CSRF-COOKIE',
      'SECRET-RESET-TOKEN',
      'SECRET-INCOMING-COOKIE',
      'SECRET-BEARER',
      'SECRET-CSRF-HEADER',
      'SECRET-BODY-PASSWORD',
    ]) {
      expect(logged, secret).not.toContain(secret);
    }
  });
});
