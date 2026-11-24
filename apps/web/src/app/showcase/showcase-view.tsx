'use client';

import {
  Building2,
  CalendarDays,
  Download,
  LayoutDashboard,
  Plus,
  Trash2,
  Users,
  Wallet,
  Clock,
  FileText,
  Settings,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { Sidebar, type SidebarSection } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { StatCard } from '@/components/ui/stat-card';
import {
  PersonCell,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { formatINR } from '@/lib/format';

const NAV: SidebarSection[] = [
  {
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'employees', label: 'Employees', icon: Users, badge: 128 },
      { id: 'departments', label: 'Departments', icon: Building2, badge: 9 },
      { id: 'leave', label: 'Leave', icon: CalendarDays },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { id: 'attendance', label: 'Attendance', icon: Clock },
      { id: 'payroll', label: 'Payroll', icon: Wallet },
      { id: 'documents', label: 'Documents', icon: FileText },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

type Status = 'active' | 'on-leave' | 'probation' | 'exited';

const STATUS: Record<Status, { label: string; variant: 'success' | 'warning' | 'info' | 'danger' }> = {
  active: { label: 'Active', variant: 'success' },
  'on-leave': { label: 'On leave', variant: 'warning' },
  probation: { label: 'In probation', variant: 'info' },
  exited: { label: 'Exited', variant: 'danger' },
};

const PEOPLE: {
  id: string;
  name: string;
  department: string;
  status: Status;
  salary: number;
  manager: string;
}[] = [
  { id: 'EMP-00412', name: 'Ananya Krishnan', department: 'Transparent Industries', status: 'probation', salary: 120000, manager: 'Praga' },
  { id: 'EMP-00318', name: 'Rahul Subramanian', department: 'Chelliah Enterprises', status: 'active', salary: 85000, manager: 'Raja' },
  { id: 'EMP-00277', name: 'Meena Thomas', department: 'Harbour Logistics', status: 'on-leave', salary: 240000, manager: 'Venkat' },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
      <h2 id={`${id}-h`} className="mb-4 text-h2 font-semibold">
        {title}
      </h2>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Demo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-label font-medium text-muted">{title}</h3>
      {children}
    </div>
  );
}

export function ShowcaseView() {
  const [activeId, setActiveId] = useState('employees');
  const [alertOpen, setAlertOpen] = useState(true);
  const [dataState, setDataState] = useState<'data' | 'loading' | 'empty'>('data');
  const [saving, setSaving] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <h1 className="truncate text-h1 font-semibold">Component showcase</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-[1440px] flex-col gap-12 px-4 py-8 sm:px-6">
        <Section id="button" title="Button">
          <Demo title="Variants">
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={<Plus />}>New employee</Button>
              <Button variant="secondary" icon={<Download />}>
                Export
              </Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="destructive" icon={<Trash2 />}>
                Delete
              </Button>
            </div>
          </Demo>
          <Demo title="Sizes: 30, 36 and 44px">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary">
                Small
              </Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" variant="secondary" aria-label="Add employee">
                <UserPlus />
              </Button>
            </div>
          </Demo>
          <Demo title="States: disabled and loading (click to toggle)">
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled>Disabled</Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
              <Button
                loading={saving}
                onClick={() => {
                  setSaving(true);
                  setTimeout(() => setSaving(false), 1800);
                }}
              >
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
              <Button loading>Saving...</Button>
            </div>
          </Demo>
        </Section>

        <Section id="badge" title="Badge">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="success">Active</Badge>
            <Badge variant="warning">Pending approval</Badge>
            <Badge variant="danger">Overdue</Badge>
            <Badge variant="info">In review</Badge>
            <Badge variant="accent">New</Badge>
            <Badge variant="neutral">Draft</Badge>
          </div>
        </Section>

        <Section id="alert" title="Alert">
          <div className="grid gap-3 lg:grid-cols-2">
            <Alert variant="info" title="Payroll runs on the 28th.">
              Approve pending timesheets before then.
            </Alert>
            <Alert
              variant="success"
              title="Leave approved."
              action={
                <Button size="sm" variant="secondary">
                  View
                </Button>
              }
            >
              The employee has been notified by email.
            </Alert>
            <Alert variant="warning" title="3 documents expire this week.">
              Review the compliance list.
            </Alert>
            {alertOpen ? (
              <Alert
                variant="danger"
                title="Couldn't import 12 employees."
                onDismiss={() => setAlertOpen(false)}
              >
                Mobile numbers are missing. Download the error report.
              </Alert>
            ) : (
              <Button variant="ghost" onClick={() => setAlertOpen(true)} className="self-start">
                Show dismissed alert
              </Button>
            )}
          </div>
        </Section>

        <Section id="field" title="Field">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Full name" placeholder="e.g. Ananya Krishnan" helper="As on PAN." />
            <Field
              label="Work email"
              type="email"
              defaultValue="ananya@growspark"
              error="Enter a valid email address."
            />
            <Field label="Employee ID" defaultValue="EMP-00412" readOnly helper="Read-only." />
            <Field label="Department" placeholder="Disabled" disabled required />
            <Field
              label="Notes"
              multiline
              placeholder="Anything HR should know"
              containerClassName="md:col-span-2"
            />
          </div>
        </Section>

        <Section id="statcard" title="StatCard">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Monthly payroll"
              value={4820000}
              format="inr-short"
              comparison={{ direction: 'up', value: '12%', label: 'vs last month', tone: 'success' }}
            />
            <StatCard
              label="Headcount"
              value={128}
              comparison={{ direction: 'up', value: '4', label: 'joined this month', tone: 'neutral' }}
            />
            <StatCard
              label="Pending leave requests"
              value={17}
              comparison={{ direction: 'up', value: '9', label: 'waiting over 3 days', tone: 'warning' }}
            />
            <StatCard
              label="Overdue reviews"
              value={9}
              comparison={{ direction: 'down', value: '2', label: 'fewer than last week', tone: 'success' }}
            />
            <StatCard label="Average salary" value={482000} format="inr" />
            <StatCard label="Loading" value={0} loading />
          </div>
        </Section>

        <Section id="table" title="Table">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Table state">
            {(['data', 'loading', 'empty'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={dataState === s ? 'primary' : 'secondary'}
                aria-pressed={dataState === s}
                onClick={() => setDataState(s)}
              >
                {s === 'data' ? 'With data' : s === 'loading' ? 'Loading' : 'Empty'}
              </Button>
            ))}
          </div>
          <Table label="Employees">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead align="right">Monthly salary</TableHead>
                <TableHead>Manager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataState === 'loading' ? <TableSkeleton columns={5} rows={3} /> : null}
              {dataState === 'empty' ? (
                <TableEmpty colSpan={5}>
                  <EmptyState
                    icon={Users}
                    title="No employees yet"
                    description="Employees you add will appear here with their status and manager."
                    action={<Button icon={<Plus />}>Add employee</Button>}
                  />
                </TableEmpty>
              ) : null}
              {dataState === 'data'
                ? PEOPLE.map((p, i) => (
                    <TableRow key={p.id} selected={i === 1}>
                      <TableCell>
                        <PersonCell name={p.name} />
                      </TableCell>
                      <TableCell muted>{p.department}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                      </TableCell>
                      <TableCell numeric>{formatINR(p.salary)}</TableCell>
                      <TableCell>{p.manager}</TableCell>
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </Section>

        <Section id="sidebar" title="Sidebar">
          <div className="flex flex-wrap items-start gap-6">
            <Demo title="Expanded: 240px">
              <div className="h-[460px] overflow-hidden rounded-lg">
                <Sidebar
                  product={{ name: 'Grow Spark People', initial: 'P' }}
                  sections={NAV}
                  activeId={activeId}
                  onSelect={(item) => setActiveId(item.id)}
                />
              </div>
            </Demo>
            <Demo title="Collapsed: 64px">
              <div className="h-[460px] overflow-hidden rounded-lg">
                <Sidebar
                  product={{ name: 'Grow Spark People', initial: 'P' }}
                  sections={NAV}
                  activeId={activeId}
                  onSelect={(item) => setActiveId(item.id)}
                  defaultCollapsed
                />
              </div>
            </Demo>
          </div>
        </Section>
      </main>
    </div>
  );
}
