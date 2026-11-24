/**
 * Demo mode gate. Demo (in-memory fictional data, no login, no database) is a LOCAL DEVELOPMENT and
 * unit/browser-test facility only. It must be chosen explicitly and can never be active in production,
 * whatever the environment says. The default everywhere is the real, session-authenticated API.
 */
export function demoModeEnabled(env: {
  NODE_ENV?: string;
  NEXT_PUBLIC_EMPLOYEES_ADAPTER?: string;
}): boolean {
  return env.NODE_ENV !== 'production' && env.NEXT_PUBLIC_EMPLOYEES_ADAPTER === 'demo';
}
