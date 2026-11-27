'use client';

import {
  createDepartmentSchema,
  createDesignationSchema,
  createOrgHolidaySchema,
  type organizationHierarchyNodeSchema,
} from '@gsc/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, NoResultsState } from '@/components/shared/data-states';
import { FilterSelect, ListToolbar } from '@/components/shared/list-toolbar';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
  TableEmpty,
} from '@/components/ui/table';
import { useAction } from '@/hooks/use-action';
import { hasPermission, PERMISSIONS } from '@/hooks/use-session';
import { describeApiError } from '@/lib/api-client';
import { formatDay } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import type { Session } from '@/modules/employees/permissions';
import { QueryBoundary, SessionGate } from '@/modules/shared/page-state';
import { Tabs } from '@/modules/shared/tabs';
import {
  createDepartment,
  createDesignation,
  createHoliday,
  deleteDepartment,
  deleteDesignation,
  deleteHoliday,
  getHierarchy,
  listDepartments,
  listDesignations,
  listHolidays,
  updateDepartment,
  updateDesignation,
  updateHoliday,
} from './api';

type TabKey = 'departments' | 'designations' | 'holidays' | 'structure';
const TABS = [
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Designations' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'structure', label: 'Reporting structure' },
] as const;

export function OrganizationPage() {
  return <SessionGate skeleton="tabs">{(session) => <OrganizationBody session={session} />}</SessionGate>;
}

function OrganizationBody({ session }: { session: Session }) {
  const [tab, setTab] = useState<TabKey>('departments');
  const canOrg = hasPermission(session, PERMISSIONS.ORGANIZATION_WRITE);
  const canHoliday = hasPermission(session, PERMISSIONS.HOLIDAY_WRITE);
  if (!hasPermission(session, PERMISSIONS.ORGANIZATION_READ)) {
    return <EmptyState title="No access" description="Your role cannot view the organization." />;
  }
  return (
    <>
      <PageHeader description="Departments, designations, holidays and the reporting structure of your company." />
      <Tabs items={TABS} value={tab} onChange={setTab} label="Organization sections" />
      <div role="tabpanel">
        {tab === 'departments' ? <CatalogTab kind="department" canWrite={canOrg} /> : null}
        {tab === 'designations' ? <CatalogTab kind="designation" canWrite={canOrg} /> : null}
        {tab === 'holidays' ? <HolidaysTab canWrite={canHoliday} /> : null}
        {tab === 'structure' ? <StructureTab /> : null}
      </div>
    </>
  );
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? 'form');
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

/* ---------------- Departments and designations (ORG-002) ---------------- */

interface Row {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  updatedAt: string;
}

const CONFIG = {
  department: {
    noun: 'department',
    plural: 'Departments',
    list: listDepartments,
    create: createDepartment,
    update: updateDepartment,
    remove: deleteDepartment,
    schema: createDepartmentSchema,
    hasDescription: true,
  },
  designation: {
    noun: 'designation',
    plural: 'Designations',
    list: listDesignations,
    create: createDesignation,
    update: updateDesignation,
    remove: deleteDesignation,
    schema: createDesignationSchema,
    hasDescription: false,
  },
} as const;

function CatalogTab({ kind, canWrite }: { kind: 'department' | 'designation'; canWrite: boolean }) {
  const cfg = CONFIG[kind];
  const q = useAsyncData(`org:${kind}`, cfg.list as () => Promise<Row[]>);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const toggle = useAction(async (r: Row) => cfg.update(r.id, { isActive: !r.isActive }));

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter(
      (r) =>
        (!s || r.name.toLowerCase().includes(s)) &&
        (!status || (status === 'active' ? r.isActive : !r.isActive)),
    );
  }, [q.data, search, status]);

  async function flip(r: Row) {
    const res = await toggle.run(r);
    if (res.ok) q.reload();
  }
  const cols = 4 + (cfg.hasDescription ? 1 : 0);

  return (
    <>
      <ListToolbar
        label={`${cfg.plural} filters`}
        search={{ value: search, onChange: setSearch, label: `Search ${cfg.plural.toLowerCase()}`, placeholder: `Search ${cfg.plural.toLowerCase()}` }}
        filters={
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            allLabel="All statuses"
            options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]}
          />
        }
        primary={
          canWrite ? (
            <Button icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>
              Add {cfg.noun}
            </Button>
          ) : undefined
        }
      />
      {toggle.error ? <div className="mb-3"><Alert variant="danger">{toggle.error.message}</Alert></div> : null}
      {q.status === 'error' ? (
        <ErrorState title={`Could not load ${cfg.plural.toLowerCase()}.`} message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <Table label={cfg.plural}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {cfg.hasDescription ? <TableHead>Description</TableHead> : null}
              <TableHead>Status</TableHead>
              <TableHead>Employees</TableHead>
              {canWrite ? <TableHead align="right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.status !== 'success' ? (
              <TableSkeleton columns={cols + (canWrite ? 1 : 0)} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={cols + (canWrite ? 1 : 0)}>
                {(q.data ?? []).length === 0 ? (
                  <EmptyState title={`No ${cfg.plural.toLowerCase()} yet`} description={canWrite ? `Add your first ${cfg.noun}.` : 'None have been added.'} />
                ) : (
                  <NoResultsState noun={cfg.plural.toLowerCase()} onClear={() => { setSearch(''); setStatus(''); }} />
                )}
              </TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  {cfg.hasDescription ? <TableCell muted>{r.description || '—'}</TableCell> : null}
                  <TableCell><Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Archived'}</Badge></TableCell>
                  <TableCell>
                    {kind === 'department' ? (
                      <Link href={`/employees?dept=${r.id}`} className="text-ink underline">View employees</Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </TableCell>
                  {canWrite ? (
                    <TableCell align="right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit</Button>
                        <Button size="sm" variant="secondary" loading={toggle.pending} onClick={() => flip(r)}>{r.isActive ? 'Archive' : 'Restore'}</Button>
                        <Button size="sm" variant="destructive" onClick={() => setRemoving(r)}>Delete</Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
      {editing ? (
        <CatalogDialog
          kind={kind}
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            q.reload();
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDelete
          title={`Delete ${cfg.noun}`}
          message={`Delete "${removing.name}"? This cannot be undone. A ${cfg.noun} that is in use cannot be deleted; archive it instead.`}
          run={() => cfg.remove(removing.id)}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            q.reload();
          }}
        />
      ) : null}
    </>
  );
}

function CatalogDialog({
  kind,
  row,
  onClose,
  onDone,
}: {
  kind: 'department' | 'designation';
  row: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const cfg = CONFIG[kind];
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(async (body: { name: string; description?: string | null }) =>
    row ? cfg.update(row.id, body) : cfg.create(body),
  );
  async function submit() {
    const body = cfg.hasDescription ? { name, description: description.trim() || null } : { name };
    const parsed = cfg.schema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    const r = await act.run(body);
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? `Edit ${cfg.noun}` : `Add ${cfg.noun}`}
      description="Names are unique and not case-sensitive."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>{row ? 'Save changes' : `Add ${cfg.noun}`}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        {cfg.hasDescription ? (
          <Field label="Description" multiline value={description} onChange={(e) => setDescription((e.target as unknown as HTMLTextAreaElement).value)} error={errors.description} />
        ) : null}
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

function ConfirmDelete({
  title,
  message,
  run,
  onClose,
  onDone,
}: {
  title: string;
  message: string;
  run: () => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const act = useAction(run);
  async function go() {
    const r = await act.run();
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={message}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" loading={act.pending} onClick={go}>Delete</Button>
        </>
      }
    >
      {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
    </Dialog>
  );
}

/* ---------------- Holidays (ORG-004) ---------------- */

type Holiday = { id: string; date: string; name: string };

function HolidaysTab({ canWrite }: { canWrite: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useAsyncData(`org:holidays:${year}`, () => listHolidays(year));
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const years = [year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <SelectField label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (<option key={y} value={y}>{y}</option>))}
        </SelectField>
        {canWrite ? <Button icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>Add holiday</Button> : null}
      </div>
      <QueryBoundary query={q} title="Could not load holidays.">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title={`No holidays in ${year}`} description="Holidays are excluded from leave counts and absence." />
          ) : (
            <Table label="Holidays">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  {canWrite ? <TableHead align="right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{formatDay(h.date.slice(0, 10))}</TableCell>
                    <TableCell>{h.name}</TableCell>
                    {canWrite ? (
                      <TableCell align="right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(h)}>Edit</Button>
                          <Button size="sm" variant="destructive" onClick={() => setRemoving(h)}>Delete</Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </QueryBoundary>
      {editing ? (
        <HolidayDialog
          row={editing === 'new' ? null : editing}
          defaultYear={year}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            q.reload();
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDelete
          title="Delete holiday"
          message={`Delete "${removing.name}" on ${formatDay(removing.date.slice(0, 10))}?`}
          run={() => deleteHoliday(removing.id)}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            q.reload();
          }}
        />
      ) : null}
    </>
  );
}

function HolidayDialog({ row, defaultYear, onClose, onDone }: { row: Holiday | null; defaultYear: number; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(row?.date.slice(0, 10) ?? `${defaultYear}-01-01`);
  const [name, setName] = useState(row?.name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(async (body: { date: string; name: string }) => (row ? updateHoliday(row.id, body) : createHoliday(body)));
  async function submit() {
    const parsed = createOrgHolidaySchema.safeParse({ date, name });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    const r = await act.run(parsed.data);
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? 'Edit holiday' : 'Add holiday'}
      description="Only one holiday is allowed per date."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>{row ? 'Save changes' : 'Add holiday'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

/* ---------------- Reporting structure (ORG-003, ORG-005 P1) ---------------- */

type Node = z.infer<typeof organizationHierarchyNodeSchema>;

function StructureTab() {
  const q = useAsyncData('org:hierarchy', getHierarchy);
  return (
    <QueryBoundary query={q} title="Could not load the reporting structure.">
      {(nodes) =>
        nodes.length === 0 ? (
          <EmptyState title="No reporting structure yet" description="Employees appear here once they have been added." />
        ) : (
          <div className="rounded-lg border border-line bg-surface p-5 shadow-sm">
            <ul aria-label="Reporting structure" className="flex flex-col gap-1">
              {nodes.map((n: Node) => (<TreeNode key={n.id} node={n} depth={0} />))}
            </ul>
          </div>
        )
      }
    </QueryBoundary>
  );
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <li>
      <div style={{ paddingLeft: depth * 24 }} className="py-1 text-body">
        <Link href={`/employees/${node.id}`} className="text-ink underline">{node.name}</Link>
        <span className="text-muted">
          {' '}· {node.employeeNumber}
          {node.jobTitle ? ` · ${node.jobTitle}` : ''}
          {node.department?.name ? ` · ${node.department.name}` : ''}
        </span>
      </div>
      {node.reports.length > 0 ? (
        <ul>
          {node.reports.map((c: Node) => (<TreeNode key={c.id} node={c} depth={depth + 1} />))}
        </ul>
      ) : null}
    </li>
  );
}
