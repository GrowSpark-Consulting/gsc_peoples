/**
 * Outbound email. PRD NOTIF-003 / A12: the MVP sends only two messages, the account invitation (AUTH-004) and
 * the password reset link (AUTH-002). Every other notification is in-app.
 *
 * `smtp` works with any provider that offers SMTP (the provider is an operator choice, not a code change).
 * `disabled` means the API is running without an email channel: invitations answer 503 and reset requests are
 * accepted but nothing is sent. Messages carry single-use links, so a driver never logs bodies or recipients.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly driver: 'disabled' | 'smtp' | 'resend' | 'brevo' | 'memory';
  /** Resolves when the message has been accepted by the mail server. Throws `MailError` otherwise. */
  send(message: MailMessage): Promise<void>;
}

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}
