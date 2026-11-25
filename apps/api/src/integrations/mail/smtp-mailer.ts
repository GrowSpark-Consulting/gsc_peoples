import nodemailer from 'nodemailer';
import { MailError, type Mailer, type MailMessage } from './types';

export interface SmtpConfig {
  host: string;
  port: number;
  /** true: TLS from the first byte (usually port 465). false: plain connect upgraded with STARTTLS. */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  /** Refuse to send over an unencrypted connection. Production always sets this. */
  requireTls: boolean;
  timeoutMs?: number;
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const timeout = config.timeoutMs ?? 10_000;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls && !config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
    // Certificate verification stays on (the default); never set rejectUnauthorized: false.
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    driver: 'smtp',
    async send(message: MailMessage) {
      try {
        await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text });
      } catch (e) {
        // The provider message can contain the recipient: keep only the error code.
        const code = (e as { code?: string; responseCode?: number } | null)?.code ?? 'UNKNOWN';
        throw new MailError(`Email could not be sent (${code})`);
      }
    },
  };
}
