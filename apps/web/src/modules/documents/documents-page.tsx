'use client';

import type { documentSchema } from '@gsc/contracts';
import { Download, Eye, Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/shared/data-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
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
import { getEmployeeNames } from '@/modules/attendance/api';
import { formatDay } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import type { Session } from '@/modules/employees/permissions';
import { Section, SessionGate } from '@/modules/shared/page-state';
import { Tabs } from '@/modules/shared/tabs';
import {
  ALLOWED_TYPES,
  deleteDocument,
  getDocumentLink,
  listDocuments,
  setVisibility,
  uploadCompanyDocument,
  uploadEmployeeDocument,
  validateFile,
} from './api';

type Doc = z.infer<typeof documentSchema>;

const EMPLOYEE_CATEGORIES = [
  ['ID_PROOF', 'ID proof'],
  ['CONTRACT', 'Contract'],
  ['OFFER_LETTER', 'Offer letter'],
  ['CERTIFICATE', 'Certificate'],
  ['OTHER', 'Other'],
] as const;
const COMPANY_CATEGORIES = [
  ['POLICY', 'Policy'],
  ['HANDBOOK', 'Handbook'],
  ['FORM', 'Form'],
  ['OTHER', 'Other'],
] as const;
const categoryLabel = (c: string) =>
  [...EMPLOYEE_CATEGORIES, ...COMPANY_CATEGORIES].find(([k]) => k === c)?.[1] ?? c;

export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg']);

export function DocumentsPage() {
  return <SessionGate skeleton="tabs">{(session) => <DocumentsBody session={session} />}</SessionGate>;
}

function DocumentsBody({ session }: { session: Session }) {
  const [tab, setTab] = useState<'employee' | 'company'>('employee');
  const canRead = hasAny(
    session,
    PERMISSIONS.DOCUMENT_READ_ALL,
    PERMISSIONS.DOCUMENT_READ_SELF,
    PERMISSIONS.DOCUMENT_READ_TEAM,
  );
  const q = useAsyncData('docs:list', listDocuments, canRead);
  if (!canRead) return <EmptyState title="No access" description="Your role cannot view documents." />;
  const all = q.data ?? [];
  const employeeDocs = all.filter((d) => !d.isCompanyDocument);
  const companyDocs = all.filter((d) => d.isCompanyDocument);
  return (
    <>
      <PageHeader description="Employee documents are private to HR, Super Admin and the owner. Company documents are visible to everyone." />
      <Tabs
        items={[
          { key: 'employee', label: 'Employee documents' },
          { key: 'company', label: 'Company documents' },
        ]}
        value={tab}
        onChange={setTab}
        label="Document sections"
      />
      <div role="tabpanel">
        {q.status === 'error' ? (
          <ErrorState title="Could not load documents." message={describeApiError(q.error)} onRetry={q.reload} />
        ) : tab === 'employee' ? (
          <DocumentList key="employee" kind="employee" docs={employeeDocs} loading={q.status !== 'success'} session={session} onChanged={q.reload} />
        ) : (
          <DocumentList key="company" kind="company" docs={companyDocs} loading={q.status !== 'success'} session={session} onChanged={q.reload} />
        )}
      </div>
    </>
  );
}

function DocumentList({
  kind,
  docs,
  loading,
  session,
  onChanged,
}: {
  kind: 'employee' | 'company';
  docs: Doc[];
  loading: boolean;
  session: Session;
  onChanged: () => void;
}) {
  const company = kind === 'company';
  const canUpload = company
    ? hasPermission(session, PERMISSIONS.DOCUMENT_COMPANY_MANAGE)
    : hasPermission(session, PERMISSIONS.DOCUMENT_UPLOAD);
  const canDelete = hasPermission(session, PERMISSIONS.DOCUMENT_DELETE);
  const canFlag = hasPermission(session, PERMISSIONS.DOCUMENT_VISIBILITY_MANAGE);
  const showOwner = !company && hasPermission(session, PERMISSIONS.DOCUMENT_READ_ALL);
  const names = useAsyncData('docs:names', getEmployeeNames, showOwner);
  const nameOf = useMemo(() => new Map((names.data ?? []).map((n) => [n.id, n.name])), [names.data]);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Doc | null>(null);
  const flag = useAction(async (d: Doc) => setVisibility(d.id, !d.visibleToManager));
  const open = useAction(async (d: Doc, mode: 'download' | 'preview') => {
    // Open the tab inside the click, before the network call, so the browser does not treat it as a popup.
    const tab = mode === 'preview' ? window.open('about:blank', '_blank') : null;
    try {
      const link = await getDocumentLink(d.id, mode === 'preview');
      if (mode === 'preview') {
        if (tab) {
          tab.opener = null;
          tab.location.href = link.url;
        } else {
          window.open(link.url, '_blank', 'noopener');
        }
      } else {
        const a = document.createElement('a');
        a.href = link.url;
        a.rel = 'noopener';
        a.click();
      }
    } catch (e) {
      tab?.close();
      throw e;
    }
  });
  const cols = 5 + (showOwner ? 1 : 0) + (canFlag && !company ? 1 : 0);

  return (
    <Section
      title={company ? 'Company documents' : 'Employee documents'}
      action={
        canUpload ? (
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setUploading(true)}>
            Upload document
          </Button>
        ) : undefined
      }
    >
      {open.error ? <div className="mb-3"><Alert variant="danger">{open.error.message}</Alert></div> : null}
      {flag.error ? <div className="mb-3"><Alert variant="danger">{flag.error.message}</Alert></div> : null}
      <Table label={company ? 'Company documents' : 'Employee documents'}>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            {showOwner ? <TableHead>Employee</TableHead> : null}
            <TableHead>Category</TableHead>
            <TableHead align="right">Size</TableHead>
            <TableHead>Uploaded</TableHead>
            {canFlag && !company ? <TableHead>Manager access</TableHead> : null}
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeleton columns={cols + 1} />
          ) : docs.length === 0 ? (
            <TableEmpty colSpan={cols + 1}>
              <EmptyState title="No documents" description={canUpload ? 'Upload the first document.' : 'Nothing has been shared with you yet.'} />
            </TableEmpty>
          ) : (
            docs.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.fileName}</TableCell>
                {showOwner ? <TableCell>{(d.ownerEmployeeId && nameOf.get(d.ownerEmployeeId)) || '—'}</TableCell> : null}
                <TableCell>{categoryLabel(d.category)}</TableCell>
                <TableCell numeric align="right">{formatSize(d.sizeBytes)}</TableCell>
                <TableCell>{formatDay(d.createdAt.slice(0, 10))}</TableCell>
                {canFlag && !company ? (
                  <TableCell>
                    <Button size="sm" variant="secondary" loading={flag.pending} onClick={async () => { const r = await flag.run(d); if (r.ok) onChanged(); }}>
                      {d.visibleToManager ? 'Visible (hide)' : 'Hidden (show)'}
                    </Button>
                  </TableCell>
                ) : null}
                <TableCell align="right">
                  <div className="flex justify-end gap-2">
                    {PREVIEWABLE.has(d.mimeType) ? (
                      <Button size="sm" variant="secondary" icon={<Eye aria-hidden />} loading={open.pending} onClick={() => open.run(d, 'preview')}>Preview</Button>
                    ) : null}
                    <Button size="sm" variant="secondary" icon={<Download aria-hidden />} loading={open.pending} onClick={() => open.run(d, 'download')}>Download</Button>
                    {canDelete ? <Button size="sm" variant="destructive" onClick={() => setRemoving(d)}>Delete</Button> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {uploading ? (
        <UploadDialog
          company={company}
          session={session}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            onChanged();
          }}
        />
      ) : null}
      {removing ? (
        <DeleteDialog
          doc={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            onChanged();
          }}
        />
      ) : null}
    </Section>
  );
}

function DeleteDialog({ doc, onClose, onDone }: { doc: Doc; onClose: () => void; onDone: () => void }) {
  const act = useAction(deleteDocument);
  async function go() {
    const r = await act.run(doc.id);
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete document"
      description={`Delete "${doc.fileName}"? It is hidden immediately and the file is removed after 30 days.`}
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

function UploadDialog({ company, session, onClose, onDone }: { company: boolean; session: Session; onClose: () => void; onDone: () => void }) {
  const canChooseEmployee = !company && hasPermission(session, PERMISSIONS.DOCUMENT_READ_ALL);
  const names = useAsyncData('docs:upload-names', getEmployeeNames, canChooseEmployee);
  const categories = company ? COMPANY_CATEGORIES : EMPLOYEE_CATEGORIES;
  const [category, setCategory] = useState<string>(categories[0][0]);
  const [employeeId, setEmployeeId] = useState('');
  const [visible, setVisible] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const act = useAction(async () => {
    if (!file) throw new Error('Choose a file');
    if (company) return uploadCompanyDocument({ file, category });
    return uploadEmployeeDocument({
      file,
      category,
      employeeId: canChooseEmployee && employeeId ? employeeId : undefined,
      visibleToManager: canChooseEmployee ? visible : undefined,
    });
  });
  async function submit() {
    if (!file) return setFileError('Choose a file to upload.');
    const problem = validateFile(file);
    if (problem) return setFileError(problem);
    setFileError(undefined);
    const r = await act.run();
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={company ? 'Upload company document' : 'Upload employee document'}
      description={`Accepted: ${Object.values(ALLOWED_TYPES).join(', ')}. Up to 10 MB.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>Upload</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {canChooseEmployee ? (
          <SelectField label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} helper="Leave empty to upload to your own record.">
            <option value="">Me</option>
            {(names.data ?? []).filter((n) => n.id !== session.employeeId).map((n) => (<option key={n.id} value={n.id}>{n.name}</option>))}
          </SelectField>
        ) : null}
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </SelectField>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-file" className="text-label font-medium text-ink">File</label>
          <input
            id="doc-file"
            ref={input}
            type="file"
            accept={Object.keys(ALLOWED_TYPES).join(',')}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? 'doc-file-error' : undefined}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setFileError(undefined); }}
            className="text-body text-ink"
          />
          {fileError ? <p id="doc-file-error" role="alert" className="text-small text-danger">{fileError}</p> : null}
        </div>
        {canChooseEmployee ? (
          <label className="flex items-center gap-2 text-body text-ink">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to the employee&apos;s manager
          </label>
        ) : null}
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}
