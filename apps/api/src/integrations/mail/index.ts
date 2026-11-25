import type { Env } from '../../config/env';
import { createHttpMailer } from './http-mailer';
import { createSmtpMailer } from './smtp-mailer';
import { MailError, type Mailer, type MailMessage } from './types';

export * from './types';
export * from './messages';
export { createHttpMailer } from './http-mailer';
export { createSmtpMailer } from './smtp-mailer';

export const disabledMailer: Mailer = {
  driver: 'disabled',
  send: () => Promise.reject(new MailError('Email delivery is not configured')),
};

/** In-memory mailer for tests: keeps every message so a test can read the link it carried. */
export function createMemoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return {
    driver: 'memory',
    outbox,
    async send(message) {
      outbox.push(message);
    },
  };
}

type MailEnv = Pick<Env, 'NODE_ENV' | 'MAIL_DRIVER' | 'MAIL_API_KEY' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'MAIL_FROM'>;

/** Builds the configured mailer. The env schema already guarantees the driver variables are present. */
export function createMailer(env: MailEnv): Mailer {
  if (env.MAIL_DRIVER === 'resend' || env.MAIL_DRIVER === 'brevo') {
    if (!env.MAIL_API_KEY || !env.MAIL_FROM) throw new Error(`${env.MAIL_DRIVER} mail is not configured`);
    return createHttpMailer({ driver: env.MAIL_DRIVER, apiKey: env.MAIL_API_KEY, from: env.MAIL_FROM });
  }
  if (env.MAIL_DRIVER !== 'smtp') return disabledMailer;
  if (!env.SMTP_HOST || !env.MAIL_FROM) throw new Error('SMTP is not configured');
  return createSmtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.MAIL_FROM,
    requireTls: env.NODE_ENV === 'production',
  });
}
