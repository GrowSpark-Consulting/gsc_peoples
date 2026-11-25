/** User-facing messages for the forgot-password and reset-password pages. None of them may include a token. */

/** The API is unreachable (offline, DNS, server down). */
export const NETWORK_ERROR = 'We could not reach the server. Check your connection and try again.';
/** The API answered with an error and no message of its own. */
export const FORGOT_FAILED = 'Something went wrong while sending the reset link. Please try again.';
export const RESET_FAILED = 'Something went wrong while updating your password. Please try again.';
/** Same generic wording the API uses: never reveals whether the account exists. */
export const GENERIC_SENT = 'If the account exists, a reset link has been issued.';
/** Missing, malformed, expired or already-used reset link. */
export const INVALID_LINK = 'This reset link is invalid or has expired. Request a new one to continue.';
export const PASSWORD_LENGTH = 'Password must be 10 to 128 characters.';
export const PASSWORD_UPDATED = 'Password updated. Redirecting you to sign in...';

/** Mirrors the API's reset schema (PRD AUTH-002). */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const TOKEN_MIN = 32;
export const TOKEN_MAX = 256;
/** How long the confirmation stays on screen before going to /login. */
export const RESET_REDIRECT_MS = 1500;
