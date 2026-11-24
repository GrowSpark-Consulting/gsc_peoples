'use client';

import { FlaskConical } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { SelectField } from '@/components/ui/select';
import { createDemoEmployeesService, createDemoStore } from '../adapters/demo/demo-service';
import { DEMO_PERSONAS, type DemoPersonaKey } from '../adapters/demo/demo-sessions';
import { EmployeesContextProvider } from './employees-context';

const PERSONA_LABEL: Record<DemoPersonaKey, string> = {
  hr: 'HR Admin: all employees, can edit',
  manager: 'Manager: direct reports and self, read-only',
  employee: 'Employee: own profile, read-only',
};

/**
 * DEMO ONLY (development and unit tests; never bundled in production). Supplies the in-memory adapter
 * and a switchable demo persona. There is no login, no token and no database behind this.
 */
export function DemoEmployeesProviders({ children }: { children: React.ReactNode }) {
  const [store] = useState(createDemoStore);
  const [persona, setPersona] = useState<DemoPersonaKey>('hr');
  const session = DEMO_PERSONAS[persona];
  const service = useMemo(() => createDemoEmployeesService(store, () => session), [store, session]);

  return (
    <EmployeesContextProvider service={service} session={session}>
      <div className="mb-5 flex flex-col gap-3">
        <Alert variant="info" title="Demo mode.">
          <span className="inline-flex items-center gap-1.5">
            <FlaskConical className="size-4" strokeWidth={1.75} aria-hidden />
            Fictional data held in memory; it resets when you reload. Not connected to a database or
            to authentication.
          </span>
        </Alert>
        <SelectField
          label="Demo: view as"
          containerClassName="max-w-md"
          value={persona}
          onChange={(e) => setPersona(e.target.value as DemoPersonaKey)}
          helper={session.displayName}
        >
          {(Object.keys(DEMO_PERSONAS) as DemoPersonaKey[]).map((key) => (
            <option key={key} value={key}>
              {PERSONA_LABEL[key]}
            </option>
          ))}
        </SelectField>
      </div>
      {/* Remount on persona change so every list/profile reloads under the new permissions. */}
      <div key={persona}>{children}</div>
    </EmployeesContextProvider>
  );
}
