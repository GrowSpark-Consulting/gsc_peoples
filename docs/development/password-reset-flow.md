# Forgot / reset password flow (PRD AUTH-002)

Status checked 2026-11-25.

## How it works

1. **User asks for a link.** `/forgot-password` (web) posts `{ email }` to `POST /api/v1/auth/forgot-password`.
2. **API issues a token** (only for an `ACTIVE` user that has a password and an active company membership):
   - Any earlier unused reset tokens for that user are marked used, so only the newest link works.
   - A random token is created; only its **hash** is stored in `hr.password_reset_tokens` (`PasswordResetToken`).
   - Expiry: **60 minutes** (`PASSWORD_RESET_TTL_MINUTES`).
   - Email is sent without awaiting it, so known and unknown addresses take the same time.
   - The response is always `200 "If the account exists, a reset link has been issued."`: it never reveals whether an email is registered.
   - Outside production only, the token is also returned in the `X-Development-Reset-Token` header (used by tests).
3. **Email** (subject "Reset your GSC Peoples password") contains `WEB_APP_URL/reset-password?token=...`.
4. **User sets a new password.** `/reset-password` (web) posts `{ token, password }` to `POST /api/v1/auth/reset-password`.
   - Password: 10–128 characters.
   - The token is claimed atomically (works once, even with two simultaneous submits).
   - The password is changed, `passwordVersion` is bumped, **all the user's sessions are signed out**, and a `PASSWORD_RESET` audit log row is written.
   - Invalid, used or expired tokens answer `401 "Reset link is invalid or expired"`.
   - On success the web page redirects to `/login`.

## Files

| Part | File |
|---|---|
| API routes | `apps/api/src/modules/auth/auth.routes.ts` (`/forgot-password`, `/reset-password`) |
| Email text + TTL | `apps/api/src/integrations/mail/messages.ts` |
| SMTP sender | `apps/api/src/integrations/mail/smtp-mailer.ts`, `index.ts` |
| Env validation | `apps/api/src/config/env.ts` (`MAIL_DRIVER`, `SMTP_*`, `MAIL_FROM`, `WEB_APP_URL`) |
| DB table | `PasswordResetToken` in `apps/api/src/database/prisma/schema.prisma` |
| Web pages | `apps/web/src/app/(auth)/forgot-password/page.tsx`, `apps/web/src/app/(auth)/reset-password/page.tsx` |
| Public routes (no login needed) | `apps/web/src/proxy.ts` |

## Configuration needed for emails to actually send (Render, API service)

| Variable | Value |
|---|---|
| `MAIL_DRIVER` | `smtp` (`disabled` = the API boots, but reset requests send **nothing**) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | from the SMTP provider |
| `MAIL_FROM` | verified sender address (SPF, DKIM and DMARC set up on its domain) |
| `WEB_APP_URL` | `https://gsc-peoples.vercel.app` (must be https in production; it is the link in the email) |

## Is it working?

| Check | Result |
|---|---|
| Mail unit tests (`apps/api/src/integrations/mail/mail.test.ts`) | **Pass** (5/5, run 2026-11-25) |
| Integration tests: single-use token, only newest link works, unknown email answers the same, short password refused, concurrent reuse refused, sessions revoked, audit row, SMTP failure still answers 200 (`session-login.integration.test.ts`, `prd-acceptance.integration.test.ts`) | Recorded as passing in `docs/production-readiness-master-tracker.md`. **Not re-run on 2026-11-25**: other integration runs were using the shared scratch database at the same time (deadlock / terminated connection). Re-run with `pnpm --filter @gsc/api test:integration` when nothing else is running. |
| Production smoke (`apps/api/scripts/production-smoke.mjs`) | Checks that production never leaks the reset token header. |
| **Live production email** | **Unverified.** `docs/audit/production-readiness-gaps.md` #11 lists production SMTP credentials as an open P0 gap. Without them, "Forgot password" on the live site shows the success message but no email arrives. |

### How to verify on the live site

After SMTP is configured on Render: use "Forgot password" for the Super Admin account. The email must arrive, the link must open `WEB_APP_URL/reset-password`, work once, and stop working after 60 minutes (see `render-deployment-guide.md` section 5).

## Web page behaviour (updated 2026-11-25)

- Both pages: a sending state with the button disabled, duplicate submits ignored, network and API errors shown with a "Try again" retry. Messages live in `apps/web/src/lib/auth-messages.ts` and never include the token.
- `forgot-password`: always shows the generic success wording.
- `reset-password`:
  - A missing or malformed `?token=` shows the invalid-link message immediately.
  - Password length (10–128) is checked before submitting.
  - An API 401 shows the invalid/expired-link message with a "Send reset link" button.
  - Success shows "Password updated" for 1.5 s, then goes to `/login`.
- Tests: `forgot-password/page.test.tsx`, `reset-password/page.test.tsx`.
