'use client';

import type { RoleKey } from '@gsc/contracts';
import { useSession } from '@/hooks/use-session';
import { demoModeEnabled } from '@/lib/dev-auth/config';

export interface CurrentUser {
  displayName: string;
  roleKey: RoleKey;
  employeeId: string | null;
}

const DEMO = demoModeEnabled({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_EMPLOYEES_ADAPTER: process.env.NEXT_PUBLIC_EMPLOYEES_ADAPTER });

/**
 * The signed-in user, from `GET /api/v1/me` (the httpOnly session cookie authenticates it; the API is
 * the only source). Uses the page's shared `/me` request instead of issuing its own. Returns null while
 * loading, on any failure, and in demo mode (which has no API), so callers keep their neutral fallback.
 */
export function useCurrentUser(): CurrentUser | null {
  const state = useSession();
  if (DEMO || state.status !== 'ready') return null;
  const { displayName, roleKey, employeeId } = state.session;
  return { displayName, roleKey, employeeId };
}
