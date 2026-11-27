'use client';

import {
  createOnboardingTaskSchema,
  createOnboardingTemplateTaskSchema,
  type onboardingProgressSchema,
  type onboardingTaskSchema,
  type onboardingTemplateTaskSchema,
} from '@gsc/contracts';
import { Plus, Send } from 'lucide-react';
import { useState } from 'react';
import type { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, NoResultsState } from '@/components/shared/data-states';
import { FilterSelect, ListToolbar } from '@/components/shared/list-toolbar';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { CursorPagination } from '@/components/ui/pagination';
import { SelectField } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { useAction } from '@/hooks/use-action';
import { hasAny, hasPermission, PERMISSIONS } from '@/hooks/use-session';
import { describeApiError } from '@/lib/api-client';
import { formatDay, formatTimestamp } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { Session } from '@/modules/employees/permissions';
import { QueryBoundary, Section, SessionGate } from '@/modules/shared/page-state';
import { Tabs } from '@/modules/shared/tabs';
import {
  addTask,
  completeTask,
  createTemplateTask,
  deleteTemplateTask,
  getChecklist,
  inviteEmployee,
  listOnboardingProgress,
  PAGE_SIZE,
  listTemplate,
  updateTask,
  updateTemplateTask,
} from './api';

type Task = z.infer<typeof onboardingTaskSchema>;
type Progress = z.infer<typeof onboardingProgressSchema>;
type TemplateTask = z.infer<typeof onboardingTemplateTaskSchema>;

const STATUS_LABEL = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' } as const;
const STATUS_VARIANT = { NOT_STARTED: 'neutral', IN_PROGRESS: 'info', COMPLETED: 'success' } as const;
const INVITE_LABEL = { NOT_INVITED: 'Not invited', INVITED: 'Invited', ACTIVATED: 'Activated' } as const;
const ASSIGNEE_LABEL = { HR: 'HR', EMPLOYEE: 'Employee' } as const;

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? 'form');
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

export function OnboardingPage() {
  return <SessionGate skeleton="sections">{(session) => <OnboardingBody session={session} />}</SessionGate>;
}

function OnboardingBody({ session }: { session: Session }) {
  const manage = hasAny(session, PERMISSIONS.ONBOARDING_WRITE, PERMISSIONS.ONBOARDING_READ_ALL);
  const own = hasPermission(session, PERMISSIONS.ONBOARDING_READ_SELF) && session.employeeId;
  if (manage) return <HrView session={session} />;
  if (own) {
    return (
      <>
        <PageHeader description="Your onboarding checklist. Complete the tasks assigned to you." />
        <Section title="My checklist">
          <Checklist employeeId={session.employeeId as string} session={session} />
        </Section>
      </>
    );
  }
  return <EmptyState title="No access" description="Your role cannot view onboarding." />;
}

/* ---------------- HR view ---------------- */

function HrView({ session }: { session: Session }) {
  const [tab, setTab] = useState<'employees' | 'template'>('employees');
  const canWrite = hasPermission(session, PERMISSIONS.ONBOARDING_WRITE);
  return (
    <>
      <PageHeader description="Track new joiners through their onboarding checklist." />
      <Tabs
        items={[{ key: 'employees', label: 'Employees' }, ...(canWrite ? [{ key: 'template' as const, label: 'Default checklist' }] : [])]}
        value={tab}
        onChange={setTab}
        label="Onboarding sections"
      />
      <div role="tabpanel">
        {tab === 'employees' ? <EmployeesTab session={session} /> : <TemplateTab />}
      </div>
    </>
  );
}

function EmployeesTab({ session }: { session: Session }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Progress['status'] | ''>('');
  const [page, setPage] = useState(1);
  const term = useDebouncedValue(search.trim(), 300);
  const q = useAsyncData(`onb:rows:${status}:${term}:${page}`, () =>
    listOnboardingProgress({ status: status || undefined, search: term || undefined, page }),
  );
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const canInvite = hasAny(session, PERMISSIONS.EMPLOYEE_INVITE, PERMISSIONS.USER_ACCOUNT_MANAGE);
  const invite = useAction(inviteEmployee);
  const rows = q.data?.data ?? [];
  const total = q.data?.page.total ?? 0;
  const filtered = Boolean(status || term);

  async function sendInvite(id: string) {
    const r = await invite.run(id);
    if (r.ok) q.reload();
  }

  return (
    <>
      <ListToolbar
        label="Onboarding filters"
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v);
            setPage(1);
          },
          label: 'Search employees',
          placeholder: 'Search by name or ID',
        }}
        filters={
          <FilterSelect
            label="Onboarding status"
            value={status}
            onChange={(v) => {
              setStatus(v as Progress['status'] | '');
              setPage(1);
            }}
            allLabel="All statuses"
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          />
        }
      />
      {invite.error ? <div className="mb-3"><Alert variant="danger">{invite.error.message}</Alert></div> : null}
      {q.status === 'error' ? (
        <ErrorState title="Could not load onboarding." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <Table label="Employees in onboarding">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Login</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.status !== 'success' ? (
              <TableSkeleton columns={5} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={5}>
                {!filtered ? (
                  <EmptyState title="Nobody is onboarding" description="New employees appear here until HR marks them Active." />
                ) : (
                  <NoResultsState noun="employees" onClear={() => { setSearch(''); setStatus(''); setPage(1); }} />
                )}
              </TableEmpty>
            ) : (
              rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>{r.name}<span className="block text-small text-muted">{r.employeeNumber}</span></TableCell>
                  <TableCell>{`${r.progress.completed} of ${r.progress.total} · ${Math.round(r.progress.percentage)}%`}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.progress.status]}>{STATUS_LABEL[r.progress.status]}</Badge></TableCell>
                  <TableCell>{INVITE_LABEL[r.invitationStatus]}</TableCell>
                  <TableCell align="right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setOpen({ id: r.employeeId, name: r.name })}>Checklist</Button>
                      {canInvite && r.invitationStatus !== 'ACTIVATED' ? (
                        <Button size="sm" variant="secondary" icon={<Send aria-hidden />} loading={invite.pending} onClick={() => sendInvite(r.employeeId)}>
                          {r.invitationStatus === 'INVITED' ? 'Resend invite' : 'Invite'}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
      {q.status === 'success' && total > PAGE_SIZE ? (
        <div className="mt-4">
          <CursorPagination
            page={page}
            count={rows.length}
            hasPrevious={page > 1}
            hasNext={page * PAGE_SIZE < total}
            onPrevious={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            noun="employees"
          />
        </div>
      ) : null}
      <Drawer open={open !== null} onClose={() => { setOpen(null); q.reload(); }} title={open ? `${open.name} · checklist` : 'Checklist'} size="lg">
        {open ? <Checklist employeeId={open.id} session={session} /> : null}
      </Drawer>
    </>
  );
}

/* ---------------- Checklist (ONB-002, ONB-003) ---------------- */

export function ProgressBar({ progress }: { progress: Progress }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.percentage)));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-small text-muted">
        <span>
          {progress.completed} of {progress.total} tasks done
        </span>
        <Badge variant={STATUS_VARIANT[progress.status]}>{STATUS_LABEL[progress.status]}</Badge>
      </div>
      <div role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full overflow-hidden rounded-full bg-sunken">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Checklist({ employeeId, session }: { employeeId: string; session: Session }) {
  const q = useAsyncData(`onb:list:${employeeId}`, () => getChecklist(employeeId));
  const canWrite = hasPermission(session, PERMISSIONS.ONBOARDING_WRITE);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const complete = useAction(completeTask);
  async function done(id: string) {
    const r = await complete.run(id);
    if (r.ok) q.reload();
  }
  return (
    <QueryBoundary query={q} title="Could not load the checklist.">
      {(c) => (
        <div className="flex flex-col gap-4">
          {c.progress ? <ProgressBar progress={c.progress} /> : null}
          {canWrite ? (
            <div><Button size="sm" icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>Add task</Button></div>
          ) : null}
          {complete.error ? <Alert variant="danger">{complete.error.message}</Alert> : null}
          {c.data.length === 0 ? (
            <EmptyState title="No tasks" description="This checklist has no tasks yet." />
          ) : (
            <Table label="Onboarding tasks">
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.data.map((t) => {
                  const mine = t.employeeId === session.employeeId && t.assigneeType === 'EMPLOYEE';
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{t.title}</TableCell>
                      <TableCell>{ASSIGNEE_LABEL[t.assigneeType]}</TableCell>
                      <TableCell>{formatDay(t.dueDate?.slice(0, 10))}</TableCell>
                      <TableCell>
                        {t.completed ? (
                          <>
                            <Badge variant="success">Done</Badge>
                            {t.completedAt ? <span className="block text-small text-muted">{formatTimestamp(t.completedAt)}</span> : null}
                          </>
                        ) : (
                          <Badge variant="neutral">Open</Badge>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex justify-end gap-2">
                          {!t.completed && (canWrite || mine) ? (
                            <Button size="sm" variant="secondary" loading={complete.pending} onClick={() => done(t.id)}>Mark done</Button>
                          ) : null}
                          {canWrite ? <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {editing ? (
            <TaskDialog
              employeeId={employeeId}
              task={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onDone={() => {
                setEditing(null);
                q.reload();
              }}
            />
          ) : null}
        </div>
      )}
    </QueryBoundary>
  );
}

function TaskDialog({ employeeId, task, onClose, onDone }: { employeeId: string; task: Task | null; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate?.slice(0, 10) ?? '');
  const [assigneeType, setAssigneeType] = useState<'HR' | 'EMPLOYEE'>(task?.assigneeType ?? 'HR');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(async (body: z.input<typeof createOnboardingTaskSchema>) =>
    task ? updateTask(task.id, body) : addTask(employeeId, body),
  );
  async function submit() {
    const body = { title, dueDate: dueDate || null, assigneeType };
    const parsed = createOnboardingTaskSchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    const r = await act.run(body);
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? 'Edit task' : 'Add task'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>{task ? 'Save changes' : 'Add task'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Field label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
        <SelectField label="Assigned to" value={assigneeType} onChange={(e) => setAssigneeType(e.target.value as 'HR' | 'EMPLOYEE')}>
          <option value="HR">HR</option>
          <option value="EMPLOYEE">Employee</option>
        </SelectField>
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

/* ---------------- Default checklist template (ONB-001) ---------------- */

function TemplateTab() {
  const q = useAsyncData('onb:template', listTemplate);
  const [editing, setEditing] = useState<TemplateTask | 'new' | null>(null);
  const remove = useAction(deleteTemplateTask);
  async function del(id: string) {
    const r = await remove.run(id);
    if (r.ok) q.reload();
  }
  return (
    <Section
      title="Default checklist"
      action={<Button size="sm" icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>Add task</Button>}
    >
      <p className="mb-3 text-small text-muted">New employees get a copy of this checklist. Later changes do not alter existing checklists.</p>
      {remove.error ? <div className="mb-3"><Alert variant="danger">{remove.error.message}</Alert></div> : null}
      <QueryBoundary query={q} title="Could not load the default checklist.">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No default tasks" description="Add the tasks every new employee should complete." />
          ) : (
            <Table label="Default onboarding tasks">
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead align="right">Due (days after joining)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.title}</TableCell>
                    <TableCell>{ASSIGNEE_LABEL[t.assigneeType]}</TableCell>
                    <TableCell numeric align="right">{t.dueOffsetDays ?? '—'}</TableCell>
                    <TableCell><Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button>
                        <Button size="sm" variant="destructive" loading={remove.pending} onClick={() => del(t.id)}>Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </QueryBoundary>
      {editing ? (
        <TemplateDialog
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

function TemplateDialog({ task, onClose, onDone }: { task: TemplateTask | null; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [offset, setOffset] = useState(task?.dueOffsetDays?.toString() ?? '');
  const [assigneeType, setAssigneeType] = useState<'HR' | 'EMPLOYEE'>(task?.assigneeType ?? 'HR');
  const [isActive, setIsActive] = useState(task?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(async (body: z.input<typeof createOnboardingTemplateTaskSchema>) =>
    task ? updateTemplateTask(task.id, body) : createTemplateTask(body),
  );
  async function submit() {
    const body = { title, dueOffsetDays: offset === '' ? null : Number(offset), assigneeType, isActive };
    const parsed = createOnboardingTemplateTaskSchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    const r = await act.run(body);
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? 'Edit default task' : 'Add default task'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>{task ? 'Save changes' : 'Add task'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Field label="Due (days after joining)" type="number" min={0} max={365} value={offset} onChange={(e) => setOffset(e.target.value)} error={errors.dueOffsetDays} />
        <SelectField label="Assigned to" value={assigneeType} onChange={(e) => setAssigneeType(e.target.value as 'HR' | 'EMPLOYEE')}>
          <option value="HR">HR</option>
          <option value="EMPLOYEE">Employee</option>
        </SelectField>
        <label className="flex items-center gap-2 text-body text-ink"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}
