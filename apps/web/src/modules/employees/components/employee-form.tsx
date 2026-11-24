'use client';

import type { Employee } from '@gsc/contracts';
import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { FormError, FormSection } from '@/components/shared/form-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select';
import { describeError, isApiError } from '../errors';
import type { ManagerOption } from '../filters';
import {
  diffForUpdate,
  EMPTY_FORM,
  FORM_FIELDS,
  managerLabel,
  toPayload,
  validateForm,
  valuesFromEmployee,
  type EmployeeFormValues,
  type FormField,
} from '../form-model';
import { TYPE_LABEL } from '../format';
import { useDepartments } from '../hooks/use-employees';
import { useEmployeesContext } from '../state/employees-context';
import { ManagerPicker } from './manager-picker';

const resolver: Resolver<EmployeeFormValues> = (values) => {
  const result = validateForm(values);
  if (result.ok) return { values, errors: {} };
  return {
    values: {},
    errors: Object.fromEntries(
      Object.entries(result.errors).map(([field, message]) => [
        field,
        { type: 'validation', message },
      ]),
    ) as never,
  };
};

export interface EmployeeFormProps {
  mode: 'create' | 'edit';
  /** Required in edit mode. */
  employee?: Employee;
  onSaved: (employee: Employee) => void;
  onCancel: () => void;
}

/**
 * Create / edit form. Validation uses the shared API contract; server errors (field validation,
 * duplicate number/email, unknown department or manager, cycles, permission) are shown against the
 * right field or in a form-level alert. Status is changed separately (see StatusChangePanel).
 */
export function EmployeeForm({ mode, employee, onSaved, onCancel }: EmployeeFormProps) {
  const { service } = useEmployeesContext();
  const departments = useDepartments();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manager, setManager] = useState<ManagerOption | null>(
    employee?.manager ? { id: employee.manager.id, label: managerLabel(employee.manager) } : null,
  );

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    defaultValues: employee ? valuesFromEmployee(employee) : EMPTY_FORM,
    resolver,
  });

  const showServerError = (e: unknown) => {
    let placed = false;
    const place = (field: FormField, message: string) => {
      setError(field, { type: 'server', message });
      placed = true;
    };
    if (isApiError(e)) {
      for (const [field, message] of Object.entries(e.fieldErrors)) {
        if ((FORM_FIELDS as readonly string[]).includes(field)) place(field as FormField, message);
      }
      if (!placed && e.status === 404 && /department/i.test(e.message))
        place('departmentId', e.message);
      if (!placed && e.status === 404 && /manager/i.test(e.message)) place('managerId', e.message);
      if (!placed && /report, directly or indirectly/i.test(e.message))
        place('managerId', e.message);
      if (placed) {
        setFormError(null);
        return;
      }
      setFormError(e.status === 400 || e.status === 409 ? e.message : describeError(e));
      return;
    }
    setFormError(describeError(e));
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    setNotice(null);
    const checked = validateForm(values);
    if (!checked.ok) return;
    try {
      if (mode === 'create') {
        onSaved(await service.create(toPayload(values)));
        return;
      }
      if (!employee) throw new Error('Edit mode needs an employee');
      const changes = diffForUpdate(employee, checked.data);
      if (Object.keys(changes).length === 0) {
        setNotice('There are no changes to save.');
        return;
      }
      onSaved(await service.update(employee.id, changes));
    } catch (e) {
      showServerError(e);
    }
  });

  const departmentOptions = [...(departments.data ?? [])];
  if (employee?.department && !departmentOptions.some((d) => d.id === employee.department!.id)) {
    departmentOptions.push(employee.department); // keep the current value selectable while the list loads
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex max-w-3xl flex-col gap-8"
      aria-label={mode === 'create' ? 'Add employee' : 'Edit employee'}
    >
      <FormError message={formError} />
      {notice ? <Alert variant="info">{notice}</Alert> : null}

      <FormSection title="Identity">
        <Field
          label="Employee number"
          required
          helper="Entered by HR, for example GS-0100. Stored in upper case and must be unique."
          error={errors.employeeNumber?.message}
          autoComplete="off"
          {...register('employeeNumber')}
        />
        <Field
          label="Work email"
          type="email"
          error={errors.workEmail?.message}
          autoComplete="off"
          {...register('workEmail')}
        />
        <Field
          label="First name"
          required
          error={errors.firstName?.message}
          autoComplete="off"
          {...register('firstName')}
        />
        <Field
          label="Last name"
          required
          error={errors.lastName?.message}
          autoComplete="off"
          {...register('lastName')}
        />
      </FormSection>

      <FormSection title="Employment">
        <Field
          label="Job title"
          error={errors.jobTitle?.message}
          autoComplete="off"
          {...register('jobTitle')}
        />
        <SelectField
          label="Employment type"
          error={errors.employmentType?.message}
          {...register('employmentType')}
        >
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <Field
          label="Hire date"
          type="date"
          error={errors.hireDate?.message}
          {...register('hireDate')}
        />
      </FormSection>

      <FormSection
        title="Reporting"
        description="Where this person sits in the organisation. Both are optional."
      >
        <SelectField
          label="Department"
          error={
            errors.departmentId?.message ??
            (departments.status === 'error'
              ? 'Could not load departments. Reload the page to try again.'
              : undefined)
          }
          disabled={departments.status === 'loading'}
          helper={departments.status === 'loading' ? 'Loading departments…' : undefined}
          {...register('departmentId')}
        >
          <option value="">No department</option>
          {departmentOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <ManagerPicker
          label="Manager"
          value={manager}
          excludeId={employee?.id}
          error={errors.managerId?.message}
          onChange={(next) => {
            setManager(next);
            setValue('managerId', next?.id ?? '', { shouldDirty: true });
          }}
        />
      </FormSection>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isSubmitting}>
          {mode === 'create' ? 'Create employee' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
