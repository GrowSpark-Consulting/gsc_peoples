'use client';

import type { Employee, UpdateEmployeeInput } from '@gsc/contracts';
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
import { useAsyncData } from '../hooks/use-async-data';
import { listDesignationOptions } from '../record-api';
import { useEmployeesContext } from '../state/employees-context';
import { IdentityDocumentFields } from '@/modules/identity-documents/identity-document-fields';
import { useIdentityUpload } from '@/modules/identity-documents/use-identity-upload';
import { ManagerPicker } from './manager-picker';

/** Stands in for a number the server will generate, so the rest of the form can be validated. */
const PLACEHOLDER_NUMBER = 'AUTO';

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

const generatedNumberResolver: Resolver<EmployeeFormValues> = (values, context, options) => {
  if (values.employeeNumber.trim() !== '') return resolver(values, context, options);
  const result = validateForm({ ...values, employeeNumber: PLACEHOLDER_NUMBER });
  if (result.ok) return { values, errors: {} };
  return { values: {}, errors: Object.fromEntries(Object.entries(result.errors).map(([field, message]) => [field, { type: 'validation', message }])) as never };
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
  const { service, session } = useEmployeesContext();
  const departments = useDepartments();
  // Designation and contact details exist on the real API; the development demo adapter does not model them.
  const live = service.kind === 'http';
  const isSuperAdmin = session.roleKey === 'SUPER_ADMIN';
  const designations = useAsyncData('designation-options', listDesignationOptions, live);
  const [extra, setExtra] = useState({
    designationId: employee?.designation?.id ?? '',
    phone: employee?.phone ?? '',
    address: employee?.address ?? '',
    emergencyContact: employee?.emergencyContact ?? '',
  });
  const [extraErrors, setExtraErrors] = useState<Record<string, string>>({});
  const setExtraValue = (key: keyof typeof extra, value: string) => setExtra((x) => ({ ...x, [key]: value }));
  // PRD W9: only a Super Admin changes the employee ID or an existing joining date.
  const lockNumber = live && mode === 'edit' && !isSuperAdmin;
  const lockJoining = lockNumber && Boolean(employee?.hireDate);
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim());
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Government ID is mandatory when adding an employee on the real API. Two steps: create the employee (the
  // unchanged employee endpoint), then upload the document. If step two fails the employee already exists, so
  // the form switches to a retry state that can only retry the upload (never create a second employee).
  const requireIdentity = live && mode === 'create';
  const identity = useIdentityUpload();
  const [created, setCreated] = useState<Employee | null>(null);
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
    // On the real API a new employee ID is generated when the field is left empty (PRD EMP-002).
    resolver: live && mode === 'create' ? generatedNumberResolver : resolver,
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

  const uploadIdentity = async (target: Employee) => {
    const input = identity.validate();
    if (!input) return;
    const r = await identity.submit(target.id, input);
    if (r.ok) onSaved(target);
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    setNotice(null);
    if (created) return; // retry has its own button; never create a second employee
    setExtraErrors({});
    const generate = live && mode === 'create' && values.employeeNumber.trim() === '';
    const checked = validateForm(generate ? { ...values, employeeNumber: PLACEHOLDER_NUMBER } : values);
    if (!checked.ok) return;
    // Validate the identity section up front, so the employee is never created with an invalid document.
    const identityInput = requireIdentity ? identity.validate() : null;
    if (live && mode === 'create') {
      // PRD EMP-001: joining date and designation are required.
      if (!values.hireDate) return setError('hireDate', { type: 'validation', message: 'Enter the joining date' });
      if (!extra.designationId) return setExtraErrors({ designationId: 'Choose a designation' });
    }
    if (requireIdentity && !identityInput) {
      setFormError('Complete the identity document section before creating the employee.');
      return;
    }
    try {
      if (mode === 'create') {
        const payload = toPayload(values);
        if (generate) delete payload.employeeNumber;
        const saved = await service.create(
          live
            ? { ...payload, designationId: extra.designationId, phone: orNull(extra.phone), address: orNull(extra.address), emergencyContact: orNull(extra.emergencyContact) }
            : payload,
        );
        if (!requireIdentity || !identityInput) {
          onSaved(saved);
          return;
        }
        setCreated(saved);
        const r = await identity.submit(saved.id, identityInput);
        if (r.ok) onSaved(saved);
        return;
      }
      if (!employee) throw new Error('Edit mode needs an employee');
      const changes: UpdateEmployeeInput = diffForUpdate(employee, checked.data);
      if (live) {
        if ((extra.designationId || null) !== (employee.designation?.id ?? null)) changes.designationId = extra.designationId || null;
        for (const key of ['phone', 'address', 'emergencyContact'] as const) {
          if (orNull(extra[key]) !== (employee[key] ?? null)) changes[key] = orNull(extra[key]);
        }
      }
      if (Object.keys(changes).length === 0) {
        setNotice('There are no changes to save.');
        return;
      }
      // A record changed by someone else since it was loaded is refused (PRD W9).
      onSaved(await service.update(employee.id, live ? { ...changes, expectedUpdatedAt: employee.updatedAt } : changes));
    } catch (e) {
      if (isApiError(e) && e.fieldErrors.designationId) setExtraErrors({ designationId: e.fieldErrors.designationId });
      showServerError(e);
    }
  }, () => {
    // Employee fields are invalid: show the identity section's problems at the same time.
    if (requireIdentity && !created) identity.validate();
  });

  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (!created || retrying) return;
    setRetrying(true);
    try {
      await uploadIdentity(created);
    } finally {
      setRetrying(false);
    }
  };

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

      {created ? (
        <Alert variant="warning" title="The employee was created, but the identity document was not saved.">
          {created.firstName} {created.lastName} ({created.employeeNumber}) now exists. {identity.error ?? 'The upload did not finish.'}{' '}
          Retry the upload below, or continue and add the document later from the employee&apos;s profile.
        </Alert>
      ) : null}

      <fieldset disabled={!!created} className="contents">
      <FormSection title="Identity">
        <Field
          label="Employee number"
          required={!(live && mode === 'create')}
          helper={
            live && mode === 'create'
              ? 'Leave empty to generate the next number. Must be unique.'
              : lockNumber
                ? 'Only a Super Admin can change the employee number.'
                : 'Entered by HR, for example GS-0100. Stored in upper case and must be unique.'
          }
          error={errors.employeeNumber?.message}
          autoComplete="off"
          readOnly={lockNumber}
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
          required={live && mode === 'create'}
          helper={lockJoining ? 'Only a Super Admin can change the joining date.' : undefined}
          error={errors.hireDate?.message}
          readOnly={lockJoining}
          {...register('hireDate')}
        />
        {live ? (
          <SelectField
            label="Designation"
            required={mode === 'create'}
            value={extra.designationId}
            onChange={(e) => setExtraValue('designationId', e.target.value)}
            error={extraErrors.designationId ?? (designations.status === 'error' ? 'Could not load designations. Reload the page to try again.' : undefined)}
            helper={designations.status === 'success' && (designations.data ?? []).length === 0 ? 'Add a designation on the Departments page first.' : undefined}
          >
            <option value="">No designation</option>
            {employee?.designation && !(designations.data ?? []).some((d) => d.id === employee.designation!.id) ? (
              <option value={employee.designation.id}>{employee.designation.name}</option>
            ) : null}
            {(designations.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        ) : null}
      </FormSection>

      {live ? (
        <FormSection title="Contact" description="Visible only to HR, Super Admins and the employee.">
          <Field label="Phone" value={extra.phone} onChange={(e) => setExtraValue('phone', e.target.value)} autoComplete="off" />
          <Field label="Address" value={extra.address} onChange={(e) => setExtraValue('address', e.target.value)} autoComplete="off" />
          <Field label="Emergency contact" value={extra.emergencyContact} onChange={(e) => setExtraValue('emergencyContact', e.target.value)} autoComplete="off" />
        </FormSection>
      ) : null}

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
      </fieldset>

      {requireIdentity ? (
        <section aria-labelledby="identity-section-title" className="flex min-w-0 flex-col gap-4">
          <div>
            <h3 id="identity-section-title" className="text-h3 font-semibold text-ink">
              Government ID / Identity proof
            </h3>
            <p className="mt-0.5 text-small text-muted">Required. Stored privately; only HR, Super Admins and the employee can view it.</p>
          </div>
          <IdentityDocumentFields
            draft={identity.draft}
            onChange={identity.setDraft}
            errors={identity.errors}
            onFieldError={identity.setFieldError}
            disabled={identity.uploading}
            progress={identity.progress}
            audience="hr"
          />
          {identity.error && !created ? <Alert variant="danger" title="The identity document was not saved.">{identity.error}</Alert> : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {created ? (
          <Button type="button" onClick={retry} loading={retrying} loadingText="Uploading…">
            Retry document upload
          </Button>
        ) : (
          <Button type="submit" loading={isSubmitting}>
            {mode === 'create' ? 'Create employee' : 'Save changes'}
          </Button>
        )}
        {created ? (
          <Button variant="secondary" onClick={() => onSaved(created)} disabled={retrying}>
            Continue without document
          </Button>
        ) : (
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
