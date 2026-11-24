import {
  createEmployeeSchema,
  type CreateEmployee,
  type CreateEmployeeInput,
  type Employee,
  type EmploymentType,
  type UpdateEmployeeInput,
} from '@gsc/contracts';
import { fullName } from './format';

/** Every field is a string in the form; blanks become null when sent. */
export interface EmployeeFormValues {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  jobTitle: string;
  employmentType: EmploymentType;
  hireDate: string;
  departmentId: string;
  managerId: string;
}

export type FormField = keyof EmployeeFormValues;
export const FORM_FIELDS: readonly FormField[] = [
  'employeeNumber',
  'firstName',
  'lastName',
  'workEmail',
  'jobTitle',
  'employmentType',
  'hireDate',
  'departmentId',
  'managerId',
];

export const EMPTY_FORM: EmployeeFormValues = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  workEmail: '',
  jobTitle: '',
  employmentType: 'FULL_TIME',
  hireDate: '',
  departmentId: '',
  managerId: '',
};

export function valuesFromEmployee(e: Employee): EmployeeFormValues {
  return {
    employeeNumber: e.employeeNumber,
    firstName: e.firstName,
    lastName: e.lastName,
    workEmail: e.workEmail ?? '',
    jobTitle: e.jobTitle ?? '',
    employmentType: e.employmentType,
    hireDate: e.hireDate ?? '',
    departmentId: e.department?.id ?? '',
    managerId: e.manager?.id ?? '',
  };
}

export const managerLabel = (m: Employee['manager']) =>
  m ? `${fullName(m)} · ${m.employeeNumber}` : '';

const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

export function toPayload(v: EmployeeFormValues): CreateEmployeeInput {
  return {
    employeeNumber: v.employeeNumber,
    firstName: v.firstName,
    lastName: v.lastName,
    workEmail: v.workEmail.trim(), // required by the contract (PRD EMP-001)
    jobTitle: orNull(v.jobTitle),
    employmentType: v.employmentType,
    // The form field is labelled by its original name; the API stores it as the joining date (PRD) and keeps the
    // legacy hireDate in step, so both are sent.
    hireDate: orNull(v.hireDate),
    joiningDate: orNull(v.hireDate),
    departmentId: v.departmentId.trim(), // required by the contract (PRD EMP-001)
    managerId: orNull(v.managerId),
  };
}

const REQUIRED_MESSAGE: Partial<Record<FormField, string>> = {
  employeeNumber: 'Enter an employee number',
  firstName: 'Enter a first name',
  lastName: 'Enter a last name',
  workEmail: 'Enter a work email',
  departmentId: 'Choose a department',
};

export type FieldErrors = Partial<Record<FormField, string>>;
export type ValidationResult =
  { ok: true; data: CreateEmployee } | { ok: false; errors: FieldErrors };

/** Validates with the SAME schema the API uses, so client and server rules cannot drift. */
export function validateForm(values: EmployeeFormValues): ValidationResult {
  const result = createEmployeeSchema.safeParse(toPayload(values));
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FormField | undefined;
    if (!field || !FORM_FIELDS.includes(field) || field in errors) continue;
    const blank = values[field].trim() === '';
    errors[field] = blank && REQUIRED_MESSAGE[field] ? REQUIRED_MESSAGE[field] : issue.message;
  }
  return { ok: false, errors };
}

/** Only the fields that actually changed, normalised the same way the API stores them (PATCH body). */
export function diffForUpdate(original: Employee, next: CreateEmployee): UpdateEmployeeInput {
  const before = {
    employeeNumber: original.employeeNumber,
    firstName: original.firstName,
    lastName: original.lastName,
    workEmail: original.workEmail ?? null,
    jobTitle: original.jobTitle ?? null,
    employmentType: original.employmentType,
    hireDate: original.hireDate ?? null,
    departmentId: original.department?.id ?? null,
    managerId: original.manager?.id ?? null,
  };
  const after = {
    employeeNumber: next.employeeNumber,
    firstName: next.firstName,
    lastName: next.lastName,
    workEmail: next.workEmail ?? null,
    jobTitle: next.jobTitle ?? null,
    employmentType: next.employmentType,
    hireDate: next.hireDate ?? null,
    departmentId: next.departmentId ?? null,
    managerId: next.managerId ?? null,
  };
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    if (after[key] !== before[key]) diff[key] = after[key];
  }
  return diff as UpdateEmployeeInput;
}
