import type { MailMessage } from './types';

/**
 * The two MVP emails. Plain text only, so no value can be interpreted as markup. The token travels in the
 * link's query string to the web app, which posts it to the API; it is never stored (only its hash is).
 */
export const INVITATION_TTL_DAYS = 7; // PRD AUTH-004
export const PASSWORD_RESET_TTL_MINUTES = 60; // PRD AUTH-002

function link(webAppUrl: string, path: string, token: string): string {
  return `${webAppUrl.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`;
}

export function invitationEmail(input: { to: string; webAppUrl: string; token: string; companyName: string }): MailMessage {
  return {
    to: input.to,
    subject: `You are invited to ${input.companyName} on GSC Peoples`,
    text: [
      `You have been invited to ${input.companyName} on GSC Peoples.`,
      '',
      'Set your password to activate your account:',
      link(input.webAppUrl, '/accept-invitation', input.token),
      '',
      `The link works once and expires in ${INVITATION_TTL_DAYS} days. If you were not expecting it, ignore this email.`,
    ].join('\n'),
  };
}

export function passwordResetEmail(input: { to: string; webAppUrl: string; token: string }): MailMessage {
  return {
    to: input.to,
    subject: 'Reset your GSC Peoples password',
    text: [
      'A password reset was requested for your GSC Peoples account.',
      '',
      'Choose a new password:',
      link(input.webAppUrl, '/reset-password', input.token),
      '',
      `The link works once and expires in ${PASSWORD_RESET_TTL_MINUTES} minutes. If you did not request it, ignore this email: your password is unchanged.`,
    ].join('\n'),
  };
}
