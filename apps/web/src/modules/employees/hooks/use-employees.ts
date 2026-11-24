'use client';

import type { EmployeeListQueryInput } from '@gsc/contracts';
import { useEmployeesContext } from '../state/employees-context';
import { useAsyncData } from './use-async-data';

export function useEmployeeList(query: EmployeeListQueryInput) {
  const { service } = useEmployeesContext();
  return useAsyncData(`list:${JSON.stringify(query)}`, () => service.list(query));
}

export function useEmployee(id: string) {
  const { service } = useEmployeesContext();
  return useAsyncData(`get:${id}`, () => service.get(id));
}

/** Departments for filters and assignment. Skipped (no request) when the caller may not list them. */
export function useDepartments() {
  const { service, caps } = useEmployeesContext();
  return useAsyncData('departments', () => service.listDepartments(), caps.canListDepartments);
}
