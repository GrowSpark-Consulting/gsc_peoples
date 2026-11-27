import { describe, expect, it } from 'vitest';
import {
  checkIdentityFileMeta,
  identityBackRequired,
  identityDocumentFieldsSchema,
  maskIdentityNumber,
  normalizeIdentityNumber,
  validateIdentityNumber,
  verhoeffValid,
} from './identity-documents';

/** Appends the Verhoeff check digit, so tests use structurally valid (fictitious) Aadhaar numbers. */
function withCheckDigit(base11: string): string {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(base11 + d)) return base11 + d;
  throw new Error('unreachable');
}
const AADHAAR = withCheckDigit('23456789012');

describe('Aadhaar', () => {
  it('accepts 12 digits with a valid check digit, with or without spaces/hyphens', () => {
    expect(validateIdentityNumber('AADHAAR', AADHAAR)).toEqual({ ok: true, normalized: AADHAAR, last4: AADHAAR.slice(-4) });
    const spaced = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)}-${AADHAAR.slice(8)}`;
    expect(validateIdentityNumber('AADHAAR', `  ${spaced} `).ok).toBe(true);
  });
  it('rejects wrong length, letters, a leading 0/1 and a bad check digit', () => {
    expect(validateIdentityNumber('AADHAAR', '23456789012').ok).toBe(false);
    expect(validateIdentityNumber('AADHAAR', '2345678901234').ok).toBe(false);
    expect(validateIdentityNumber('AADHAAR', '23456789012A').ok).toBe(false);
    expect(validateIdentityNumber('AADHAAR', withCheckDigit('03456789012')).ok).toBe(false);
    expect(validateIdentityNumber('AADHAAR', withCheckDigit('13456789012')).ok).toBe(false);
    const bad = AADHAAR.slice(0, 11) + ((Number(AADHAAR[11]) + 1) % 10);
    expect(validateIdentityNumber('AADHAAR', bad).ok).toBe(false);
  });
  it('verhoeff catches an adjacent transposition', () => {
    expect(verhoeffValid('2363')).toBe(true); // reference vector: 236 -> check digit 3
    expect(verhoeffValid('3263')).toBe(false);
  });
});

describe('PAN', () => {
  it('normalises case and spaces and accepts the standard format', () => {
    expect(validateIdentityNumber('PAN', ' abcpe1234f ')).toEqual({ ok: true, normalized: 'ABCPE1234F', last4: '234F' });
    for (const p of ['AAACB1234C', 'AAAHA1234H', 'AAAFA1234F', 'AAATA1234T', 'AAAGA1234G']) expect(validateIdentityNumber('PAN', p).ok, p).toBe(true);
  });
  it('rejects wrong length, wrong positions and an invalid entity-type letter', () => {
    for (const p of ['ABCDE1234', 'ABCDE12345F', '1BCPE1234F', 'ABCPE12A4F', 'ABCXE1234F', 'ABCPE1234F!']) expect(validateIdentityNumber('PAN', p).ok, p).toBe(false);
  });
});

describe('Driving licence (state-specific formats, not one rigid regex)', () => {
  it('accepts modern and older formats from different states', () => {
    for (const dl of ['MH12 20110012345', 'DL-0420110149646', 'KA0120080001234', 'TN 22 2012 0001234', 'GJ01/2015/0012345', 'UP14 20190012345', 'OR0219990012345', 'TS0720180001234', 'mh1220110012345'])
      expect(validateIdentityNumber('DRIVING_LICENCE', dl).ok, dl).toBe(true);
    expect(normalizeIdentityNumber('DRIVING_LICENCE', 'mh-12 2011/0012345')).toBe('MH1220110012345');
  });
  it('rejects unknown state codes, too short/long, symbols and too few digits', () => {
    for (const dl of ['XX1220110012345', 'MH12', 'MH12201100123456789', 'MH12#2011001234', 'MHABCDEFGHIJK1'])
      expect(validateIdentityNumber('DRIVING_LICENCE', dl).ok, dl).toBe(false);
  });
});

describe('Voter ID (EPIC)', () => {
  it('accepts the standard 3 letters + 7 digits and legacy state formats', () => {
    expect(validateIdentityNumber('VOTER_ID', 'abc1234567')).toEqual({ ok: true, normalized: 'ABC1234567', last4: '4567' });
    expect(validateIdentityNumber('VOTER_ID', 'GJ/07/041/123456')).toMatchObject({ ok: true, last4: '3456' });
    expect(validateIdentityNumber('VOTER_ID', 'UP/19/098/1234567').ok).toBe(true);
  });
  it('rejects other shapes', () => {
    for (const v of ['AB12345678', 'ABCD123456', 'ABC123456', '1234567890', 'GJ/07/41/123456']) expect(validateIdentityNumber('VOTER_ID', v).ok, v).toBe(false);
  });
});

describe('shared rules', () => {
  it('error messages never contain the input', () => {
    const secret = '99887766554433';
    for (const t of ['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'VOTER_ID'] as const) {
      const r = validateIdentityNumber(t, secret);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).not.toContain(secret.slice(0, 6));
    }
  });
  it('empty and overlong input is rejected', () => {
    expect(validateIdentityNumber('PAN', '   ').ok).toBe(false);
    expect(validateIdentityNumber('PAN', 'A'.repeat(41)).ok).toBe(false);
  });
  it('masks to the last four only', () => {
    expect(maskIdentityNumber('AADHAAR', '9012')).toBe('XXXX XXXX 9012');
    expect(maskIdentityNumber('PAN', '234F')).toBe('XXXXXX234F');
  });
  it('back side is optional only for PAN', () => {
    expect(identityBackRequired('PAN')).toBe(false);
    for (const t of ['AADHAAR', 'DRIVING_LICENCE', 'VOTER_ID'] as const) expect(identityBackRequired(t)).toBe(true);
  });
  it('multipart fields require consent and reject unknown fields', () => {
    expect(identityDocumentFieldsSchema.safeParse({ documentType: 'PAN', documentNumber: 'X', consent: 'true' }).success).toBe(true);
    expect(identityDocumentFieldsSchema.safeParse({ documentType: 'PAN', documentNumber: 'X', consent: 'false' }).success).toBe(false);
    expect(identityDocumentFieldsSchema.safeParse({ documentType: 'PAN', documentNumber: 'X' }).success).toBe(false);
    expect(identityDocumentFieldsSchema.safeParse({ documentType: 'PASSPORT', documentNumber: 'X', consent: 'true' }).success).toBe(false);
    expect(identityDocumentFieldsSchema.safeParse({ documentType: 'PAN', documentNumber: 'X', consent: 'true', employeeId: 'x' }).success).toBe(false);
  });
});

describe('file metadata pre-check', () => {
  const ok = { name: 'front.jpg', type: 'image/jpeg', size: 1000 };
  it('accepts JPG, JPEG, PNG and PDF up to 5 MB', () => {
    expect(checkIdentityFileMeta(ok)).toBeNull();
    expect(checkIdentityFileMeta({ ...ok, name: 'a.JPEG' })).toBeNull();
    expect(checkIdentityFileMeta({ name: 'a.png', type: 'image/png', size: 5 * 1024 * 1024 })).toBeNull();
    expect(checkIdentityFileMeta({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBeNull();
  });
  it('rejects other types, mismatched extensions, empty and oversized files', () => {
    expect(checkIdentityFileMeta({ name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 10 })).not.toBeNull();
    expect(checkIdentityFileMeta({ name: 'a.gif', type: 'image/gif', size: 10 })).not.toBeNull();
    expect(checkIdentityFileMeta({ name: 'a.png', type: 'image/jpeg', size: 10 })).not.toBeNull();
    expect(checkIdentityFileMeta({ ...ok, size: 0 })).not.toBeNull();
    expect(checkIdentityFileMeta({ ...ok, size: 5 * 1024 * 1024 + 1 })).not.toBeNull();
  });
});
