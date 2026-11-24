/**
 * Canonical email form used before ANY database write: trimmed and lower-case.
 * The database CHECK constraints enforce the same rule as a backstop.
 * Throws on blank input so an empty string can never be stored as an email.
 */
export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') throw new Error('Email must not be blank');
  return normalized;
}
