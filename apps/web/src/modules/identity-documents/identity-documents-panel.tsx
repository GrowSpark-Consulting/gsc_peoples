'use client';

import { IDENTITY_DOCUMENT_LABELS, PERMISSIONS, type IdentityDocument, type IdentityDocumentSide, type Permission } from '@gsc/contracts';
import { Download, Eye, EyeOff, FileText, IdCard, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAction } from '@/hooks/use-action';
import { describeApiError } from '@/lib/api-client';
import { formatTimestamp } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import { deleteIdentityDocument, getIdentityDocument, openIdentityFile, revealIdentityNumber } from './api';
import { IdentityDocumentFields } from './identity-document-fields';
import { useIdentityUpload } from './use-identity-upload';

/** How long a revealed number stays on screen before it is masked again. */
const REVEAL_SECONDS = 30;

export interface IdentityAccess {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canReveal: boolean;
}

/** What the caller may do with THIS employee's identity document. The API enforces the same rules. */
export function identityAccess(session: { permissions: readonly Permission[]; employeeId: string | null }, employeeId: string): IdentityAccess {
  const has = (p: Permission) => session.permissions.includes(p);
  const self = !!session.employeeId && session.employeeId === employeeId;
  return {
    canRead: has(PERMISSIONS.IDENTITY_DOCUMENT_READ_ALL) || (self && has(PERMISSIONS.IDENTITY_DOCUMENT_READ_SELF)),
    canWrite: has(PERMISSIONS.IDENTITY_DOCUMENT_WRITE_ALL) || (self && has(PERMISSIONS.IDENTITY_DOCUMENT_WRITE_SELF)),
    canDelete: has(PERMISSIONS.IDENTITY_DOCUMENT_DELETE),
    canReveal: has(PERMISSIONS.IDENTITY_DOCUMENT_REVEAL),
  };
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-ink">{children}</dd>
    </div>
  );
}

function FileRow({ label, side, employeeId, mimeType }: { label: string; side: IdentityDocumentSide; employeeId: string; mimeType: string }) {
  const open = useAction((mode: 'preview' | 'download') => openIdentityFile(employeeId, side, mode));
  return (
    <div className="flex flex-col gap-2 rounded-md bg-sunken p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <FileText className="size-5 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
        <div className="min-w-0">
          <p className="text-body text-ink">{label}</p>
          <p className="text-small text-muted">{mimeType === 'application/pdf' ? 'PDF' : mimeType === 'image/png' ? 'PNG image' : 'JPG image'}</p>
        </div>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => open.run('preview')} disabled={open.pending} aria-label={`Preview ${label.toLowerCase()}`}>
          <Eye aria-hidden />
          Preview
        </Button>
        <Button variant="ghost" size="sm" onClick={() => open.run('download')} disabled={open.pending} aria-label={`Download ${label.toLowerCase()}`}>
          <Download aria-hidden />
          Download
        </Button>
      </div>
      {open.error ? (
        <p role="alert" className="text-small text-danger sm:basis-full">
          {open.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** Super Admin only. The full number lives in component state for REVEAL_SECONDS, then is cleared. */
function RevealNumber({ employeeId, masked }: { employeeId: string; masked: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const act = useAction(() => revealIdentityNumber(employeeId));
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), REVEAL_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [shown]);
  useEffect(() => () => setShown(null), []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono tabular-nums tracking-wide" data-sensitive={shown ? 'true' : undefined}>
        {shown ?? masked}
      </span>
      {shown ? (
        <Button variant="ghost" size="sm" onClick={() => setShown(null)}>
          <EyeOff aria-hidden />
          Hide
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          loading={act.pending}
          onClick={async () => {
            const r = await act.run();
            if (r.ok) setShown(r.value);
          }}
        >
          <KeyRound aria-hidden />
          Reveal full number
        </Button>
      )}
      {shown ? <span className="basis-full text-small text-muted">This view was recorded. The number hides again after {REVEAL_SECONDS} seconds.</span> : null}
      {act.error ? (
        <span role="alert" className="basis-full text-small text-danger">
          {act.error.message}
        </span>
      ) : null}
    </div>
  );
}

function UploadForm({ employeeId, audience, replacing, onDone, onCancel }: { employeeId: string; audience: 'hr' | 'self'; replacing: boolean; onDone: (d: IdentityDocument) => void; onCancel?: () => void }) {
  const u = useIdentityUpload();
  async function save() {
    const input = u.validate();
    if (!input) return;
    const r = await u.submit(employeeId, input);
    if (r.ok) onDone(r.document);
  }
  return (
    <div className="flex flex-col gap-5">
      {replacing ? (
        <Alert variant="info">Submitting a new document replaces the current one. The previous files are kept for 30 days, then deleted.</Alert>
      ) : null}
      <IdentityDocumentFields draft={u.draft} onChange={u.setDraft} errors={u.errors} onFieldError={u.setFieldError} disabled={u.uploading} progress={u.progress} audience={audience} />
      {u.error ? <Alert variant="danger" title="The document was not saved.">{u.error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={save} loading={u.uploading} loadingText="Uploading…">
          {replacing ? 'Replace document' : 'Submit document'}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={u.uploading}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "Identity Documents" section of an employee profile: masked number, front/back preview and download, dates,
 * plus submit/replace (HR, Super Admin, the employee), delete (HR, Super Admin) and reveal (Super Admin only).
 * Renders nothing for callers without read access (Managers, other employees).
 */
export function IdentityDocumentsPanel({ employeeId, session }: { employeeId: string; session: { permissions: readonly Permission[]; employeeId: string | null } }) {
  const access = identityAccess(session, employeeId);
  const query = useAsyncData(`identity-document:${employeeId}`, () => getIdentityDocument(employeeId), access.canRead);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const audience: 'hr' | 'self' = session.employeeId === employeeId ? 'self' : 'hr';

  if (!access.canRead) return null;
  if (query.status === 'loading' || query.status === 'idle') {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading identity documents">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (query.status === 'error') {
    return (
      <Alert variant="danger" title="Could not load identity documents.">
        {describeApiError(query.error)}{' '}
        <button type="button" className="cursor-pointer underline underline-offset-2" onClick={query.reload}>
          Try again
        </button>
      </Alert>
    );
  }

  const doc = query.data ?? null;
  const done = (message: string) => {
    setEditing(false);
    setSaved(message);
    query.reload();
  };

  if (!doc) {
    return (
      <div className="flex flex-col gap-4">
        {saved ? <Alert variant="success">{saved}</Alert> : null}
        {access.canWrite && editing ? (
          <UploadForm employeeId={employeeId} audience={audience} replacing={false} onDone={() => done('Identity document saved.')} onCancel={() => setEditing(false)} />
        ) : (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-3">
              <IdCard className="size-6 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
              <p className="text-body text-muted">No identity document on file.</p>
            </div>
            {access.canWrite ? <Button onClick={() => { setSaved(null); setEditing(true); }}>Add identity document</Button> : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {saved ? <Alert variant="success">{saved}</Alert> : null}
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Item label="Document type">{IDENTITY_DOCUMENT_LABELS[doc.documentType]}</Item>
        <Item label="Document number">
          {access.canReveal ? <RevealNumber key={doc.id} employeeId={employeeId} masked={doc.maskedNumber} /> : <span className="font-mono tabular-nums tracking-wide">{doc.maskedNumber}</span>}
        </Item>
        <Item label="Uploaded">{formatTimestamp(doc.uploadedAt)}</Item>
        <Item label="Last updated">{formatTimestamp(doc.updatedAt)}</Item>
      </dl>
      <div className="grid gap-3 lg:grid-cols-2">
        <FileRow label="Front side" side="front" employeeId={employeeId} mimeType={doc.front.mimeType} />
        {doc.back ? <FileRow label="Back side" side="back" employeeId={employeeId} mimeType={doc.back.mimeType} /> : null}
      </div>
      {editing ? (
        <UploadForm employeeId={employeeId} audience={audience} replacing onDone={() => done('Identity document replaced.')} onCancel={() => setEditing(false)} />
      ) : access.canWrite || access.canDelete ? (
        <div className="flex flex-wrap gap-2">
          {access.canWrite ? (
            <Button variant="secondary" onClick={() => { setSaved(null); setEditing(true); }}>
              <RefreshCw aria-hidden />
              Replace document
            </Button>
          ) : null}
          {access.canDelete ? (
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
      {removing ? <DeleteDialog employeeId={employeeId} onClose={() => setRemoving(false)} onDone={() => { setRemoving(false); done('Identity document deleted.'); }} /> : null}
    </div>
  );
}

function DeleteDialog({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: () => void }) {
  const act = useAction(() => deleteIdentityDocument(employeeId));
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete identity document"
      description="It is hidden immediately. The files and encrypted number are permanently removed after 30 days."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={act.pending}
            onClick={async () => {
              const r = await act.run();
              if (r.ok) onDone();
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
    </Dialog>
  );
}
