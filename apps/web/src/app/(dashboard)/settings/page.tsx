'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AccessDeniedState } from '@/components/shared/data-states';
import { hasPermission, PERMISSIONS, useSession } from '@/hooks/use-session';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import { listEmployeesForInvite } from '@/modules/settings/api';
import { formatTimestamp } from '@/modules/employees/format';
import { AuditLogSection } from '@/modules/settings/audit-log-section';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

function csrfToken() {
  return document.cookie.split('; ').find((row) => row.startsWith('gsc_csrf='))?.slice('gsc_csrf='.length) ?? '';
}

export default function SettingsPage() {
  const [company, setCompany] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [users, setUsers] = useState<Record<string, unknown>[]>([]);
  const [reloadUsers, setReloadUsers] = useState(0);
  const session = useSession();
  // The API enforces every rule; these only hide controls the caller's role cannot use (PRD section 5).
  const can = (p: Parameters<typeof hasPermission>[1]) => session.status === 'ready' && hasPermission(session.session, p);
  const canEditCompany = can(PERMISSIONS.SETTINGS_WRITE);
  const canAssignRoles = can(PERMISSIONS.USER_ROLE_MANAGE);
  const canReadAudit = can(PERMISSIONS.AUDIT_READ);
  const canReadSettings = can(PERMISSIONS.SETTINGS_READ);
  // Employees who do not have a login yet can be invited; choosing one links the account to the record.
  const candidates = useAsyncData(`settings:invitees:${reloadUsers}`, listEmployeesForInvite, can(PERMISSIONS.USER_ACCOUNT_READ));
  const invitees = (candidates.data ?? []).filter((e) => e.invitationStatus === 'NOT_INVITED' && e.workEmail && e.status !== 'INACTIVE' && e.status !== 'TERMINATED');

  useEffect(() => {
    fetch(`${API}/settings/company`, { credentials: 'include' })
      .then(async (response) => ({ response, body: await response.json().catch(() => undefined) }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body?.error?.message ?? 'Could not load company');
        setCompany(body.data);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load company'));
  }, []);

  useEffect(() => {
    fetch(`${API}/settings/users`, { credentials: 'include' })
      .then(async (response) => ({ response, body: await response.json().catch(() => undefined) }))
      .then(({ response, body }) => {
        if (response.ok) setUsers(body.data);
      })
      .catch(() => undefined);
  }, [reloadUsers]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const target = event.currentTarget; // React clears `currentTarget` after the first await
    const form = new FormData(target);
    const response = await fetch(`${API}/settings/users/invite`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
      body: JSON.stringify({
        email: String(form.get('email')),
        name: String(form.get('name') || '') || undefined,
        employeeId: String(form.get('employeeId') || '') || undefined,
        roleKey: String(form.get('roleKey')),
      }),
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      setError(body?.error?.message ?? 'Could not create invitation');
      return;
    }
    setMessage('Invitation emailed. The link works for seven days.');
    target.reset();
    setReloadUsers((n) => n + 1);
  }

  async function accountAction(membershipId: string, path: string, body: Record<string, string>) {
    setError('');
    setMessage('');
    const response = await fetch(`${API}/settings/users/${membershipId}/${path}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
      body: JSON.stringify(body),
    });
    const responseBody = await response.json().catch(() => undefined);
    if (!response.ok) {
      setError(responseBody?.error?.message ?? 'Account action failed');
      return;
    }
    setMessage('Account updated.');
    setReloadUsers((n) => n + 1);
  }

  async function resendInvitation(membershipId: string) {
    setError('');
    setMessage('');
    const response = await fetch(`${API}/settings/users/${membershipId}/invitations/resend`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrfToken() },
    });
    const responseBody = await response.json().catch(() => undefined);
    if (!response.ok) {
      setError(responseBody?.error?.message ?? 'Could not resend invitation');
      return;
    }
    setMessage('Invitation emailed again. Earlier links no longer work.');
    setReloadUsers((n) => n + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${API}/settings/company`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
      body: JSON.stringify({
        name: String(form.get('name')),
        logoUrl: String(form.get('logoUrl') || '') || null,
        timezone: String(form.get('timezone')),
        workingDays: form.getAll('workingDays').map((day) => Number(day)),
        workStartTime: String(form.get('workStartTime')),
        workEndTime: String(form.get('workEndTime')),
      }),
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      setError(body?.error?.message ?? 'Could not save settings');
    } else {
      setCompany(body.data);
      setMessage('Company settings saved.');
    }
  }

  if (session.status === 'ready' && !canReadSettings) return <AccessDeniedState />;

  if (!company) {
    return <div role="status" className="text-sm text-[#737373]">{error || 'Loading company settings...'}</div>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Company settings</h1>
      <form onSubmit={save} className="mt-6 border border-[#E5E5E5] bg-white p-5">
        {!canEditCompany ? <p className="mb-4 text-sm text-[#737373]">Only a Super Admin can change company settings.</p> : null}
        <fieldset disabled={!canEditCompany} className="grid min-w-0 gap-5">
        <label className="grid gap-2 text-sm font-medium">
          Company name
          <input name="name" defaultValue={String(company.name)} required className="h-10 border border-[#E5E5E5] px-3 font-normal" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Logo URL
          <input name="logoUrl" type="url" defaultValue={String(company.logoUrl ?? '')} className="h-10 border border-[#E5E5E5] px-3 font-normal" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Timezone
          <input name="timezone" defaultValue={String(company.timezone)} required className="h-10 border border-[#E5E5E5] px-3 font-normal" />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Working days</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'],
              ['5', 'Friday'], ['6', 'Saturday'], ['7', 'Sunday'],
            ].map(([value, label]) => (
              <label key={value} className="flex h-10 items-center gap-2 border border-[#E5E5E5] px-3 text-sm">
                <input
                  type="checkbox"
                  name="workingDays"
                  value={value}
                  defaultChecked={Array.isArray(company.workingDays) && company.workingDays.includes(Number(value))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Work start
            <input name="workStartTime" type="time" defaultValue={String(company.workStartTime)} required className="h-10 border border-[#E5E5E5] px-3 font-normal" />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Work end
            <input name="workEndTime" type="time" defaultValue={String(company.workEndTime)} required className="h-10 border border-[#E5E5E5] px-3 font-normal" />
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {canEditCompany ? <button className="h-10 w-full bg-[#090909] text-sm font-medium text-white sm:w-40">Save settings</button> : null}
        </fieldset>
      </form>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">User accounts</h2>
        <form onSubmit={invite} className="mt-4 grid gap-4 border border-[#E5E5E5] bg-white p-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">Email<input name="email" type="email" required className="h-10 border border-[#E5E5E5] px-3 font-normal" /></label>
          <label className="grid gap-2 text-sm font-medium">Name<input name="name" className="h-10 border border-[#E5E5E5] px-3 font-normal" /></label>
          <label className="grid gap-2 text-sm font-medium">Employee record (optional)<select name="employeeId" defaultValue="" onChange={(event) => { const chosen = invitees.find((e) => e.id === event.target.value); const email = event.target.form?.elements.namedItem('email'); if (chosen?.workEmail && email instanceof HTMLInputElement) email.value = chosen.workEmail; }} className="h-10 border border-[#E5E5E5] px-3 font-normal"><option value="">Not linked to an employee</option>{invitees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.employeeNumber}</option>)}</select></label>
          <label className="grid gap-2 text-sm font-medium">Role<select name="roleKey" required defaultValue="EMPLOYEE" className="h-10 border border-[#E5E5E5] px-3 font-normal">{canAssignRoles ? <><option value="SUPER_ADMIN">Super Admin</option><option value="HR_ADMIN">HR Admin</option></> : null}<option value="MANAGER">Manager</option><option value="EMPLOYEE">Employee</option></select></label>
          <button className="h-10 w-full bg-[#090909] text-sm font-medium text-white sm:w-40">Create invitation</button>
        </form>
        {users.length === 0 ? <p className="mt-4 text-sm text-[#737373]">No user accounts.</p> : <div className="mt-4 overflow-x-auto border border-[#E5E5E5]"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-[#E5E5E5] bg-[#F5F5F5]"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Account</th><th className="p-3">Invitation</th><th className="p-3">Last login</th><th className="p-3">Actions</th></tr></thead><tbody>{users.map((user) => <tr key={String(user.id)} className="border-b border-[#E5E5E5]"><td className="p-3">{String(user.name ?? user.email ?? '')}<span className="block text-xs text-[#737373]">{String(user.email ?? '')}</span></td><td className="p-3">{String(user.roleName ?? user.roleKey ?? '')}</td><td className="p-3">{String(user.accountStatus ?? '')}</td><td className="p-3">{String(user.invitationStatus ?? '')}</td><td className="p-3">{user.lastLoginAt ? formatTimestamp(String(user.lastLoginAt)) : 'Never'}</td><td className="p-3"><div className="flex flex-wrap gap-2">{user.status !== 'INVITED' ? <button type="button" className="h-8 border border-[#E5E5E5] px-2" onClick={() => accountAction(String(user.id), 'status', { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>{user.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button> : null}{user.status === 'INVITED' ? <button type="button" className="h-8 border border-[#E5E5E5] px-2" onClick={() => resendInvitation(String(user.id))}>Resend</button> : null}{canAssignRoles ? <select aria-label="Role" className="h-8 border border-[#E5E5E5] px-2" defaultValue={String(user.roleKey)} onChange={(event) => accountAction(String(user.id), 'role', { roleKey: event.target.value })}><option value="SUPER_ADMIN">Super Admin</option><option value="HR_ADMIN">HR Admin</option><option value="MANAGER">Manager</option><option value="EMPLOYEE">Employee</option></select> : null}</div></td></tr>)}</tbody></table></div>}
      </section>

      {canReadAudit ? (
        <div className="mt-8">
          <AuditLogSection users={users.map((u) => ({ id: String(u.userId), label: String(u.name ?? u.email ?? u.userId) }))} />
        </div>
      ) : null}
    </div>
  );
}
