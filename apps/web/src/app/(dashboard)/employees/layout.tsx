import { EmployeesProviders } from '@/modules/employees/state/employees-providers';

export default function EmployeesLayout({ children }: { children: React.ReactNode }) {
  return <EmployeesProviders>{children}</EmployeesProviders>;
}
