'use client';

import {
  IDENTITY_DOCUMENT_ACCEPT,
  IDENTITY_DOCUMENT_LABELS,
  IDENTITY_DOCUMENT_TYPES,
  IDENTITY_NUMBER_HINTS,
  IDENTITY_NUMBER_PLACEHOLDERS,
  checkIdentityFileMeta,
  identityBackRequired,
  type IdentityDocumentType,
} from '@gsc/contracts';
import { CircleAlert, Eye, EyeOff, FileText, ImageIcon, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { IdentityDraft, IdentityDraftErrors } from './form-model';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-small text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {message}
    </p>
  );
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * One file slot (front or back): choose, preview, replace, remove. Images get a local preview that stays
 * blurred until the user asks to see it, so an ID is not readable over a shoulder or in a screenshot by default.
 * Nothing leaves the browser until the form is submitted.
 */
function FileSlot({
  label,
  required,
  file,
  error,
  disabled,
  onChange,
}: {
  label: string;
  required: boolean;
  file: File | null;
  error?: string;
  disabled?: boolean;
  onChange: (file: File | null, problem?: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const isImage = !!file && file.type.startsWith('image/');
  // Local object URL for the preview, released when the file changes or the slot unmounts.
  // Falls back to an icon where previews are not supported.
  const url = useMemo(() => {
    if (!file || !isImage || typeof URL.createObjectURL !== 'function') return null;
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }, [file, isImage]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  // The preview is revealed per file: choosing another file starts blurred again.
  const [revealedFor, setRevealedFor] = useState<File | null>(null);
  const reveal = !!file && revealedFor === file;
  const setReveal = (fn: (r: boolean) => boolean) => setRevealedFor(fn(reveal) ? file : null);

  const pick = () => input.current?.click();

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={`${id}-label`} className="text-label font-medium text-ink">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-danger">
            *
          </span>
        ) : (
          <span className="ml-1 font-normal text-muted">(optional)</span>
        )}
      </span>
      <input
        ref={input}
        id={id}
        type="file"
        accept={IDENTITY_DOCUMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = ''; // choosing the same file again still fires change
          if (!f) return;
          onChange(f, checkIdentityFileMeta(f) ?? undefined);
        }}
      />
      {file ? (
        <div
          className={cn(
            'flex items-center gap-3 rounded-md bg-sunken p-3',
            error && 'ring-1 ring-danger',
          )}
        >
          <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded bg-surface">
            {isImage && url ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, never a remote image
              <img
                src={url}
                alt={reveal ? `${label} preview` : ''}
                className={cn('size-full object-cover transition-[filter] duration-150', !reveal && 'blur-md')}
              />
            ) : isImage ? (
              <ImageIcon className="size-6 text-muted" aria-hidden />
            ) : (
              <FileText className="size-6 text-muted" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body text-ink" title={file.name}>
              {file.name}
            </p>
            <p className="text-small text-muted">{formatSize(file.size)}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {isImage && url ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setReveal((r) => !r)} disabled={disabled} aria-pressed={reveal}>
                  {reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  {reveal ? 'Hide preview' : 'Show preview'}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={pick} disabled={disabled} aria-label={`Replace ${label.toLowerCase()}`}>
                <RefreshCw aria-hidden />
                Replace
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} disabled={disabled} aria-label={`Remove ${label.toLowerCase()}`}>
                <Trash2 aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={disabled}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={cn(
            'flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong bg-surface px-4 py-4 text-center transition-colors duration-[120ms] hover:border-primary hover:bg-hover focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60',
            error && 'border-danger',
          )}
        >
          <Upload className="size-5 text-muted" aria-hidden />
          <span className="text-label font-medium text-ink">Choose file</span>
          <span id={`${id}-hint`} className="text-small text-muted">
            JPG, PNG or PDF, up to 5 MB
          </span>
        </button>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export interface IdentityDocumentFieldsProps {
  draft: IdentityDraft;
  onChange: (draft: IdentityDraft) => void;
  errors: IdentityDraftErrors;
  /** Clears or sets one field's error as the user edits. */
  onFieldError: (field: keyof IdentityDraftErrors, message?: string) => void;
  disabled?: boolean;
  /** 0..1 while uploading, null otherwise. */
  progress: number | null;
  /** Who is submitting: HR on the employee's behalf, or the employee themself. Changes the consent wording. */
  audience: 'hr' | 'self';
}

/**
 * Government ID fields: document type, number (masked while typing, with a Show toggle), front and back files,
 * privacy notice and consent. Controlled; validation lives in `validateIdentityDraft`.
 */
export function IdentityDocumentFields({ draft, onChange, errors, onFieldError, disabled, progress, audience }: IdentityDocumentFieldsProps) {
  const numberId = useId();
  const consentId = useId();
  const [showNumber, setShowNumber] = useState(false);
  const type = draft.documentType || null;
  const backRequired = type ? identityBackRequired(type) : true;
  const set = (patch: Partial<IdentityDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Document type"
          required
          value={draft.documentType}
          disabled={disabled}
          error={errors.documentType}
          onChange={(e) => {
            set({ documentType: e.target.value as IdentityDocumentType | '' });
            onFieldError('documentType');
            onFieldError('documentNumber');
            onFieldError('back');
          }}
        >
          <option value="">Choose a document</option>
          {IDENTITY_DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {IDENTITY_DOCUMENT_LABELS[t]}
            </option>
          ))}
        </SelectField>

        {type ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={numberId} className="text-label font-medium text-ink">
              Document number
              <span aria-hidden className="ml-0.5 text-danger">
                *
              </span>
            </label>
            <div className="relative">
              <Input
                id={numberId}
                required
                value={draft.documentNumber}
                disabled={disabled}
                placeholder={IDENTITY_NUMBER_PLACEHOLDERS[type]}
                inputMode={type === 'AADHAAR' ? 'numeric' : 'text'}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize={type === 'AADHAAR' ? 'off' : 'characters'}
                spellCheck={false}
                maxLength={40}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                invalid={!!errors.documentNumber}
                aria-describedby={`${numberId}-hint${errors.documentNumber ? ` ${numberId}-error` : ''}`}
                className={cn('pr-11', !showNumber && draft.documentNumber && '[-webkit-text-security:disc]')}
                onChange={(e) => {
                  set({ documentNumber: e.target.value });
                  if (errors.documentNumber) onFieldError('documentNumber');
                }}
              />
              <button
                type="button"
                onClick={() => setShowNumber((s) => !s)}
                disabled={disabled}
                aria-label={showNumber ? 'Hide document number' : 'Show document number'}
                aria-pressed={showNumber}
                className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-md text-muted hover:text-ink focus-visible:text-ink disabled:cursor-not-allowed"
              >
                {showNumber ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
            <FieldError id={`${numberId}-error`} message={errors.documentNumber} />
            <p id={`${numberId}-hint`} className="text-small text-muted">
              {IDENTITY_NUMBER_HINTS[type]} We check the format only; this does not verify the document.
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FileSlot
          label="Front side"
          required
          file={draft.front}
          error={errors.front}
          disabled={disabled}
          onChange={(f, problem) => {
            set({ front: f });
            onFieldError('front', problem);
          }}
        />
        <FileSlot
          label="Back side"
          required={backRequired}
          file={draft.back}
          error={errors.back}
          disabled={disabled}
          onChange={(f, problem) => {
            set({ back: f });
            onFieldError('back', problem);
          }}
        />
      </div>

      {/* PLACEHOLDER PRIVACY NOTICE: wording must be reviewed and approved by legal before production use. */}
      <div className="rounded-md bg-sunken p-4">
        <p className="text-label font-medium text-ink">Privacy notice</p>
        <p className="mt-1 text-small text-muted">
          This document is collected only to verify identity for employment and to keep statutory records. Files are
          stored privately and encrypted numbers are never shown in full. Only HR, Super Admins and the employee can
          view the document, and every view is recorded. Documents are deleted in line with the company&apos;s retention policy.
        </p>
        <label htmlFor={consentId} className="mt-3 flex cursor-pointer items-start gap-2.5 text-body text-ink">
          <input
            id={consentId}
            type="checkbox"
            checked={draft.consent}
            disabled={disabled}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? `${consentId}-error` : undefined}
            onChange={(e) => {
              set({ consent: e.target.checked });
              if (e.target.checked) onFieldError('consent');
            }}
            className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
          />
          <span>
            {audience === 'hr'
              ? 'The employee has been given this notice and has agreed to provide this document.'
              : 'I have read this notice and agree to provide this document.'}
          </span>
        </label>
        <div className="mt-1.5">
          <FieldError id={`${consentId}-error`} message={errors.consent} />
        </div>
      </div>

      {progress !== null ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="flex items-center justify-between text-small text-muted">
            <span>{progress < 1 ? 'Uploading document…' : 'Finishing up…'}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Identity document upload"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
