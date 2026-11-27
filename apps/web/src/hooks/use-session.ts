'use client';

import { PERMISSIONS, type MeCompany, type Permission } from '@gsc/contracts';
import { useEffect, useState } from 'react';
import { publicEnv } from '@/config/env';
import { demoModeEnabled } from '@/lib/dev-auth/config';
import { ApiError } from '@/modules/employees/errors';
import { fetchMe, sessionFromMe, type MeData } from '@/modules/employees/adapters/me-client';
import type { Session } from '@/modules/employees/permissions';

export { PERMISSIONS };

type State =
  | { status: 'loading' }
  | { status: 'ready'; session: Session }
  | { status: 'error'; error: unknown };

/*
 * ONE `GET /me` per page load, shared by every consumer (the shell, the top bar, page gates, company settings and
 * the employees providers). It previously went out up to four times in parallel on each page.
 *
 * The cache lives in this browser tab's module state only: it is never shared between users or tenants, a full
 * reload starts empty, and sign-in, invitation acceptance and sign-out call `resetSessionCache()` before the next
 * user's pages render. A failed request is not remembered, so the next consumer retries.
 */
// Development-only demo mode has no sign-in page to send anyone to.
const DEMO = demoModeEnabled({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_EMPLOYEES_ADAPTER: process.env.NEXT_PUBLIC_EMPLOYEES_ADAPTER });

let meInflight: Promise<MeData> | undefined;
let meResolved: MeData | undefined;

export const resetSessionCache = () => {
  meInflight = undefined;
  meResolved = undefined;
};

/** Shared, de-duplicated `GET /me`. A 401 (expired or revoked session) goes to sign-in, like every other request. */
export function loadMe(): Promise<MeData> {
  if (!meInflight) {
    const request = fetchMe({ baseUrl: publicEnv.apiUrl });
    meInflight = request;
    request.then(
      (me) => {
        if (meInflight === request) meResolved = me;
      },
      (error: unknown) => {
        if (meInflight === request) meInflight = undefined;
        if (error instanceof ApiError && error.status === 401 && typeof window !== 'undefined' && !DEMO) window.location.replace('/login');
      },
    );
  }
  return meInflight;
}

// Same payload -> same Session object, so consumers that already rendered it do not re-render.
let sessionMemo: { me: MeData; session: Session } | undefined;
function toSession(me: MeData): Session {
  if (sessionMemo?.me !== me) sessionMemo = { me, session: sessionFromMe(me) };
  return sessionMemo.session;
}

export const loadSession = (): Promise<Session> => loadMe().then(toSession);

function readySession(): State | undefined {
  if (!meResolved) return undefined;
  try {
    return { status: 'ready', session: toSession(meResolved) };
  } catch (error) {
    return { status: 'error', error };
  }
}

/** The session if this tab already loaded it, otherwise undefined. Never starts a request. */
export function peekSession(): Session | undefined {
  const s = readySession();
  return s?.status === 'ready' ? s.session : undefined;
}

/** The signed-in user's role and permissions, from `GET /api/v1/me`. The API remains the authority. */
export function useSession(): State {
  // Already known (any navigation after the first page): render immediately, no loading flash.
  const [state, setState] = useState<State>(() => readySession() ?? { status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadSession().then(
      (session) => !cancelled && setState((s) => (s.status === 'ready' && s.session === session ? s : { status: 'ready', session })),
      (error: unknown) => !cancelled && setState({ status: 'error', error }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** The company's timezone, hours and working days from `GET /me` (dates and times are shown in this zone). */
export function useCompany(): MeCompany | null {
  const [company, setCompany] = useState<MeCompany | null>(() => meResolved?.company ?? null);
  useEffect(() => {
    let cancelled = false;
    loadMe().then(
      (me) => !cancelled && setCompany(me.company ?? null),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return company;
}

export const hasPermission = (session: Session, p: Permission) => session.permissions.includes(p);
export const hasAny = (session: Session, ...ps: Permission[]) => ps.some((p) => hasPermission(session, p));
