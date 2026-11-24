/**
 * DEMO DATA: fictional people for frontend development and tests. Not real, not from any database.
 * Shaped exactly like the approved Employee schema (no fields beyond it).
 */
import type { EmploymentStatus, EmploymentType } from '@gsc/contracts';

export const DEMO_COMPANY_LABEL = 'Demo company (fictional data)';

/** Valid RFC-4122 v4-shaped ids so the real contract schemas accept them. */
export const demoUuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export interface DemoDepartment {
  id: string;
  name: string;
}

export interface DemoRow {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  hireDate: string | null;
  terminationDate: string | null;
  departmentId: string | null;
  managerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEPT = {
  engineering: demoUuid(1001),
  people: demoUuid(1002),
  finance: demoUuid(1003),
  sales: demoUuid(1004),
  operations: demoUuid(1005),
} as const;

export const DEMO_DEPARTMENTS: DemoDepartment[] = [
  { id: DEPT.engineering, name: 'Engineering' },
  { id: DEPT.people, name: 'People & Culture' },
  { id: DEPT.finance, name: 'Finance' },
  { id: DEPT.sales, name: 'Sales' },
  { id: DEPT.operations, name: 'Operations' },
];

type Spec = [
  n: number,
  first: string,
  last: string,
  title: string,
  dept: keyof typeof DEPT,
  mgr: number | null,
  type?: EmploymentType,
  status?: EmploymentStatus,
  hire?: string,
  term?: string,
];

const SPECS: Spec[] = [
  [1, 'Meera', 'Nair', 'Head of People', 'people', null, 'FULL_TIME', 'ACTIVE', '2019-04-01'],
  [2, 'Arjun', 'Rao', 'VP Engineering', 'engineering', null, 'FULL_TIME', 'ACTIVE', '2018-06-11'],
  [
    3,
    'Kavya',
    'Menon',
    'Engineering Manager',
    'engineering',
    2,
    'FULL_TIME',
    'ACTIVE',
    '2020-02-17',
  ],
  [4, 'Rohan', 'Iyer', 'Software Engineer', 'engineering', 3, 'FULL_TIME', 'ACTIVE', '2021-08-02'],
  [
    5,
    'Ananya',
    'Sharma',
    'Software Engineer',
    'engineering',
    3,
    'FULL_TIME',
    'ACTIVE',
    '2022-01-10',
  ],
  [6, 'Vikram', 'Singh', 'Senior Engineer', 'engineering', 3, 'FULL_TIME', 'ACTIVE', '2020-09-21'],
  [7, 'Ishita', 'Patel', 'QA Engineer', 'engineering', 3, 'FULL_TIME', 'ON_LEAVE', '2021-03-15'],
  [8, 'Karthik', 'Reddy', 'DevOps Engineer', 'engineering', 3, 'CONTRACT', 'ACTIVE', '2023-05-08'],
  [
    9,
    'Sneha',
    'Kulkarni',
    'Engineering Intern',
    'engineering',
    3,
    'INTERN',
    'ONBOARDING',
    '2026-10-26',
  ],
  [10, 'Rahul', 'Verma', 'Finance Manager', 'finance', null, 'FULL_TIME', 'ACTIVE', '2019-11-04'],
  [11, 'Divya', 'Joshi', 'Accountant', 'finance', 10, 'FULL_TIME', 'ACTIVE', '2022-07-18'],
  [
    12,
    'Amit',
    'Shah',
    'Accountant',
    'finance',
    10,
    'FULL_TIME',
    'TERMINATED',
    '2021-02-01',
    '2026-06-30',
  ],
  [13, 'Neha', 'Gupta', 'Head of Sales', 'sales', null, 'FULL_TIME', 'ACTIVE', '2019-01-14'],
  [14, 'Sanjay', 'Kumar', 'Sales Executive', 'sales', 13, 'FULL_TIME', 'ACTIVE', '2022-04-25'],
  [15, 'Pooja', 'Desai', 'Sales Executive', 'sales', 13, 'FULL_TIME', 'ACTIVE', '2023-02-13'],
  [16, 'Manoj', 'Pillai', 'Sales Associate', 'sales', 13, 'PART_TIME', 'ACTIVE', '2024-01-08'],
  [
    17,
    'Farhan',
    'Qureshi',
    'Operations Manager',
    'operations',
    null,
    'FULL_TIME',
    'ACTIVE',
    '2020-06-01',
  ],
  [
    18,
    'Lakshmi',
    'Narayanan',
    'Operations Executive',
    'operations',
    17,
    'FULL_TIME',
    'ACTIVE',
    '2021-10-11',
  ],
  [
    19,
    'Deepak',
    'Chauhan',
    'Operations Executive',
    'operations',
    17,
    'FULL_TIME',
    'ACTIVE',
    '2022-12-05',
  ],
  [20, 'Ritu', 'Agarwal', 'HR Executive', 'people', 1, 'FULL_TIME', 'ACTIVE', '2021-05-24'],
  [21, 'Suresh', 'Babu', 'HR Consultant', 'people', 1, 'CONTRACT', 'ACTIVE', '2024-03-04'],
  [
    22,
    'Aditya',
    'Sharma',
    'Software Engineer',
    'engineering',
    3,
    'FULL_TIME',
    'ACTIVE',
    '2023-09-18',
  ],
  [23, 'Hardik', 'Patel', 'Sales Executive', 'sales', 13, 'FULL_TIME', 'ACTIVE', '2023-07-03'],
  [24, 'Simran', 'Singh', 'HR Executive', 'people', 1, 'FULL_TIME', 'ACTIVE', '2022-11-14'],
  // Same first AND last name as #10, to exercise the stable id tie-break in sorting and paging.
  [
    25,
    'Rahul',
    'Verma',
    'Operations Executive',
    'operations',
    17,
    'FULL_TIME',
    'ACTIVE',
    '2024-06-17',
  ],
  [
    26,
    'Tanvi',
    'Bhatt',
    'Software Engineer',
    'engineering',
    3,
    'FULL_TIME',
    'ACTIVE',
    '2024-08-05',
  ],
  [27, 'Yash', 'Malhotra', 'Finance Analyst', 'finance', 10, 'FULL_TIME', 'ACTIVE', '2024-09-02'],
  [28, 'Zoya', 'Khan', 'Sales Executive', 'sales', 13, 'FULL_TIME', 'ACTIVE', '2025-01-20'],
  [
    29,
    'Nikhil',
    'Bose',
    'Operations Executive',
    'operations',
    17,
    'FULL_TIME',
    'ON_LEAVE',
    '2023-03-27',
  ],
  [30, 'Aarti', 'Mishra', 'Recruiter', 'people', 1, 'FULL_TIME', 'ACTIVE', '2025-02-10'],
  [
    31,
    'Gaurav',
    'Saxena',
    'Software Engineer',
    'engineering',
    3,
    'FULL_TIME',
    'ACTIVE',
    '2025-03-17',
  ],
  [32, 'Bhavna', 'Trivedi', 'Accountant', 'finance', 10, 'PART_TIME', 'ACTIVE', '2025-05-12'],
  [33, 'Chetan', 'Ghosh', 'Sales Executive', 'sales', 13, 'FULL_TIME', 'ACTIVE', '2025-06-23'],
  [
    34,
    'Esha',
    'Kapoor',
    'Operations Executive',
    'operations',
    17,
    'CONTRACT',
    'ACTIVE',
    '2025-07-07',
  ],
  [
    35,
    'Harsh',
    'Vora',
    'Software Engineer',
    'engineering',
    3,
    'FULL_TIME',
    'ONBOARDING',
    '2026-11-02',
  ],
  [36, 'Jaya', 'Rangan', 'HR Intern', 'people', 1, 'INTERN', 'ONBOARDING', '2026-11-09'],
];

const CREATED = '2026-01-05T09:00:00.000Z';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export function buildDemoRows(): DemoRow[] {
  const seenEmails = new Map<string, number>();
  return SPECS.map(
    ([n, first, last, title, dept, mgr, type = 'FULL_TIME', status = 'ACTIVE', hire, term]) => {
      const base = `${slug(first)}.${slug(last)}`;
      const count = (seenEmails.get(base) ?? 0) + 1;
      seenEmails.set(base, count);
      return {
        id: demoUuid(n),
        employeeNumber: `GS-${String(n).padStart(4, '0')}`,
        firstName: first,
        lastName: last,
        workEmail: `${base}${count > 1 ? count : ''}@growspark.example`,
        jobTitle: title,
        employmentType: type,
        status,
        hireDate: hire ?? null,
        terminationDate: term ?? null,
        departmentId: DEPT[dept],
        managerId: mgr ? demoUuid(mgr) : null,
        createdAt: CREATED,
        updatedAt: CREATED,
      };
    },
  );
}

export const DEMO_IDS = {
  hrAdmin: demoUuid(1), // Meera Nair
  manager: demoUuid(3), // Kavya Menon: many direct reports in the seed
  employee: demoUuid(4), // Rohan Iyer: reports to Kavya
  otherTeamMember: demoUuid(14), // Sanjay Kumar: reports to Neha, NOT in Kavya's scope
} as const;
