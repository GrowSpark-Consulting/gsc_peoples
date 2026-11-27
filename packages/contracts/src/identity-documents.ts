import { z } from 'zod';

/**
 * Government ID / identity proof (one active document per employee).
 *
 * Number validation here is FORMAT validation only: it catches typos and obviously wrong values. It does not,
 * and cannot, prove that a document is genuine or belongs to the person. No UIDAI or other external identity
 * verification is performed anywhere in this system.
 *
 * Shared by the API (authoritative) and the web form (early feedback). Error messages never echo the input.
 */

export const IDENTITY_DOCUMENT_TYPES = ['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID'] as const;
export const identityDocumentTypeSchema = z.enum(IDENTITY_DOCUMENT_TYPES);
export type IdentityDocumentType = z.infer<typeof identityDocumentTypeSchema>;

export const IDENTITY_DOCUMENT_LABELS: Record<IdentityDocumentType, string> = {
  AADHAAR: 'Aadhaar Card',
  PAN: 'PAN Card',
  DRIVING_LICENCE: 'Driving Licence',
  VOTER_ID: 'Voter ID',
};

export const IDENTITY_NUMBER_PLACEHOLDERS: Record<IdentityDocumentType, string> = {
  AADHAAR: '1234 5678 9012',
  PAN: 'ABCDE1234F',
  DRIVING_LICENCE: 'MH12 20110012345',
  VOTER_ID: 'ABC1234567',
};

export const IDENTITY_NUMBER_HINTS: Record<IdentityDocumentType, string> = {
  AADHAAR: '12 digits. Spaces are optional.',
  PAN: '10 characters: 5 letters, 4 digits, 1 letter.',
  DRIVING_LICENCE: 'As printed on the licence, starting with the state code. Spaces and hyphens are optional.',
  VOTER_ID: 'EPIC number, usually 3 letters and 7 digits.',
};

/** The back side is required for every type except PAN (a PAN card carries nothing needed on the back). */
export const identityBackRequired = (type: IdentityDocumentType) => type !== 'PAN';

/** Files: JPG/JPEG, PNG or PDF, at most 5 MB each. The server re-checks the bytes, not just the declared type. */
export const IDENTITY_DOCUMENT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const IDENTITY_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const IDENTITY_DOCUMENT_ACCEPT = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf'] as const;
const EXTENSIONS_FOR: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'application/pdf': ['pdf'],
};

/** Checks a file's name, declared type and size (no bytes). Returns a message or null. */
export function checkIdentityFileMeta(file: { name: string; type: string; size: number }): string | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) return 'Choose a JPG, PNG or PDF file.';
  const allowed = EXTENSIONS_FOR[file.type.toLowerCase()];
  if (!allowed) return 'Choose a JPG, PNG or PDF file.';
  if (!allowed.includes(ext)) return 'The file extension does not match its type.';
  if (file.size <= 0) return 'This file is empty.';
  if (file.size > IDENTITY_DOCUMENT_MAX_BYTES) return 'Each file can be at most 5 MB.';
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Number validation
// ---------------------------------------------------------------------------------------------------------

// Verhoeff checksum tables. Every Aadhaar number carries a Verhoeff check digit, so this catches nearly all
// single-digit typos and adjacent transpositions.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True when a digit string passes the Verhoeff check (last digit is the check digit). */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(rev[i])]!]!;
  return c === 0;
}

/**
 * State and Union Territory codes that begin an Indian driving licence number, including codes still printed
 * on older licences (OR, UA, TS/TG, DD/DN, CT alongside CG).
 */
export const DL_STATE_CODES: readonly string[] = [
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'CT', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HP', 'HR', 'JH', 'JK', 'KA', 'KL',
  'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TG', 'TN', 'TR', 'TS', 'UA',
  'UK', 'UP', 'WB',
];

// PAN: 3 letters, entity-type letter (P person, C company, H HUF, F firm, A AOP, T trust, B BOI, L local
// authority, J artificial juridical person, G government), 1 letter, 4 digits, 1 check letter.
const PAN_RE = /^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$/;
const EPIC_RE = /^[A-Z]{3}[0-9]{7}$/;
// Older state-issued EPIC numbers, e.g. GJ/07/041/123456 (state / constituency / part / serial).
const EPIC_LEGACY_RE = /^[A-Z]{2}\/[0-9]{2}\/[0-9]{3}\/[0-9]{6,7}$/;

export type IdentityNumberResult =
  | { ok: true; normalized: string; last4: string }
  | { ok: false; message: string };

/** Trims, removes the separators people commonly type, upper-cases. Does not validate. */
export function normalizeIdentityNumber(type: IdentityDocumentType, raw: string): string {
  const s = raw.trim().toUpperCase();
  switch (type) {
    case 'AADHAAR':
      return s.replace(/[\s-]/g, '');
    case 'PAN':
      return s.replace(/\s/g, '');
    case 'DRIVING_LICENCE':
      return s.replace(/[\s\-/.]/g, '');
    case 'VOTER_ID':
      // Keep '/' (part of the legacy format), drop spaces and hyphens.
      return s.replace(/[\s-]/g, '');
  }
}

/** Format validation for a document number. Messages never include the input. */
export function validateIdentityNumber(type: IdentityDocumentType, raw: string): IdentityNumberResult {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, message: 'Enter the document number.' };
  if (raw.length > 40) return { ok: false, message: 'This document number is too long.' };
  const n = normalizeIdentityNumber(type, raw);
  const ok = (): IdentityNumberResult => ({ ok: true, normalized: n, last4: n.replace(/\//g, '').slice(-4) });
  switch (type) {
    case 'AADHAAR':
      if (!/^\d{12}$/.test(n)) return { ok: false, message: 'Aadhaar number must be exactly 12 digits.' };
      if (n[0] === '0' || n[0] === '1') return { ok: false, message: 'Aadhaar numbers do not start with 0 or 1.' };
      if (!verhoeffValid(n)) return { ok: false, message: 'This Aadhaar number is not valid. Check for a typing mistake.' };
      return ok();
    case 'PAN':
      if (n.length !== 10) return { ok: false, message: 'PAN must be exactly 10 characters.' };
      if (!PAN_RE.test(n)) return { ok: false, message: 'PAN format is 5 letters, 4 digits, then 1 letter (for example ABCDE1234F).' };
      return ok();
    case 'DRIVING_LICENCE':
      if (!/^[A-Z0-9]+$/.test(n)) return { ok: false, message: 'Use only letters, digits, spaces or hyphens.' };
      if (n.length < 10 || n.length > 16) return { ok: false, message: 'Driving licence number should be 10 to 16 characters.' };
      if (!DL_STATE_CODES.includes(n.slice(0, 2))) return { ok: false, message: 'Driving licence number should start with a valid state code (for example MH, DL, KA).' };
      if ((n.match(/\d/g) ?? []).length < 7) return { ok: false, message: 'This driving licence number has too few digits.' };
      return ok();
    case 'VOTER_ID':
      if (EPIC_RE.test(n) || EPIC_LEGACY_RE.test(n)) return ok();
      return { ok: false, message: 'Voter ID (EPIC) is usually 3 letters followed by 7 digits.' };
  }
}

/** Masked display, showing only the last four characters, e.g. `XXXX XXXX 9012` or `XXXXXX234F`. */
export function maskIdentityNumber(type: IdentityDocumentType, last4: string): string {
  return type === 'AADHAAR' ? `XXXX XXXX ${last4}` : `XXXXXX${last4}`;
}

// ---------------------------------------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------------------------------------

export const IDENTITY_DOCUMENT_SIDES = ['front', 'back'] as const;
export const identityDocumentSideSchema = z.enum(IDENTITY_DOCUMENT_SIDES);
export type IdentityDocumentSide = z.infer<typeof identityDocumentSideSchema>;

/**
 * Text fields of `PUT /employees/:id/identity-document` (multipart/form-data). Files are the `front` and
 * `back` parts. `consent` records that the employee has been given the privacy notice and agrees.
 */
export const identityDocumentFieldsSchema = z
  .object({
    documentType: identityDocumentTypeSchema,
    documentNumber: z.string().max(40),
    consent: z.literal('true', { error: 'Confirm the privacy notice and consent' }),
  })
  .strict();

const fileMetaSchema = z.object({ mimeType: z.string(), sizeBytes: z.number().int() });

/** What any authorised reader receives. Never the full number, never a storage key. */
export const identityDocumentSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  documentType: identityDocumentTypeSchema,
  maskedNumber: z.string(),
  front: fileMetaSchema,
  back: fileMetaSchema.nullable(),
  /** When this employee's first identity document was submitted (kept across replacements). */
  uploadedAt: z.string(),
  /** When the current document was submitted (the latest replacement). */
  updatedAt: z.string(),
  consentRecordedAt: z.string(),
});
export type IdentityDocument = z.infer<typeof identityDocumentSchema>;

export const identityDocumentResponseSchema = z.object({ data: identityDocumentSchema.nullable() });
export const identityDocumentLinkQuerySchema = z.object({ inline: z.enum(['true', 'false']).optional() }).strict();
export const identityDocumentLinkResponseSchema = z.object({ data: z.object({ url: z.string(), expiresInSeconds: z.number().int() }) });
export const identityDocumentRevealResponseSchema = z.object({ data: z.object({ documentNumber: z.string() }) });
