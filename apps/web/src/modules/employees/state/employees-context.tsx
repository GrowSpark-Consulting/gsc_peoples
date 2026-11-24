'use client';

import { createContext, useContext, useMemo } from 'react';
import { capabilities, type Capabilities, type Session } from '../permissions';
import type { EmployeesService } from '../service';

export interface EmployeesContextValue {
  service: EmployeesService;
  session: Session;
  caps: Capabilities;
  /** True when running on the in-memory demo adapter (fictional, non-persistent data). */
  isDemo: boolean;
}

const EmployeesContext = createContext<EmployeesContextValue | null>(null);

export function EmployeesContextProvider({
  service,
  session,
  children,
}: {
  service: EmployeesService;
  session: Session;
  children: React.ReactNode;
}) {
  const value = useMemo<EmployeesContextValue>(
    () => ({ service, session, caps: capabilities(session), isDemo: service.kind === 'demo' }),
    [service, session],
  );
  return <EmployeesContext.Provider value={value}>{children}</EmployeesContext.Provider>;
}

export function useEmployeesContext(): EmployeesContextValue {
  const ctx = useContext(EmployeesContext);
  if (!ctx) throw new Error('useEmployeesContext must be used inside <EmployeesContextProvider>');
  return ctx;
}
