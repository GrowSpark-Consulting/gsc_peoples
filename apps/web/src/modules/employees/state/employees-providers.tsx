'use client';

import dynamic from 'next/dynamic';
import { demoModeEnabled } from '@/lib/dev-auth/config';
import { SessionEmployeesProviders } from './session-providers';

/**
 * Demo mode is a development/test facility, opt-in via NEXT_PUBLIC_EMPLOYEES_ADAPTER=demo. The demo
 * module is imported only inside a branch that is statically false in production builds, so the bundler
 * drops the demo data, personas and provider from production output entirely (verified by the
 * production-mode browser suite, which scans the built files).
 */
const DemoProviders =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_EMPLOYEES_ADAPTER === 'demo'
    ? dynamic(() => import('./demo-providers').then((m) => m.DemoEmployeesProviders), {
        ssr: false,
      })
    : null;

export const DEMO_MODE = demoModeEnabled({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_EMPLOYEES_ADAPTER: process.env.NEXT_PUBLIC_EMPLOYEES_ADAPTER,
});

export function EmployeesProviders({ children }: { children: React.ReactNode }) {
  if (DEMO_MODE && DemoProviders) return <DemoProviders>{children}</DemoProviders>;
  return <SessionEmployeesProviders>{children}</SessionEmployeesProviders>;
}
