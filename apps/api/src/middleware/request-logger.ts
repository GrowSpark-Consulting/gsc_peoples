import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pinoHttp, stdSerializers } from 'pino-http';
import { logger } from '../shared/utils/logger';

/** A caller-supplied request id is kept only if it is short and plain; anything else is replaced. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * PRD: no personal data in logs. Query strings carry searches by name and email, and the development file route
 * carries a signed token in the path, so both are removed before a request line is written.
 */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const [path = '', query] = url.split('?');
  const safePath = path.replace(/(\/local-file\/)[^/]+/, '$1[redacted]');
  return query === undefined ? safePath : `${safePath}?[redacted]`;
}

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  serializers: {
    req: (req: IncomingMessage) => {
      const out = stdSerializers.req(req as Parameters<typeof stdSerializers.req>[0]) as unknown as Record<string, unknown>;
      return { ...out, url: redactUrl(out.url as string | undefined), query: undefined, params: undefined };
    },
  },
  customLogLevel: (_req, res, err) =>
    err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
});
