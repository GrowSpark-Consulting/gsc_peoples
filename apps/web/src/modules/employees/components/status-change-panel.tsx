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
  const [dateError, setDateError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsDate = status === 'TERMINATED' || status === 'INACTIVE';
  const unchanged =
    status === employee.status &&
    (!needsDate || date === (employee.exitDate ?? employee.terminationDate ?? ''));

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
      <div>
        <Button type="submit" loading={saving} disabled={unchanged}>
          Update status
        </Button>
      </div>
    </form>
  );
}
