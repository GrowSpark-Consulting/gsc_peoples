'use client';

import { Plus, Download } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { AccessDeniedState, ErrorState, NoResultsState } from '@/components/shared/data-states';
import { FormError, FormSection } from '@/components/shared/form-layout';
import { FilterSelect, ListToolbar } from '@/components/shared/list-toolbar';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { CursorPagination } from '@/components/ui/pagination';
import { SelectField } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table';
import { Inbox } from 'lucide-react';

/** Sample rows for pattern demonstration only. They are NOT company data. */
const SAMPLE = Array.from({ length: 7 }, (_, i) => ({
  id: `S-${i + 1}`,
  name: `Sample item ${i + 1}`,
  status: i % 3 === 0 ? 'Open' : i % 3 === 1 ? 'In review' : 'Done',
}));
const STATUS_VARIANT = { Open: 'info', 'In review': 'warning', Done: 'success' } as const;
const PAGE_SIZE = 3;

type ViewState = 'data' | 'loading' | 'error' | 'empty' | 'denied';

export function PatternsView() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<ViewState>('data');
  const [page, setPage] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      SAMPLE.filter(
        (r) => (!status || r.status === status) && (!search || r.name.toLowerCase().includes(search.toLowerCase())),
      ),
    [search, status],
  );
  const rows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const filtersActive = Boolean(search || status);
  const clear = () => {
    setSearch('');
    setStatus('');
    setPage(0);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <h1 className="min-w-0 truncate text-h1 font-semibold">Feature page patterns</h1>
          <div className="flex items-center gap-3">
            <Link href="/showcase" className="text-label text-muted underline-offset-2 hover:text-ink hover:underline max-sm:hidden">
              Components
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <Alert variant="info" title="Sample content." className="mb-6">
          Everything below uses made-up rows to demonstrate the reusable patterns. It is not company data.
        </Alert>

        <PageHeader
          breadcrumbs={[{ label: 'Module', href: '/showcase/patterns' }, { label: 'Sample list' }]}
          description="One-line description of what this page is for. The page title lives in the top bar."
        />

        <ListToolbar
          label="Sample filters"
          search={{ value: search, onChange: (v) => { setSearch(v); setPage(0); }, label: 'Search sample items', placeholder: 'Search by name' }}
          filters={
            <FilterSelect
              label="Status"
              value={status}
              onChange={(v) => { setStatus(v); setPage(0); }}
              allLabel="All statuses"
              options={[{ value: 'Open', label: 'Open' }, { value: 'In review', label: 'In review' }, { value: 'Done', label: 'Done' }]}
            />
          }
          actions={<Button variant="secondary" icon={<Download />}>Export</Button>}
          primary={<Button icon={<Plus />} onClick={() => { setFormError(null); setDrawer(true); }}>Add item</Button>}
        />

        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="List state">
          {(['data', 'loading', 'error', 'empty', 'denied'] as const).map((s) => (
            <Button key={s} size="sm" variant={view === s ? 'primary' : 'secondary'} aria-pressed={view === s} onClick={() => setView(s)}>
              {s === 'data' ? 'With data' : s[0]!.toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>

        {view === 'error' ? (
          <ErrorState message="The server could not be reached." onRetry={() => setView('data')} />
        ) : view === 'denied' ? (
          <div className="rounded-lg border border-line bg-surface shadow-sm"><AccessDeniedState /></div>
        ) : (
          <>
            <Table label="Sample items">
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view === 'loading' ? <TableSkeleton columns={3} rows={3} /> : null}
                {view === 'empty' ? (
                  <TableEmpty colSpan={3}>
                    <EmptyState icon={Inbox} title="Nothing here yet" description="Explain what this page is for and offer one action." action={<Button icon={<Plus />}>Add item</Button>} />
                  </TableEmpty>
                ) : null}
                {view === 'data' && filtered.length === 0 ? (
                  <TableEmpty colSpan={3}><NoResultsState noun="items" onClear={filtersActive ? clear : undefined} /></TableEmpty>
                ) : null}
                {view === 'data'
                  ? rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <button type="button" onClick={() => setDialog(true)} className="cursor-pointer rounded-sm font-medium text-ink underline-offset-2 hover:underline">
                            {r.name}
                          </button>
                        </TableCell>
                        <TableCell muted>{r.id}</TableCell>
                        <TableCell><Badge variant={STATUS_VARIANT[r.status as keyof typeof STATUS_VARIANT]}>{r.status}</Badge></TableCell>
                      </TableRow>
                    ))
                  : null}
              </TableBody>
            </Table>
            {view === 'data' && filtered.length > 0 ? (
              <div className="mt-4">
                <CursorPagination
                  page={page + 1}
                  count={rows.length}
                  noun="items"
                  hasPrevious={page > 0}
                  hasNext={(page + 1) * PAGE_SIZE < filtered.length}
                  onPrevious={() => setPage((p) => p - 1)}
                  onNext={() => setPage((p) => p + 1)}
                />
              </div>
            ) : null}
          </>
        )}

        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          title="Add sample item"
          description="Forms use the same drawer, fields and validation messages everywhere."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDrawer(false)}>Cancel</Button>
              <Button
                loading={saving}
                onClick={() => {
                  setSaving(true);
                  setTimeout(() => { setSaving(false); setFormError('Check your connection and try again.'); }, 600);
                }}
              >
                {saving ? 'Saving...' : 'Save item'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-6">
            <FormError message={formError} />
            <FormSection title="Details" description="Required fields are marked with an asterisk.">
              <Field label="Name" required placeholder="e.g. Sample item" helper="Shown in the list." />
              <Field label="Reference" error="Enter a reference such as S-100." defaultValue="" />
              <SelectField label="Status" containerClassName="sm:col-span-2">
                <option>Open</option>
                <option>In review</option>
                <option>Done</option>
              </SelectField>
            </FormSection>
          </div>
        </Drawer>

        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Change status"
          description="Dialogs are for short decisions and stack above drawers."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button>
              <Button onClick={() => setDialog(false)}>Confirm</Button>
            </>
          }
        >
          <SelectField label="New status">
            <option>Open</option>
            <option>Done</option>
          </SelectField>
        </Dialog>
      </main>
    </div>
  );
}
