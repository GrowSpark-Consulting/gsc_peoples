import pino from 'pino';
import { env } from '../../config/env';

// Never log credentials: request auth/cookies/CSRF, and the response headers that carry freshly issued
// session cookies or development reset tokens.
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'res.headers["x-development-reset-token"]',
  'res.headers["x-development-invitation-token"]',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: LOG_REDACT_PATHS,
});
