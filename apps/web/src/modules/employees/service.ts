import type {
  ChangeEmployeeStatusInput,
  CreateEmployeeInput,
  Employee,
  EmployeeListQueryInput,
  EmployeeListResponse,
  UpdateEmployeeInput,
} from '@gsc/contracts';

export interface DepartmentOption {
  id: string;
  name: string;
}

/**
 * The Employee Directory's only dependency on a backend. Two adapters implement it:
 *  - `createHttpEmployeesService` talks to the real API (`/api/v1/employees`, `/departments`).
 *  - `createDemoEmployeesService` is an in-memory DEMO adapter for frontend development and tests.
 * Both throw `ApiError` with the same status/code semantics as the API.
 */
export interface EmployeesService {
  readonly kind: 'demo' | 'http';
  list(query: EmployeeListQueryInput): Promise<EmployeeListResponse>;
  get(id: string): Promise<Employee>;
  create(input: CreateEmployeeInput): Promise<Employee>;
  update(id: string, input: UpdateEmployeeInput): Promise<Employee>;
  changeStatus(id: string, input: ChangeEmployeeStatusInput): Promise<Employee>;
  listDepartments(): Promise<DepartmentOption[]>;
}
