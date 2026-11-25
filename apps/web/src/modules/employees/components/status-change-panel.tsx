'use client';

import type { Employee, EmploymentStatus } from '@gsc/contracts';
import { useState } from 'react';
import { FormError } from '@/components/shared/form-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select';
import { describeError, isApiError } from '../errors';
import { STATUS_LABEL } from '../format';
import { useEmployeesContext } from '../state/employees-context';

/** HR-only. A terminated or inactive employee must have an exit date; other statuses clear it. */
export function StatusChangePanel({
  employee,
  onChanged,
}: {
  employee: Employee;
  onChanged: (e: Employee) => void;
}) {
  const { service } = useEmployeesContext();
  const [status, setStatus] = useState<EmploymentStatus>(employee.status);
  const [date, setDate] = useState(employee.terminationDate ?? '');
  const [noticeDate, setNoticeDate] = useState(employee.status === 'ON_NOTICE' ? (employee.exitDate ?? '') : '');
  const [noManager, setNoManager] = useState(false);
  const [dateError, setDateError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsDate = status === 'TERMINATED' || status === 'INACTIVE';
  const unchanged =
    status === employee.status &&
    (!needsDate || date === (employee.exitDate ?? employee.terminationDate ?? '')) &&
    (status !== 'ON_NOTICE' || noticeDate === (employee.exitDate ?? ''));
  // PRD W3: becoming Active needs a manager, or an explicit statement that there is none.
  const asksNoManager = status === 'ACTIVE' && employee.status !== 'ACTIVE' && !employee.manager;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setDateError(undefined);
    if (needsDate && !date) {
      setDateError(status === 'INACTIVE' ? 'Enter the exit date' : 'Enter the termination date');
      return;
    }
    setSaving(true);
    try {
      const updated = await service.changeStatus(
        employee.id,
        status === 'TERMINATED'
          ? { status, terminationDate: date }
          : status === 'INACTIVE'
            ? { status, exitDate: date }
            : status === 'ON_NOTICE'
              ? { status, ...(noticeDate ? { exitDate: noticeDate } : {}) }
              : status === 'ACTIVE'
                ? { status, ...(asksNoManager && noManager ? { noManager: true } : {}) }
                : { status },
      );
      onChanged(updated);
    } catch (err) {
      if (isApiError(err) && err.fieldErrors.terminationDate)
        setDateError(err.fieldErrors.terminationDate);
      else if (isApiError(err) && /termination date/i.test(err.message)) setDateError(err.message);
      else
        setFormError(
          isApiError(err) && (err.status === 400 || err.status === 409)
            ? err.message
            : describeError(err),
        );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Change employment status"
      className="flex flex-col gap-4"
    >
      <FormError title="Could not change status." message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as EmploymentStatus)}
        >
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        {status === 'ON_NOTICE' ? (
          <Field label="Last working date" type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} helper="Optional." />
        ) : null}
        {needsDate ? (
          <Field
            label={status === 'INACTIVE' ? 'Exit date' : 'Termination date'}
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={dateError}
            helper={
              status === 'INACTIVE'
                ? 'Required when an employee is made inactive.'
                : 'Required when an employee is terminated.'
            }
          />
        ) : null}
      </div>
      {asksNoManager ? (
        <label className="flex items-start gap-2 text-body text-ink">
          <input type="checkbox" className="mt-1" checked={noManager} onChange={(e) => setNoManager(e.target.checked)} />
          <span>This person has no manager (top-level staff).</span>
        </label>
      ) : null}
      {needsDate && employee.status !== status ? (
        <p className="text-small text-muted">Their login is disabled, pending leave and corrections are cancelled, and direct reports need a new manager.</p>
      ) : null}
      <div>
        <Button type="submit" loading={saving} disabled={unchanged}>
          Update status
        </Button>
      </div>
    </form>
  );
}
