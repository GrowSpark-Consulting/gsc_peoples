'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { publicEnv } from '@/config/env';
import { createHttpEmployeesService } from '../adapters/http-service';
import { fetchSession } from '../adapters/me-client';
import { describeError, isApiError } from '../errors';
import type { Session } from '../permissions';
import { EmployeesContextProvider } from './employees-context';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; code: string }
  | { status: 'ready'; session: Session };

function describeSessionError(status: number, message: string): string {
  if (status === 403) return `No access for this user in this company (403): ${message}`;
  if (status === 0) return 'The API is not reachable. Check that the server is running.';
  return message;
}

/**
 * The real session: the httpOnly cookie set at /login authenticates every request, and `GET /api/v1/me`
 * is the only source of identity, company and permissions. A 401 (expired or revoked session) sends the
 * user to /login; any other failure shows an error and never falls back to demo data.
 */
export function SessionEmployeesProviders({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });

  const toLogin = useCallback(() => router.replace('/login'), [router]);
  const service = useMemo(
    () => createHttpEmployeesService({ baseUrl: publicEnv.apiUrl, onUnauthorized: toLogin }),
    [toLogin],
  );

  useEffect(() => {
    let cancelled = false;
    fetchSession({ baseUrl: publicEnv.apiUrl })
      .then((session) => {
        if (!cancelled) setState({ status: 'ready', session });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isApiError(e) && e.status === 401) return toLogin();
        setState({
          status: 'error',
          message: isApiError(e)
            ? describeSessionError(e.status, describeError(e))
            : 'Could not load your session',
          code: isApiError(e) ? `${e.status}` : 'ERR',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [toLogin]);

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-sm" data-testid="session-loading">
        Loading your session…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <Alert variant="danger" title="Could not start a session.">
        <span data-testid="session-error" data-code={state.code}>
          {state.message}
        </span>
      </Alert>
    );
  }
  return (
    <EmployeesContextProvider service={service} session={state.session}>
      {children}
    </EmployeesContextProvider>
  );
}
