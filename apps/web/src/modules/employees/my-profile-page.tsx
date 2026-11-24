'use client';

import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { ROLE_LABELS } from '@/lib/role-labels';
import { EmployeeProfile } from './components/employee-profile';
import { EmployeesProviders } from './state/employees-providers';
import { useEmployeesContext } from './state/employees-context';

/**
 * /profile: the signed-in user's own profile. The identity comes from `GET /api/v1/me` (through the
 * session provider); the record is the existing employee profile, read through the same API and
 * permissions as everywhere else (an employee can always read their own record).
 */
export function MyProfilePage() {
  return (
    <EmployeesProviders>
      <MyProfile />
    </EmployeesProviders>
  );
}

function MyProfile() {
  const { session } = useEmployeesContext();
  if (session.employeeId) return <EmployeeProfile id={session.employeeId} />;

  // A login with no linked employee record (e.g. a platform admin): show the account only.
  return (
    <section
      aria-label="Account"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-5 shadow-sm"
    >
      <Avatar name={session.displayName} size="lg" className="size-14 text-h2" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-h2 font-semibold text-ink">{session.displayName}</h2>
        <p className="text-small text-muted">
          {ROLE_LABELS[session.roleKey]} · No employee record is linked to this login.
        </p>
      </div>
      <Badge variant="accent">You</Badge>
    </section>
  );
}
