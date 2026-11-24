'use client';

import type { RoleKey } from '@gsc/contracts';
import { useEffect, useState } from 'react';
import { publicEnv } from '@/config/env';
import { demoModeEnabled } from '@/lib/dev-auth/config';
import { fetchSession } from '@/modules/employees/adapters/me-client';

export interface CurrentUser {
  displayName: string;
  roleKey: RoleKey;
  employeeId: string | null;
}

/**
 * The signed-in user, from `GET /api/v1/me` (the httpOnly session cookie authenticates it; the API is
 * the only source). Returns null while loading, on any failure, and in demo mode (which has no API), so
 * callers keep their neutral fallback. Nothing is invented or cached outside this component's lifetime.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (demoModeEnabled({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_EMPLOYEES_ADAPTER: process.env.NEXT_PUBLIC_EMPLOYEES_ADAPTER })) {
      return;
    }
    let cancelled = false;
    fetchSession({ baseUrl: publicEnv.apiUrl })
      .then((s) => {
        if (!cancelled) setUser({ displayName: s.displayName, roleKey: s.roleKey, employeeId: s.employeeId });
      })
      .catch(() => undefined); // 401 is handled by the proxy and the page providers; stay neutral here
    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
