'use client';

import { Send, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { AccessDeniedState, ErrorState } from '@/components/shared/data-states';
import { PageSkeleton } from '@/components/shared/page-skeletons';
import { FormError } from '@/components/shared/form-layout';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Select, SelectField } from '@/components/ui/select';
import {
  PersonCell,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { useAction } from '@/hooks/use-action';
import { hasPermission, PERMISSIONS, useSession } from '@/hooks/use-session';
import { apiRequest, describeApiError, isForbidden } from '@/lib/api-client';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import { listEmployeesForInvite } from '@/modules/settings/api';
import { formatTimestamp } from '@/modules/employees/format';
import { AuditLogSection } from '@/modules/settings/audit-log-section';

type FeedbackArea = 'company' | 'users';
type Row = Record<string, unknown>;

const loadCompany = () => apiRequest<{ data: Row }>('/settings/company').then((r) => r.data);
const loadUsers = () => apiRequest<{ data: Row[] }>('/settings/users').then((r) => r.data);

export default function SettingsPage() {
  // The last saved company (the API's response to PATCH) replaces the loaded one without a refetch.
  const [savedCompany, setSavedCompany] = useState<Row | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Which row action is running (membership id + kind), so only that row shows progress.
  const [rowBusy, setRowBusy] = useState<{ id: string; kind: 'role' | 'status' | 'resend' } | null>(null);
  // UI only: show success / error next to the section the person just acted in.
  const [feedbackAt, setFeedbackAt] = useState<FeedbackArea>('company');
  const session = useSession();
  // The API enforces every rule; these only hide controls the caller's role cannot use (PRD section 5).
  const can = (p: Parameters<typeof hasPermission>[1]) => session.status === 'ready' && hasPermission(session.session, p);
  const canEditCompany = can(PERMISSIONS.SETTINGS_WRITE);
  const canAssignRoles = can(PERMISSIONS.USER_ROLE_MANAGE);
  const canReadAudit = can(PERMISSIONS.AUDIT_READ);
  const canReadSettings = can(PERMISSIONS.SETTINGS_READ);
  // Employees who do not have a login yet can be invited; choosing one links the account to the record.
  const canReadUsers = can(PERMISSIONS.USER_ACCOUNT_READ);
  // Stable keys + reload(): the current rows stay on screen while a refresh is in flight (no flash to skeleton).
  const candidates = useAsyncData('settings:invitees', listEmployeesForInvite, canReadUsers);
  const invitees = (candidates.data ?? []).filter((e) => e.invitationStatus === 'NOT_INVITED' && e.workEmail && e.status !== 'INACTIVE' && e.status !== 'TERMINATED');
  const companyQuery = useAsyncData('settings:company', loadCompany);
  const usersQuery = useAsyncData('settings:users', loadUsers, session.status === 'ready' && canReadUsers);
  const users = usersQuery.data ?? [];
  const company = savedCompany ?? companyQuery.data ?? null;
  const reloadUsers = () => {
    usersQuery.reload();
    candidates.reload();
  };

  // Each action: one request at a time (double clicks are ignored), a busy button, and success shown only after
  // the API confirmed it. `useAction` turns any failure (validation, 403, 5xx, network) into a readable message.
  const saveAction = useAction((body: Row) => apiRequest<{ data: Row }>('/settings/company', { method: 'PATCH', body }));
  const inviteAction = useAction((body: Row) => apiRequest('/settings/users/invite', { method: 'POST', body }));
  const rowAction = useAction((path: string, body?: Row) =>
    apiRequest(`/settings/users/${path}`, { method: body ? 'PATCH' : 'POST', ...(body ? { body } : {}) }),
  );

  /** Starts an action in a section: clears old feedback and anchors the new feedback next to it. */
  function begin(area: FeedbackArea) {
    setFeedbackAt(area);
    setError('');
    setMessage('');
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inviteAction.pending) return;
    begin('users');
    const target = event.currentTarget; // React clears `currentTarget` after the first await
    const form = new FormData(target);
    const result = await inviteAction.run({
      email: String(form.get('email')),
      name: String(form.get('name') || '') || undefined,
      employeeId: String(form.get('employeeId') || '') || undefined,
      roleKey: String(form.get('roleKey')),
    });
    if (!result.ok) {
      setError(describeApiError(result.error));
      return;
    }
    setMessage('Invitation emailed. The link works for seven days.');
    target.reset();
    reloadUsers();
  }

  async function accountAction(membershipId: string, kind: 'role' | 'status', body: Record<string, string>, onFail?: () => void) {
    if (rowAction.pending) return onFail?.();
    begin('users');
    setRowBusy({ id: membershipId, kind });
    const result = await rowAction.run(`${membershipId}/${kind}`, body);
    setRowBusy(null);
    if (!result.ok) {
      setError(describeApiError(result.error));
      onFail?.();
      return;
    }
    setMessage('Account updated.');
    reloadUsers();
  }

  async function resendInvitation(membershipId: string) {
    if (rowAction.pending) return;
    begin('users');
    setRowBusy({ id: membershipId, kind: 'resend' });
    const result = await rowAction.run(`${membershipId}/invitations/resend`);
    setRowBusy(null);
    if (!result.ok) {
      setError(describeApiError(result.error));
      return;
    }
    setMessage('Invitation emailed again. Earlier links no longer work.');
    reloadUsers();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveAction.pending) return;
    begin('company');
    const form = new FormData(event.currentTarget);
    const result = await saveAction.run({
      name: String(form.get('name')),
      logoUrl: String(form.get('logoUrl') || '') || null,
      timezone: String(form.get('timezone')),
      workingDays: form.getAll('workingDays').map((day) => Number(day)),
      workStartTime: String(form.get('workStartTime')),
      workEndTime: String(form.get('workEndTime')),
    });
    if (!result.ok) {
      setError(describeApiError(result.error));
    } else {
      setSavedCompany(result.value.data);
      setMessage('Company settings saved.');
    }
  }

  if (session.status === 'ready' && !canReadSettings) return <AccessDeniedState />;
  if (companyQuery.status === 'error' && isForbidden(companyQuery.error)) return <AccessDeniedState />;

  if (!company) {
    return companyQuery.status === 'error' ? (
      <ErrorState
        title="Could not load company settings."
        message={describeApiError(companyQuery.error)}
        onRetry={companyQuery.reload}
      />
    ) : (
      <PageSkeleton variant="form" label="Loading company settings..." />
    );
  }
  const rowPending = (id: string, kind: 'role' | 'status' | 'resend') => rowBusy?.id === id && rowBusy.kind === kind;

  const feedback = (
    <div aria-live="polite" className="empty:hidden">
      {error ? <FormError title="Could not complete that." message={error} /> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}
    </div>
  );
  const workingDays = Array.isArray(company.workingDays) ? (company.workingDays as unknown[]) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader description="Company details, working hours, user accounts and the audit trail." />

      <SettingsCard
        id="company-settings"
        title="Company settings"
        description="Used for attendance rules, leave calculations and emails."
      >
        <form onSubmit={save} aria-busy={saveAction.pending || undefined}>
          {!canEditCompany ? (
            <Alert variant="info" className="mb-5">
              Only a Super Admin can change company settings.
            </Alert>
          ) : null}
          <fieldset disabled={!canEditCompany} className="grid min-w-0 max-w-3xl gap-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Company name"
                name="name"
                defaultValue={String(company.name)}
                required
                containerClassName="md:col-span-2"
              />
              <Field label="Logo URL" name="logoUrl" type="url" defaultValue={String(company.logoUrl ?? '')} placeholder="https://" />
              <Field label="Timezone" name="timezone" defaultValue={String(company.timezone)} required />
            </div>

            <fieldset className="min-w-0">
              <legend className="text-label font-medium text-ink">Working days</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {[
                  ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'],
                  ['5', 'Friday'], ['6', 'Saturday'], ['7', 'Sunday'],
                ].map(([value, label]) => (
                  <label
                    key={value}
                    className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-body text-ink transition-colors duration-[120ms] hover:bg-hover has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring pointer-coarse:h-11"
                  >
                    <input
                      type="checkbox"
                      name="workingDays"
                      value={value}
                      defaultChecked={workingDays.includes(Number(value))}
                      className="focus-visible:outline-none"
                    />
                    <span className="truncate">{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:max-w-md">
              <Field label="Work start" name="workStartTime" type="time" defaultValue={String(company.workStartTime)} required />
              <Field label="Work end" name="workEndTime" type="time" defaultValue={String(company.workEndTime)} required />
            </div>

            {feedbackAt === 'company' ? feedback : null}

            {canEditCompany ? (
              <div>
                <Button type="submit" className="w-full sm:w-auto" loading={saveAction.pending} loadingText="Saving...">
                  Save settings
                </Button>
              </div>
            ) : null}
          </fieldset>
        </form>
      </SettingsCard>

      <SettingsCard
        id="user-accounts"
        title="User accounts"
        description="Invite people to sign in. Linking an employee record fills in their work email."
      >
        <div className="flex flex-col gap-5">
          <form onSubmit={invite} aria-busy={inviteAction.pending || undefined} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Email" name="email" type="email" required autoComplete="off" />
            <Field label="Name" name="name" autoComplete="off" />
            <SelectField
              label="Employee record (optional)"
              name="employeeId"
              defaultValue=""
              onChange={(event) => {
                const chosen = invitees.find((e) => e.id === event.target.value);
                const email = event.target.form?.elements.namedItem('email');
                if (chosen?.workEmail && email instanceof HTMLInputElement) email.value = chosen.workEmail;
              }}
            >
              <option value="">Not linked to an employee</option>
              {invitees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} · {e.employeeNumber}
                </option>
              ))}
            </SelectField>
            <SelectField label="Role" name="roleKey" required defaultValue="EMPLOYEE">
              {canAssignRoles ? (
                <>
                  <option value="SUPER_ADMIN">Super Admin</option>
                  <option value="HR_ADMIN">HR Admin</option>
                </>
              ) : null}
              <option value="MANAGER">Manager</option>
              <option value="EMPLOYEE">Employee</option>
            </SelectField>
            <div className="sm:col-span-2 xl:col-span-4">
              <Button
                type="submit"
                icon={<UserPlus aria-hidden />}
                className="w-full sm:w-auto"
                loading={inviteAction.pending}
                loadingText="Sending invitation..."
              >
                Create invitation
              </Button>
            </div>
          </form>

          {feedbackAt === 'users' ? feedback : null}

          <Table label="User accounts list" className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Invitation</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.status === 'error' && users.length === 0 ? (
                <TableEmpty colSpan={6}>
                  {isForbidden(usersQuery.error) ? (
                    <AccessDeniedState message="You do not have permission to view user accounts." />
                  ) : (
                    <ErrorState
                      title="Could not load user accounts."
                      message={describeApiError(usersQuery.error)}
                      onRetry={usersQuery.reload}
                    />
                  )}
                </TableEmpty>
              ) : (usersQuery.status === 'loading' || usersQuery.status === 'idle') && users.length === 0 ? (
                <TableSkeleton columns={6} rows={4} />
              ) : users.length === 0 ? (
                <TableEmpty colSpan={6}>
                  <EmptyState icon={Users} title="No user accounts." description="Invitations you create appear here." />
                </TableEmpty>
              ) : (
                users.map((user) => (
                  <TableRow key={String(user.id)}>
                    <TableCell className="py-2.5">
                      <PersonCell name={String(user.name ?? user.email ?? '')} subtitle={String(user.email ?? '')} />
                    </TableCell>
                    <TableCell>{String(user.roleName ?? user.roleKey ?? '')}</TableCell>
                    <TableCell>
                      <StatusBadge value={user.accountStatus} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={user.invitationStatus} />
                    </TableCell>
                    <TableCell muted>{user.lastLoginAt ? formatTimestamp(String(user.lastLoginAt)) : 'Never'}</TableCell>
                    <TableCell align="right" className="py-2">
                      <div className="flex items-center justify-end gap-2">
                        {canAssignRoles ? (
                          <div className="w-40">
                            <Select
                              aria-label="Role"
                              className="h-[30px] text-label"
                              defaultValue={String(user.roleKey)}
                              disabled={rowPending(String(user.id), 'role')}
                              aria-busy={rowPending(String(user.id), 'role') || undefined}
                              onChange={(event) => {
                                const select = event.target;
                                // A rejected (or ignored) change must not leave the select showing the new role.
                                void accountAction(String(user.id), 'role', { roleKey: select.value }, () => {
                                  select.value = String(user.roleKey);
                                });
                              }}
                            >
                              <option value="SUPER_ADMIN">Super Admin</option>
                              <option value="HR_ADMIN">HR Admin</option>
                              <option value="MANAGER">Manager</option>
                              <option value="EMPLOYEE">Employee</option>
                            </Select>
                          </div>
                        ) : null}
                        {user.status !== 'INVITED' ? (
                          <Button
                            size="sm"
                            variant={user.status === 'ACTIVE' ? 'destructive' : 'secondary'}
                            loading={rowPending(String(user.id), 'status')}
                            loadingText={user.status === 'ACTIVE' ? 'Deactivating...' : 'Activating...'}
                            onClick={() =>
                              void accountAction(String(user.id), 'status', {
                                status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                              })
                            }
                          >
                            {user.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                        ) : null}
                        {user.status === 'INVITED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Send aria-hidden />}
                            loading={rowPending(String(user.id), 'resend')}
                            loadingText="Sending..."
                            onClick={() => void resendInvitation(String(user.id))}
                          >
                            Resend
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </SettingsCard>

      {canReadAudit ? (
        <AuditLogSection users={users.map((u) => ({ id: String(u.userId), label: String(u.name ?? u.email ?? u.userId) }))} />
      ) : null}
    </div>
  );
}

/** Surface card with a header row, matching the shared Section/Table surfaces. */
function SettingsCard({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-lg border border-line bg-surface shadow-sm">
      <div className="border-b border-line px-4 py-4 sm:px-6">
        <h2 id={`${id}-heading`} className="text-h3 font-semibold text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-small text-muted">{description}</p> : null}
      </div>
      <div className="px-4 py-5 sm:px-6">{children}</div>
    </section>
  );
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  ACCEPTED: 'success',
  PENDING: 'warning',
  INVITED: 'warning',
  EXPIRED: 'neutral',
  RESCINDED: 'neutral',
  DISABLED: 'danger',
};

/** API status code shown as a labelled badge (text + marker, never colour alone). */
function StatusBadge({ value }: { value: unknown }) {
  const code = String(value ?? '');
  if (!code) return <span className="text-muted">—</span>;
  const label = code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
  return <Badge variant={STATUS_VARIANT[code] ?? 'neutral'}>{label}</Badge>;
}
