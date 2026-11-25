import { MailError, type Mailer, type MailMessage } from './types';

export interface HttpMailConfig {
  driver: 'resend' | 'brevo';
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function parseSender(from: string): { name?: string; email: string } {
  const match = /^(.+?)\s*<([^>]+)>$/.exec(from.trim());
  if (!match) return { email: from.trim() };
  const name = match[1]!.replace(/^["']|["']$/g, '').trim();
  const email = match[2]!.trim();
  return name ? { name, email } : { email };
}

/**
 * HTTPS email API driver for environments where outbound SMTP ports (25/465/587) are blocked (e.g. Render Free tier).
 * Uses standard HTTPS (port 443) and never includes the recipient or provider response body in errors.
 */
export function createHttpMailer(config: HttpMailConfig): Mailer {
  const doFetch = config.fetchImpl ?? fetch;
  const timeout = config.timeoutMs ?? 10_000;

  return {
    driver: config.driver,
    async send(message: MailMessage) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const isResend = config.driver === 'resend';
      const url = isResend ? 'https://api.resend.com/emails' : 'https://api.brevo.com/v3/smtp/email';
      const headers: Record<string, string> = isResend
        ? { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }
        : { 'api-key': config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
      const body = isResend
        ? { from: config.from, to: [message.to], subject: message.subject, text: message.text }
        : { sender: parseSender(config.from), to: [{ email: message.to }], subject: message.subject, textContent: message.text };

      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      } catch {
        throw new MailError('Email could not be sent (NETWORK)');
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new MailError(`Email could not be sent (HTTP ${res.status})`);
      }
    },
  };
}
