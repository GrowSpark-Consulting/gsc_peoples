import { checkIdentityFileMeta, identityBackRequired, validateIdentityNumber, type IdentityDocumentType } from '@gsc/contracts';
import type { IdentityUploadInput } from './api';

export interface IdentityDraft {
  documentType: IdentityDocumentType | '';
  documentNumber: string;
  front: File | null;
  back: File | null;
  consent: boolean;
}

export type IdentityDraftField = 'documentType' | 'documentNumber' | 'front' | 'back' | 'consent';
export type IdentityDraftErrors = Partial<Record<IdentityDraftField, string>>;

export const EMPTY_IDENTITY_DRAFT: IdentityDraft = { documentType: '', documentNumber: '', front: null, back: null, consent: false };

/**
 * Client-side check of the whole identity section, using the same rules the API enforces (the API checks
 * again, including the file contents). Returns the normalised upload input when everything is valid.
 */
export function validateIdentityDraft(d: IdentityDraft): { ok: true; input: IdentityUploadInput } | { ok: false; errors: IdentityDraftErrors } {
  const errors: IdentityDraftErrors = {};
  if (!d.documentType) {
    errors.documentType = 'Choose a document type.';
  } else {
    const n = validateIdentityNumber(d.documentType, d.documentNumber);
    if (!n.ok) errors.documentNumber = n.message;
    if (!d.back && identityBackRequired(d.documentType)) errors.back = 'Upload the back side of the document.';
  }
  if (!d.front) errors.front = 'Upload the front side of the document.';
  else {
    const p = checkIdentityFileMeta(d.front);
    if (p) errors.front = p;
  }
  if (d.back) {
    const p = checkIdentityFileMeta(d.back);
    if (p) errors.back = p;
  }
  if (!d.consent) errors.consent = 'Confirm the privacy notice to continue.';
  if (Object.keys(errors).length || !d.documentType || !d.front) return { ok: false, errors };
  const n = validateIdentityNumber(d.documentType, d.documentNumber);
  if (!n.ok) return { ok: false, errors: { documentNumber: n.message } };
  return { ok: true, input: { documentType: d.documentType, documentNumber: n.normalized, front: d.front, back: d.back } };
}
