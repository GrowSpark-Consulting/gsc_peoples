# Authentication: deliberate deviation from the PRD

The PRD (AUTH-001..006, section 6) names Supabase Auth. GSC Peoples instead keeps its own session
authentication. This is an explicit, owner-approved decision; there is exactly one authentication system.

## What is implemented

- Email/password login; passwords hashed with scrypt (`modules/auth/password.ts`).
- Server-side sessions in PostgreSQL (`user_sessions`), `HttpOnly` session cookie, CSRF protection
  (`middleware/auth/csrf.ts`), session expiry and revocation (logout, password reset, deactivation).
- Login rate limiting (5 failures per 15 minutes per ip+email; in-process store, see risks).
- Tenant membership validation on every request (`resolveTenant`): role and company come from the validated
  membership, never from client input. Roles and permissions are defined in code (PRD SET-003).
- Invitation and password-reset tokens: single use, stored hashed; invitation links valid 7 days (AUTH-004).
- Safe redirects (`safe-next.ts`).

## Consequences to keep in mind

- No Supabase Auth: Supabase's Data API stays disabled, and the application database role is `hr_app`.
- The rate limiter is per process (a `Map`); with several API instances the limit is per instance.
- The Supabase Auth email templates are not used; invite/reset email delivery needs its own sender (PRD A12).
- An optional central SSO provider stub exists (`integrations/central-auth`); it is not enabled.
