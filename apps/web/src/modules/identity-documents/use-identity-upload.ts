'use client';

import type { IdentityDocument } from '@gsc/contracts';
import { useCallback, useRef, useState } from 'react';
import { describeApiError } from '@/lib/api-client';
import { identityFieldErrors, uploadIdentityDocument, type IdentityUploadInput } from './api';
import { EMPTY_IDENTITY_DRAFT, validateIdentityDraft, type IdentityDraft, type IdentityDraftErrors, type IdentityDraftField } from './form-model';

const FIELDS: readonly IdentityDraftField[] = ['documentType', 'documentNumber', 'front', 'back', 'consent'];

/** Draft, validation, upload progress and server-error mapping for one identity document submission. */
export function useIdentityUpload(upload: typeof uploadIdentityDocument = uploadIdentityDocument) {
  const [draft, setDraft] = useState<IdentityDraft>(EMPTY_IDENTITY_DRAFT);
  const [errors, setErrors] = useState<IdentityDraftErrors>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const setFieldError = useCallback((field: IdentityDraftField, message?: string) => {
    setErrors((e) => {
      const next = { ...e };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }, []);

  /** Validates the draft and shows every problem. Returns the upload input when valid. */
  const validate = useCallback((): IdentityUploadInput | null => {
    const r = validateIdentityDraft(draft);
    setErrors(r.ok ? {} : r.errors);
    return r.ok ? r.input : null;
  }, [draft]);

  const submit = useCallback(
    async (employeeId: string, input: IdentityUploadInput): Promise<{ ok: true; document: IdentityDocument } | { ok: false }> => {
      if (busy.current) return { ok: false };
      busy.current = true;
      setError(null);
      setProgress(0);
      try {
        const document = await upload(employeeId, input, setProgress);
        return { ok: true, document };
      } catch (e) {
        const fieldErrors = identityFieldErrors(e);
        const placed = Object.entries(fieldErrors).filter(([k]) => (FIELDS as readonly string[]).includes(k));
        if (placed.length) setErrors(Object.fromEntries(placed));
        setError(describeApiError(e));
        return { ok: false };
      } finally {
        busy.current = false;
        setProgress(null);
      }
    },
    [upload],
  );

  const reset = useCallback(() => {
    setDraft(EMPTY_IDENTITY_DRAFT);
    setErrors({});
    setError(null);
    setProgress(null);
  }, []);

  return { draft, setDraft, errors, setFieldError, progress, uploading: progress !== null, error, setError, validate, submit, reset };
}
