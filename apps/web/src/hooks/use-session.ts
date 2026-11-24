'use client';

import { meResponseSchema, PERMISSIONS, type MeCompany, type Permission } from '@gsc/contracts';
import { useEffect, useState } from 'react';
import { publicEnv } from '@/config/env';
import { apiRequest } from '@/lib/api-client';
import { fetchSession } from '@/modules/employees/adapters/me-client';
import type { Session } from '@/modules/employees/permissions';

export { PERMISSIONS };

type State =
  | { status: 'loading' }
  | { status: 'ready'; session: Session }
  | { status: 'error'; error: unknown };

// One `GET /me` per page load, shared by every component that needs the role or permissions.
let inflight: Promise<Session> | undefined;
let companyInflight: Promise<MeCompany | null> | undefined;
export const resetSessionCache = () => {
  inflight = undefined;
  companyInflight = undefined;
};

/** The signed-in user's role and permissions, from `GET /api/v1/me`. The API remains the authority. */
export function useSession(): State {
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    inflight ??= fetchSession({ baseUrl: publicEnv.apiUrl });
    inflight.then(
      (session) => !cancelled && setState({ status: 'ready', session }),
      (error: unknown) => {
        inflight = undefined;
        if (!cancelled) setState({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** The company's timezone, hours and working days from `GET /me` (dates and times are shown in this zone). */
export function useCompany(): MeCompany | null {
  const [company, setCompany] = useState<MeCompany | null>(null);
  useEffect(() => {
    let cancelled = false;
    companyInflight ??= apiRequest('/me', { schema: meResponseSchema }).then((r) => r.data.company ?? null);
    companyInflight.then(
      (c) => !cancelled && setCompany(c),
      () => {
        companyInflight = undefined;
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return company;
}

export const hasPermission = (session: Session, p: Permission) => session.permissions.includes(p);
export const hasAny = (session: Session, ...ps: Permission[]) => ps.some((p) => hasPermission(session, p));
